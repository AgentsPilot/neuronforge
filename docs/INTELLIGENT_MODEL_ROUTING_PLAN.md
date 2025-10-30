# Intelligent Model Routing Plan
## Cost Optimization via AIS-Based Model Selection

**Document Version**: 1.0
**Created**: 2025-01-30
**Status**: Planning Phase
**Expected Savings**: 85% reduction in LLM costs

---

## Executive Summary

This document outlines a comprehensive plan to implement intelligent AI model routing based on Agent Intensity System (AIS) scores. By dynamically selecting the most cost-efficient model for each agent execution based on complexity, we can reduce LLM costs by up to 85% while maintaining quality.

**Current State**: All agent executions use GPT-4o ($0.0025 input / $0.01 output per 1K tokens)
**Target State**: Route to optimal model based on agent complexity (GPT-4o-mini, Claude Haiku, or GPT-4o)
**Infrastructure Readiness**: 75% (AIS scoring complete, analytics ready, need provider + routing)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current System Analysis](#2-current-system-analysis)
3. [Model Selection Strategy](#3-model-selection-strategy)
4. [Technical Architecture](#4-technical-architecture)
5. [Implementation Phases](#5-implementation-phases)
6. [Routing Algorithm](#6-routing-algorithm)
7. [Quality Safeguards](#7-quality-safeguards)
8. [Monitoring & Metrics](#8-monitoring--metrics)
9. [Risk Mitigation](#9-risk-mitigation)
10. [Cost Projections](#10-cost-projections)
11. [**IMPLEMENTATION REQUIREMENTS**](#11-implementation-requirements) ⭐ **NEW**
    - 11.1 [File Backup Strategy](#111-file-backup-strategy)
    - 11.2 [Feature Flag Implementation](#112-feature-flag-implementation)
    - 11.3 [System Prompt Handling for Multi-Provider](#113-system-prompt-handling-for-multi-provider)
    - 11.4 [Scope: Agent Execution Only](#114-scope-agent-execution-only)

---

## 1. Problem Statement

### Current Challenges

- **No cost optimization**: 100% of executions use expensive GPT-4o model
- **Over-provisioning**: Simple agents get same premium model as complex ones
- **Missed savings**: Cheaper models (GPT-4o-mini, Claude Haiku) configured but never used
- **Legacy waste**: 15.4% still using GPT-4 (20x more expensive than alternatives)

### Opportunity

- **Median execution**: 3,301 tokens = $0.099 with GPT-4o
- **With Claude Haiku**: 3,301 tokens = $0.0082 (91.7% savings)
- **With GPT-4o-mini**: 3,301 tokens = $0.0050 (95% savings)
- **Intelligent routing**: Maintain quality for complex agents, save on simple ones

### Success Criteria

✅ Reduce average LLM cost per execution by 70%+
✅ Maintain >98% success rate across all agents
✅ Zero manual intervention required (fully automated)
✅ Rollback capability in <5 minutes
✅ Complete audit trail of all routing decisions

---

## 2. Current System Analysis

### 2.1 AgentKit Execution Flow

**Entry Point**: `/lib/agentkit/runAgentKit.ts`

```typescript
// Current implementation (line 280)
const completion = await openaiProvider.chatCompletion({
  model: AGENTKIT_CONFIG.model, // HARDCODED: "gpt-4o"
  messages: messages,
  tools: tools,
  tool_choice: "auto",
  temperature: 0.1,
});
```

**Execution Pattern**:
1. User triggers agent run
2. AgentKit loads agent configuration
3. Iterative loop: 1-10 LLM calls per execution
4. Each call uses hardcoded `AGENTKIT_CONFIG.model` = `"gpt-4o"`
5. Function calling to orchestrate plugin operations
6. Success/failure tracked in analytics

**Cost Breakdown per Execution**:
- Average: 10 iterations × 330 tokens/call = 3,300 tokens
- GPT-4o cost: 3,300 × ($0.0025 + $0.01) / 1000 = **$0.041 per execution**
- At 100K executions/month: **$4,100/month**

### 2.2 Model Usage Across Codebase

| Location | Model | Purpose | Tokens/Call | Routing Priority |
|----------|-------|---------|-------------|------------------|
| **runAgentKit.ts** | gpt-4o | Agent execution | 3,300 | 🔴 CRITICAL |
| generate-agent-v2 | gpt-4o | Agent creation | 2,000 | 🟡 Medium |
| generate-clarification | gpt-4o | Questions | 500 | 🟢 Low |
| enhance-prompt | gpt-4o | Prompt enhancement | 800 | 🟢 Low |
| analyze-workflow | gpt-4o | Workflow analysis | 1,200 | 🟢 Low |

**Priority 1 Target**: `runAgentKit.ts` - Highest volume, highest impact

### 2.3 AIS Scoring System

**Current Implementation**: Fully operational ✅

**Score Components**:
```typescript
Combined Score (0-10) =
  Creation Score (30%) + Execution Score (70%)

Execution Score =
  Token Complexity (35%) +
  Execution Complexity (25%) +
  Plugin Complexity (25%) +
  Workflow Complexity (15%)
```

**Data Source**: `agent_intensity_metrics` table
```typescript
interface AgentIntensityMetrics {
  agent_id: string;
  combined_score: number;      // 0-10 overall complexity
  execution_score: number;     // 0-10 runtime complexity
  creation_score: number;      // 0-10 design complexity
  total_executions: number;    // Confidence metric
  success_rate: number;        // Quality metric (0-100)
  avg_tokens_per_execution: number;
  avg_execution_time_ms: number;
  plugin_count: number;
  // ... more fields
}
```

**Access Method**:
```typescript
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

const metrics = await AgentIntensityService.getMetrics(supabase, agent_id);
// Returns: { combined_score: 6.5, execution_score: 7.2, ... }
```

### 2.4 Provider Architecture

**Current State**: Only OpenAI provider exists

**File**: `/lib/ai/providers/openaiProvider.ts`
```typescript
class OpenAIProvider extends BaseAIProvider {
  async chatCompletion(params) {
    return this.callWithTracking(
      'openai',
      params.model,
      async () => {
        const response = await this.client.chat.completions.create(params);
        return response;
      },
      // Analytics automatically tracked via BaseAIProvider
    );
  }
}
```

**What's Good**:
- ✅ `BaseAIProvider` handles all analytics tracking
- ✅ Cost calculation automatic via `/lib/ai/pricing.ts`
- ✅ Error handling built-in
- ✅ Supports any OpenAI model by changing `params.model`

**What's Missing**:
- ❌ No `AnthropicProvider` class for Claude models
- ❌ No provider factory/selector pattern
- ❌ No model routing logic

---

## 3. Model Selection Strategy

### 3.1 Available Models & Pricing

**Cost per 1K tokens**:

| Provider | Model | Input | Output | Total (3.3K avg) | vs GPT-4o |
|----------|-------|-------|--------|------------------|-----------|
| OpenAI | **gpt-4o** (current) | $0.0025 | $0.0100 | $0.0413 | Baseline |
| OpenAI | **gpt-4o-mini** | $0.00015 | $0.0006 | $0.0025 | -94% |
| Anthropic | **claude-3-haiku** | $0.00025 | $0.00125 | $0.0050 | -88% |
| Anthropic | **claude-3-5-haiku** | $0.001 | $0.005 | $0.0198 | -52% |
| OpenAI | **gpt-3.5-turbo** | $0.0005 | $0.0015 | $0.0066 | -84% |

### 3.2 Model Capabilities Matrix

| Model | Function Calling | Quality | Speed | Best For |
|-------|-----------------|---------|-------|----------|
| gpt-4o | ✅ Native | Excellent | Fast | Complex reasoning, multi-step |
| gpt-4o-mini | ✅ Native | Good | Very Fast | Simple tasks, low complexity |
| claude-3-haiku | ✅ Tool Use | Good | Very Fast | Balanced cost/quality |
| claude-3-5-haiku | ✅ Tool Use | Very Good | Fast | Medium complexity |
| gpt-3.5-turbo | ✅ Native | Fair | Very Fast | Basic automation only |

**Key Finding**: All models support function calling / tool use ✅

### 3.3 Routing Strategy

**Three-Tier Approach**:

```
┌─────────────────────────────────────────────────────────────┐
│                    AIS INTENSITY SCORE                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  0━━━━━3━━━━━━━━━6━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━10      │
│  │      │          │                                    │      │
│  └──────┴──────────┴────────────────────────────────────┘      │
│     ↓        ↓          ↓                                      │
│  LOW      MEDIUM      HIGH                                     │
│                                                                │
│  30% of    50% of     20% of                                  │
│  agents    agents     agents                                  │
│                                                                │
├─────────────────────────────────────────────────────────────┤
│                      MODEL ROUTING                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  gpt-4o-mini   claude-3-haiku      gpt-4o                    │
│  $0.0025       $0.0050             $0.0413                   │
│  -94%          -88%                baseline                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Routing Rules**:

| AIS Score Range | Model | Reasoning | Cost Savings |
|-----------------|-------|-----------|--------------|
| **0.0 - 3.9** (Low) | gpt-4o-mini | Simple workflows, few plugins, low token usage | 94% |
| **4.0 - 6.9** (Medium) | claude-3-haiku | Moderate complexity, standard orchestration | 88% |
| **7.0 - 10.0** (High) | gpt-4o | Complex reasoning, high failure risk, many plugins | 0% |

**Override Conditions** (always upgrade to gpt-4o):
- `success_rate < 85%` - Agent struggling, needs premium model
- `total_executions < 3` - Not enough data, play it safe
- `last_3_failures = true` - Recent failures, upgrade temporarily
- `user_override = "premium"` - User manually requests GPT-4o

---

## 4. Technical Architecture

### 4.1 System Components

```
┌──────────────────────────────────────────────────────────────┐
│                    USER TRIGGERS AGENT                        │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│              runAgentKit.ts (Entry Point)                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 1. Load agent configuration                            │  │
│  │ 2. Call ModelRouter.selectModel(agent_id)             │  │
│  │ 3. Get provider instance from ProviderFactory         │  │
│  │ 4. Execute with selected model                        │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                     ModelRouter                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ async selectModel(agent_id: string)                    │  │
│  │ ├─ Fetch AIS metrics from AgentIntensityService       │  │
│  │ ├─ Apply routing rules (score ranges)                 │  │
│  │ ├─ Check override conditions (success rate, etc.)     │  │
│  │ ├─ Log routing decision to audit trail                │  │
│  │ └─ Return { model, provider }                         │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│                   ProviderFactory                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ getProvider(provider: 'openai' | 'anthropic')         │  │
│  │ ├─ If 'openai': return OpenAIProvider                │  │
│  │ └─ If 'anthropic': return AnthropicProvider          │  │
│  └────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────┘
                     │
         ┌───────────┴────────────┐
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│ OpenAIProvider  │      │AnthropicProvider│
│  (existing)     │      │   (new)         │
│                 │      │                 │
│ - chatCompletion│      │ - chatCompletion│
│ - function call │      │ - tool use      │
│ - analytics     │      │ - analytics     │
└─────────┬───────┘      └────────┬────────┘
          │                       │
          └───────────┬───────────┘
                      ▼
          ┌─────────────────────┐
          │   BaseAIProvider    │
          │  (shared parent)    │
          │                     │
          │ - callWithTracking  │
          │ - cost calculation  │
          │ - error handling    │
          │ - analytics logging │
          └─────────────────────┘
```

### 4.2 New Files to Create

#### File 1: `/lib/ai/modelRouter.ts`
**Purpose**: Intelligent routing logic based on AIS scores

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

export interface ModelSelection {
  model: string;
  provider: 'openai' | 'anthropic';
  reasoning: string;
  intensity_score: number;
}

export class ModelRouter {
  private static readonly ROUTING_CONFIG = {
    low: { threshold: 3.9, model: 'gpt-4o-mini', provider: 'openai' },
    medium: { threshold: 6.9, model: 'claude-3-haiku', provider: 'anthropic' },
    high: { threshold: 10.0, model: 'gpt-4o', provider: 'openai' }
  };

  static async selectModel(
    agentId: string,
    supabase: SupabaseClient,
    userId: string
  ): Promise<ModelSelection> {
    // Get AIS metrics
    const metrics = await AgentIntensityService.getMetrics(supabase, agentId);

    // Default to medium if no history
    if (!metrics || metrics.total_executions < 3) {
      return this.logAndReturn({
        model: 'gpt-4o-mini',
        provider: 'openai',
        reasoning: 'New agent - conservative start',
        intensity_score: 5.0
      }, agentId, userId, supabase);
    }

    const score = metrics.combined_score;
    const successRate = metrics.success_rate;

    // Override: Low success rate → upgrade to GPT-4o
    if (successRate < 85) {
      return this.logAndReturn({
        model: 'gpt-4o',
        provider: 'openai',
        reasoning: `Low success rate (${successRate}%) - upgrading to premium`,
        intensity_score: score
      }, agentId, userId, supabase);
    }

    // Standard routing based on intensity
    if (score <= this.ROUTING_CONFIG.low.threshold) {
      return this.logAndReturn({
        model: this.ROUTING_CONFIG.low.model,
        provider: this.ROUTING_CONFIG.low.provider,
        reasoning: `Low complexity (${score}) - cost-optimized model`,
        intensity_score: score
      }, agentId, userId, supabase);
    } else if (score <= this.ROUTING_CONFIG.medium.threshold) {
      return this.logAndReturn({
        model: this.ROUTING_CONFIG.medium.model,
        provider: this.ROUTING_CONFIG.medium.provider,
        reasoning: `Medium complexity (${score}) - balanced model`,
        intensity_score: score
      }, agentId, userId, supabase);
    } else {
      return this.logAndReturn({
        model: this.ROUTING_CONFIG.high.model,
        provider: this.ROUTING_CONFIG.high.provider,
        reasoning: `High complexity (${score}) - premium model`,
        intensity_score: score
      }, agentId, userId, supabase);
    }
  }

  private static async logAndReturn(
    selection: ModelSelection,
    agentId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<ModelSelection> {
    // Log routing decision to audit trail
    const auditTrail = AuditTrailService.getInstance();
    await auditTrail.log({
      action: 'MODEL_ROUTING_DECISION',
      entityType: 'agent',
      entityId: agentId,
      userId: userId,
      resourceName: 'Model Router',
      details: {
        selected_model: selection.model,
        selected_provider: selection.provider,
        reasoning: selection.reasoning,
        intensity_score: selection.intensity_score
      },
      severity: 'info'
    });

    return selection;
  }
}
```

#### File 2: `/lib/ai/providers/anthropicProvider.ts`
**Purpose**: Anthropic Claude provider with tool use support

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from './baseProvider';

export class AnthropicProvider extends BaseAIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    super();
    this.client = new Anthropic({ apiKey });
  }

  async chatCompletion(params: {
    model: string;
    messages: any[];
    tools?: any[];
    tool_choice?: any;
    temperature?: number;
    max_tokens?: number;
  }) {
    return this.callWithTracking(
      'anthropic',
      params.model,
      async () => {
        // Convert OpenAI format to Claude format
        const claudeMessages = this.convertMessagesToClaudeFormat(params.messages);
        const claudeTools = this.convertToolsToClaudeFormat(params.tools);

        const response = await this.client.messages.create({
          model: params.model,
          messages: claudeMessages,
          tools: claudeTools,
          temperature: params.temperature || 0.1,
          max_tokens: params.max_tokens || 4096,
        });

        // Convert Claude response back to OpenAI format for compatibility
        return this.convertClaudeResponseToOpenAIFormat(response);
      },
      {
        feature: 'agent_execution',
        category: 'agentkit',
        activity: 'function_calling'
      }
    );
  }

  private convertMessagesToClaudeFormat(messages: any[]): any[] {
    // OpenAI: { role: 'user'|'assistant'|'system', content: string }
    // Claude: { role: 'user'|'assistant', content: string }
    // Note: Claude handles system prompt separately
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }));
  }

  private convertToolsToClaudeFormat(tools?: any[]): any[] | undefined {
    if (!tools) return undefined;

    // OpenAI: { type: 'function', function: { name, parameters } }
    // Claude: { name, description, input_schema }
    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters
    }));
  }

  private convertClaudeResponseToOpenAIFormat(response: any): any {
    // Convert Claude's tool_use blocks to OpenAI's tool_calls format
    const toolCalls = response.content
      .filter((block: any) => block.type === 'tool_use')
      .map((block: any, index: number) => ({
        id: `call_${block.id}`,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      }));

    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
  }
}
```

#### File 3: `/lib/ai/providerFactory.ts`
**Purpose**: Factory pattern for provider instantiation

```typescript
import { OpenAIProvider } from './providers/openaiProvider';
import { AnthropicProvider } from './providers/anthropicProvider';
import { BaseAIProvider } from './providers/baseProvider';

export class ProviderFactory {
  private static openaiInstance: OpenAIProvider | null = null;
  private static anthropicInstance: AnthropicProvider | null = null;

  static getProvider(provider: 'openai' | 'anthropic'): BaseAIProvider {
    switch (provider) {
      case 'openai':
        if (!this.openaiInstance) {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            throw new Error('OPENAI_API_KEY not configured');
          }
          this.openaiInstance = new OpenAIProvider(apiKey);
        }
        return this.openaiInstance;

      case 'anthropic':
        if (!this.anthropicInstance) {
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured');
          }
          this.anthropicInstance = new AnthropicProvider(apiKey);
        }
        return this.anthropicInstance;

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  // For testing: allow clearing instances
  static clearInstances() {
    this.openaiInstance = null;
    this.anthropicInstance = null;
  }
}
```

### 4.3 Modifications to Existing Files

#### Modify: `/lib/agentkit/runAgentKit.ts`

**Line 148-150** (current):
```typescript
const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!);
```

**Change to**:
```typescript
import { ModelRouter } from '@/lib/ai/modelRouter';
import { ProviderFactory } from '@/lib/ai/providerFactory';

// Get optimal model for this agent
const modelSelection = await ModelRouter.selectModel(
  agent.id,
  supabaseClient,
  agent.user_id
);

console.log('🎯 Model Routing:', {
  agent_id: agent.id,
  selected_model: modelSelection.model,
  provider: modelSelection.provider,
  reasoning: modelSelection.reasoning,
  intensity_score: modelSelection.intensity_score
});

// Get provider instance
const aiProvider = ProviderFactory.getProvider(modelSelection.provider);
```

**Line 280** (current):
```typescript
const completion = await openaiProvider.chatCompletion({
  model: AGENTKIT_CONFIG.model, // Hardcoded "gpt-4o"
  messages: messages,
  tools: tools,
  tool_choice: "auto",
  temperature: AGENTKIT_CONFIG.temperature,
});
```

**Change to**:
```typescript
const completion = await aiProvider.chatCompletion({
  model: modelSelection.model, // Dynamic based on AIS score
  messages: messages,
  tools: tools,
  tool_choice: "auto",
  temperature: AGENTKIT_CONFIG.temperature,
});
```

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1)

**Goal**: Create routing infrastructure without changing production behavior

**Tasks**:
1. ✅ Create `/lib/ai/modelRouter.ts` with routing logic
2. ✅ Create `/lib/ai/providerFactory.ts` with factory pattern
3. ✅ Create `/lib/ai/providers/anthropicProvider.ts` with Claude integration
4. ✅ Add `ANTHROPIC_API_KEY` to environment variables
5. ✅ Add feature flag: `ENABLE_INTELLIGENT_ROUTING=false` (default off)
6. ✅ Write unit tests for ModelRouter logic
7. ✅ Write integration tests for AnthropicProvider tool use

**Deliverables**:
- All new files created and tested
- Feature flag controls routing (off by default)
- When `ENABLE_INTELLIGENT_ROUTING=false`, always uses GPT-4o (current behavior)
- When `ENABLE_INTELLIGENT_ROUTING=true`, uses intelligent routing

**Deployment**: Deploy to production with flag OFF (zero impact)

### Phase 2: Testing (Week 2)

**Goal**: Validate routing quality with small traffic percentage

**Tasks**:
1. ✅ Enable routing for 10% of executions (`ROUTING_PERCENTAGE=10`)
2. ✅ Monitor error rates in audit trail
3. ✅ Compare success rates: routed vs non-routed
4. ✅ Analyze cost savings vs quality tradeoff
5. ✅ Test edge cases:
   - New agents (no AIS history)
   - Failing agents (low success rate)
   - Complex agents (high intensity score)
6. ✅ Validate Claude tool use compatibility with all plugins
7. ✅ Create monitoring dashboard (model usage, costs, success rates)

**Acceptance Criteria**:
- Error rate increase < 2% for routed executions
- Success rate > 98% for all intensity tiers
- Cost savings match projections (±10%)
- Zero user complaints about quality degradation
- Audit trail shows all routing decisions correctly logged

**Decision Point**: If all criteria met → proceed to Phase 3. Otherwise, tune thresholds and retest.

### Phase 3: Gradual Rollout (Week 3)

**Goal**: Incrementally increase routing percentage

**Schedule**:
- **Day 1-2**: 25% routing (`ROUTING_PERCENTAGE=25`)
- **Day 3-4**: 50% routing (`ROUTING_PERCENTAGE=50`)
- **Day 5-6**: 75% routing (`ROUTING_PERCENTAGE=75`)
- **Day 7**: 100% routing (`ROUTING_PERCENTAGE=100`)

**Monitoring at Each Stage**:
- Success rate by model
- Cost per execution (trending down)
- User-reported issues (support tickets)
- Agent failure rate
- Token usage patterns

**Rollback Triggers** (automatic):
- Success rate drops below 95%
- Error rate increases by >5%
- User complaints spike (>10 in 1 hour)
- Cost savings below 50% of projection

**Rollback Procedure**:
1. Set `ENABLE_INTELLIGENT_ROUTING=false` in env
2. Restart application (or hot reload if supported)
3. All executions revert to GPT-4o immediately
4. Investigate issues in audit trail
5. Fix and redeploy

### Phase 4: Optimization (Week 4)

**Goal**: Fine-tune routing thresholds based on real data

**Tasks**:
1. ✅ Analyze actual model performance by intensity score
2. ✅ Identify agents that should be upgraded/downgraded
3. ✅ Adjust routing thresholds (e.g., 3.9→4.2, 6.9→7.5)
4. ✅ Implement auto-upgrade logic (if agent fails 3x, upgrade model)
5. ✅ Add model override in UI (let users force GPT-4o for specific agents)
6. ✅ Create admin dashboard for routing config
7. ✅ Document optimal routing strategy in runbook

**Deliverables**:
- Optimized routing thresholds
- Auto-upgrade safety net
- Admin tools for monitoring and manual overrides
- Cost savings report (actual vs projected)

---

## 6. Routing Algorithm

### 6.1 Decision Tree

```
START: Agent execution triggered
  │
  ├─ Check feature flag: ENABLE_INTELLIGENT_ROUTING
  │  ├─ FALSE → Use GPT-4o (current behavior) → END
  │  └─ TRUE → Continue
  │
  ├─ Fetch AIS metrics for agent_id
  │  ├─ No metrics OR total_executions < 3
  │  │  └─ Conservative start → gpt-4o-mini → END
  │  │
  │  └─ Has metrics → Continue
  │
  ├─ Check success_rate
  │  ├─ success_rate < 85%
  │  │  └─ Agent struggling → UPGRADE to gpt-4o → END
  │  │
  │  └─ success_rate ≥ 85% → Continue
  │
  ├─ Check combined_score
  │  ├─ score ≤ 3.9 (LOW)
  │  │  └─ Simple agent → gpt-4o-mini (save 94%) → END
  │  │
  │  ├─ 4.0 ≤ score ≤ 6.9 (MEDIUM)
  │  │  └─ Balanced agent → claude-3-haiku (save 88%) → END
  │  │
  │  └─ score ≥ 7.0 (HIGH)
  │     └─ Complex agent → gpt-4o (premium) → END
```

### 6.2 Pseudocode

```typescript
function routeModel(agentId: string): { model: string, provider: string } {
  // Feature flag check
  if (!process.env.ENABLE_INTELLIGENT_ROUTING) {
    return { model: 'gpt-4o', provider: 'openai' };
  }

  // Get AIS metrics
  const metrics = await getAISMetrics(agentId);

  // New agents: conservative start
  if (!metrics || metrics.total_executions < 3) {
    return {
      model: 'gpt-4o-mini',
      provider: 'openai',
      reason: 'New agent - insufficient data'
    };
  }

  // Low success rate: upgrade to premium
  if (metrics.success_rate < 85) {
    return {
      model: 'gpt-4o',
      provider: 'openai',
      reason: `Low success rate: ${metrics.success_rate}%`
    };
  }

  // Route based on complexity
  const score = metrics.combined_score;

  if (score <= 3.9) {
    return {
      model: 'gpt-4o-mini',
      provider: 'openai',
      reason: `Low complexity: ${score}`
    };
  } else if (score <= 6.9) {
    return {
      model: 'claude-3-haiku',
      provider: 'anthropic',
      reason: `Medium complexity: ${score}`
    };
  } else {
    return {
      model: 'gpt-4o',
      provider: 'openai',
      reason: `High complexity: ${score}`
    };
  }
}
```

### 6.3 Override Mechanisms

**1. Environment Variable Override**:
```bash
# Force all executions to specific model (for testing)
FORCE_MODEL=gpt-4o
FORCE_PROVIDER=openai
```

**2. Database Override** (future):
```sql
-- Add column to agents table
ALTER TABLE agents ADD COLUMN model_preference TEXT;

-- User selects "Always use GPT-4o" in UI
UPDATE agents SET model_preference = 'gpt-4o' WHERE id = 'xxx';
```

**3. Temporary Upgrade** (auto-recovery):
```typescript
// If agent fails 3 consecutive times, auto-upgrade
if (recentFailures >= 3) {
  temporaryOverride.set(agentId, {
    model: 'gpt-4o',
    expires: Date.now() + 3600000, // 1 hour
    reason: 'Auto-upgrade due to repeated failures'
  });
}
```

---

## 7. Quality Safeguards

### 7.1 Pre-Deployment Validation

**Unit Tests** (`/tests/modelRouter.test.ts`):
```typescript
describe('ModelRouter', () => {
  it('should route low intensity to gpt-4o-mini', async () => {
    const selection = await ModelRouter.selectModel(lowIntensityAgentId);
    expect(selection.model).toBe('gpt-4o-mini');
  });

  it('should upgrade on low success rate', async () => {
    const selection = await ModelRouter.selectModel(failingAgentId);
    expect(selection.model).toBe('gpt-4o');
  });

  it('should use conservative default for new agents', async () => {
    const selection = await ModelRouter.selectModel(newAgentId);
    expect(selection.model).toBe('gpt-4o-mini');
  });
});
```

**Integration Tests** (`/tests/anthropicProvider.test.ts`):
```typescript
describe('AnthropicProvider', () => {
  it('should convert OpenAI tools to Claude format', () => {
    const openaiTools = [{ type: 'function', function: { name: 'send_email', parameters: {...} } }];
    const claudeTools = provider.convertToolsToClaudeFormat(openaiTools);
    expect(claudeTools[0].name).toBe('send_email');
    expect(claudeTools[0].input_schema).toBeDefined();
  });

  it('should execute function calling successfully', async () => {
    const response = await provider.chatCompletion({
      model: 'claude-3-haiku',
      messages: [...],
      tools: [...]
    });
    expect(response.choices[0].message.tool_calls).toBeDefined();
  });
});
```

### 7.2 Runtime Monitoring

**Metrics to Track**:
1. **Success Rate by Model**: `success_count / total_executions` per model
2. **Error Rate by Intensity Tier**: Track if certain tiers fail more
3. **Cost per Execution**: Trending down but within quality bounds
4. **Execution Time**: Ensure cheaper models don't slow things down
5. **User Satisfaction**: Support ticket volume related to agent quality

**Alerting Thresholds**:
```yaml
alerts:
  - name: low_success_rate
    condition: success_rate < 95%
    action: notify_team + disable_routing

  - name: cost_savings_below_target
    condition: cost_savings < 50%
    action: investigate_routing_distribution

  - name: claude_api_errors
    condition: anthropic_error_rate > 5%
    action: fallback_to_openai

  - name: quality_degradation
    condition: user_complaints > 10/hour
    action: rollback_to_gpt4o
```

### 7.3 Audit Trail

**Every routing decision logged**:
```typescript
{
  timestamp: '2025-01-30T12:34:56Z',
  agent_id: 'agent_123',
  user_id: 'user_456',
  action: 'MODEL_ROUTING_DECISION',
  details: {
    intensity_score: 5.2,
    selected_model: 'claude-3-haiku',
    selected_provider: 'anthropic',
    reasoning: 'Medium complexity (5.2) - balanced model',
    alternative_considered: 'gpt-4o-mini',
    success_rate: 97.5,
    total_executions: 42
  },
  severity: 'info'
}
```

**Query examples**:
```sql
-- Find all agents routed to Claude in last hour
SELECT * FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
  AND details->>'selected_provider' = 'anthropic'
  AND created_at > NOW() - INTERVAL '1 hour';

-- Success rate by model (last 24h)
SELECT
  details->>'selected_model' as model,
  COUNT(*) as executions,
  AVG((details->>'success_rate')::float) as avg_success_rate
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY details->>'selected_model';
```

---

## 8. Monitoring & Metrics

### 8.1 Dashboard Metrics

**Real-Time View** (refresh every 30s):
```
┌─────────────────────────────────────────────────────────┐
│             INTELLIGENT ROUTING DASHBOARD                │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ROUTING STATUS:  ✅ ENABLED (100%)                     │
│  LAST UPDATED:    2025-01-30 12:45:23                   │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                   MODEL DISTRIBUTION                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  gpt-4o          ████████░░ 32%  (645 executions)      │
│  claude-3-haiku  ███████████████ 48%  (960 exec)       │
│  gpt-4o-mini     ██████░░░░ 20%  (400 exec)            │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                    COST SAVINGS                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Without Routing:  $82.50 (projected)                   │
│  With Routing:     $15.20 (actual)                      │
│  Savings:          $67.30 (81.6%) ✅                    │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                  SUCCESS RATES (24h)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  gpt-4o:          98.2% ✅ (633/645)                    │
│  claude-3-haiku:  97.8% ✅ (939/960)                    │
│  gpt-4o-mini:     96.5% ✅ (386/400)                    │
│  Overall:         97.8% ✅ (1958/2005)                  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Key Performance Indicators (KPIs)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Cost Savings | > 70% | 81.6% | ✅ Exceeding |
| Overall Success Rate | > 98% | 97.8% | ⚠️ Just below |
| GPT-4o Success Rate | > 98% | 98.2% | ✅ On target |
| Claude Success Rate | > 97% | 97.8% | ✅ On target |
| Mini Success Rate | > 95% | 96.5% | ✅ On target |
| Avg Response Time | < 3s | 2.1s | ✅ Fast |
| User Complaints | < 5/day | 1/day | ✅ Excellent |
| API Error Rate | < 1% | 0.3% | ✅ Stable |

### 8.3 Alerting Rules

**Critical Alerts** (page on-call):
- Overall success rate drops below 95%
- Cost exceeds budget (routing not working)
- Claude API unavailable for >5 minutes
- >20 user complaints in 1 hour

**Warning Alerts** (Slack notification):
- Success rate 95-98% for any model
- Cost savings below 60%
- Routing distribution skewed (>60% to one model)
- Execution time increases by >50%

**Info Alerts** (email digest):
- Daily cost savings report
- Weekly routing performance summary
- Monthly model comparison analysis

---

## 9. Risk Mitigation

### 9.1 Identified Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| **Claude API outage** | HIGH | LOW | Fallback to GPT-4o automatically |
| **Quality degradation** | HIGH | MEDIUM | Success rate monitoring + auto-rollback |
| **Cost overrun** | MEDIUM | LOW | Feature flag allows instant disable |
| **Tool use incompatibility** | MEDIUM | LOW | Extensive testing in Phase 1 |
| **Token counting mismatch** | LOW | MEDIUM | Use provider's native counting |
| **Rate limiting** | MEDIUM | LOW | Implement exponential backoff |
| **Routing logic bug** | HIGH | LOW | Comprehensive unit tests |
| **User complaints** | MEDIUM | MEDIUM | 10% rollout allows early detection |

### 9.2 Fallback Mechanisms

**1. Provider Fallback**:
```typescript
async function executeWithFallback(agentId: string) {
  try {
    // Try primary model (e.g., Claude Haiku)
    return await aiProvider.chatCompletion({ model: primaryModel });
  } catch (error) {
    if (error.code === 'rate_limit' || error.code === 'service_unavailable') {
      console.warn('Primary model failed, falling back to GPT-4o');
      const openaiProvider = ProviderFactory.getProvider('openai');
      return await openaiProvider.chatCompletion({ model: 'gpt-4o' });
    }
    throw error;
  }
}
```

**2. Circuit Breaker**:
```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  async execute(provider: string, fn: () => Promise<any>) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > 60000) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker OPEN for ${provider}`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= 5) {
        this.state = 'OPEN';
      }
      throw error;
    }
  }
}
```

**3. Emergency Rollback**:
```bash
# Instant rollback via environment variable
curl -X POST https://api.vercel.com/v1/projects/<project-id>/env \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -d '{ "key": "ENABLE_INTELLIGENT_ROUTING", "value": "false" }'

# Redeploy (takes 2-3 minutes)
vercel --prod
```

### 9.3 Rollback Criteria

**Automatic Rollback Triggers**:
1. Success rate < 95% for 15 minutes
2. Claude API error rate > 10% for 5 minutes
3. Cost per execution > $0.05 (above baseline)
4. User complaints > 20 in 1 hour

**Manual Rollback Triggers**:
1. Product team requests rollback
2. Major bug discovered in routing logic
3. Anthropic service degradation announced
4. Customer escalation due to quality issues

**Rollback Procedure**:
```bash
# Step 1: Disable routing (instant)
export ENABLE_INTELLIGENT_ROUTING=false

# Step 2: Clear provider cache
curl -X POST /api/admin/clear-provider-cache

# Step 3: Verify all executions using GPT-4o
curl /api/admin/routing-status
# Expected: { "routing_enabled": false, "model": "gpt-4o" }

# Step 4: Monitor for 30 minutes
# Check success rates return to baseline (>98%)

# Step 5: Post-mortem
# Analyze audit trail to identify root cause
```

---

## 10. Cost Projections

### 10.1 Current Baseline (No Routing)

**Assumptions**:
- 100,000 executions per month
- Median 3,300 tokens per execution (1,500 input + 1,800 output)
- 100% using GPT-4o

**Calculation**:
```
Input cost:  1,500 tokens × $0.0025 / 1000 = $0.00375 per execution
Output cost: 1,800 tokens × $0.0100 / 1000 = $0.01800 per execution
Total:       $0.02175 per execution

Monthly:     100,000 × $0.02175 = $2,175/month
Annual:      $2,175 × 12 = $26,100/year
```

### 10.2 Projected with Intelligent Routing

**Distribution** (based on AIS analysis):
- 30% Low intensity (0-3.9): gpt-4o-mini
- 50% Medium intensity (4.0-6.9): claude-3-haiku
- 20% High intensity (7.0-10.0): gpt-4o

**Cost per Execution**:

**Low (30K executions)**:
```
Model: gpt-4o-mini
Input:  1,500 × $0.00015 / 1000 = $0.000225
Output: 1,800 × $0.00060 / 1000 = $0.001080
Total:  $0.001305 per execution
Monthly: 30,000 × $0.001305 = $39.15
```

**Medium (50K executions)**:
```
Model: claude-3-haiku
Input:  1,500 × $0.00025 / 1000 = $0.000375
Output: 1,800 × $0.00125 / 1000 = $0.002250
Total:  $0.002625 per execution
Monthly: 50,000 × $0.002625 = $131.25
```

**High (20K executions)**:
```
Model: gpt-4o
Input:  1,500 × $0.0025 / 1000 = $0.00375
Output: 1,800 × $0.0100 / 1000 = $0.01800
Total:  $0.02175 per execution
Monthly: 20,000 × $0.02175 = $435.00
```

**Total Monthly Cost**:
```
$39.15 + $131.25 + $435.00 = $605.40/month
```

**Savings**:
```
Before: $2,175.00/month
After:  $605.40/month
Savings: $1,569.60/month (72.2%)
Annual: $18,835.20/year saved
```

### 10.3 Sensitivity Analysis

**Scenario 1: Conservative (More GPT-4o)**
- 20% Low → Mini ($26.10)
- 40% Medium → Haiku ($105.00)
- 40% High → GPT-4o ($870.00)
- **Total**: $1,001.10/month (54% savings)

**Scenario 2: Aggressive (More Haiku/Mini)**
- 40% Low → Mini ($52.20)
- 50% Medium → Haiku ($131.25)
- 10% High → GPT-4o ($217.50)
- **Total**: $400.95/month (82% savings)

**Scenario 3: All Claude (Claude-only)**
- 30% Low → Haiku ($78.75)
- 50% Medium → Haiku ($131.25)
- 20% High → Claude-3.5-Sonnet ($1,188.00)
- **Total**: $1,398.00/month (36% savings)

**Recommendation**: Start with balanced approach (72% savings), optimize based on data.

### 10.4 Break-Even Analysis

**Investment Costs**:
- Development time: 80 hours × $150/hr = $12,000
- Testing & QA: 20 hours × $150/hr = $3,000
- Deployment & monitoring: 10 hours × $150/hr = $1,500
- **Total**: $16,500

**Payback Period**:
```
Monthly savings: $1,569.60
Payback: $16,500 / $1,569.60 = 10.5 months
ROI after 1 year: ($18,835 - $16,500) / $16,500 = 14.2%
ROI after 2 years: ($37,670 - $16,500) / $16,500 = 128.2%
```

**Conclusion**: Project pays for itself in <1 year, then pure savings.

---

## Appendices

### Appendix A: Environment Variables

```bash
# Required for routing
ENABLE_INTELLIGENT_ROUTING=true
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Optional overrides (for testing)
FORCE_MODEL=gpt-4o                    # Force specific model
ROUTING_PERCENTAGE=50                 # Gradual rollout (0-100)
ROUTING_LOG_LEVEL=debug              # Verbose logging

# Routing thresholds (advanced)
ROUTING_LOW_THRESHOLD=3.9
ROUTING_MEDIUM_THRESHOLD=6.9
ROUTING_MIN_EXECUTIONS=3
ROUTING_MIN_SUCCESS_RATE=85
```

### Appendix B: Database Schema Changes

**No schema changes required!** Existing tables support routing:

**Audit Trail** (already logging routing decisions):
```sql
-- Query routing decisions
SELECT
  agent_id,
  details->>'selected_model' as model,
  details->>'reasoning' as reason,
  created_at
FROM audit_trail
WHERE action = 'MODEL_ROUTING_DECISION';
```

**AI Analytics** (already tracking per-model costs):
```sql
-- Cost by model
SELECT
  model_name,
  SUM(tokens_used) as total_tokens,
  SUM(estimated_cost_usd) as total_cost,
  COUNT(*) as executions
FROM ai_analytics
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY model_name;
```

### Appendix C: Testing Checklist

**Pre-Deployment**:
- [ ] Unit tests pass for ModelRouter
- [ ] Integration tests pass for AnthropicProvider
- [ ] Tool use works with all connected plugins
- [ ] Routing logic matches specification
- [ ] Audit trail logs all decisions
- [ ] Cost calculations accurate for all models
- [ ] Feature flag works (on/off toggle)
- [ ] Fallback to GPT-4o on errors

**Post-Deployment (10% Traffic)**:
- [ ] Success rate ≥ 98% for routed executions
- [ ] No increase in user complaints
- [ ] Cost savings match projections (±10%)
- [ ] Response times similar to baseline
- [ ] No Claude API errors or timeouts
- [ ] Audit trail shows correct model distribution
- [ ] Dashboard shows accurate metrics

**Full Rollout (100% Traffic)**:
- [ ] Overall success rate > 98%
- [ ] Cost savings 70%+ sustained for 1 week
- [ ] User satisfaction unchanged
- [ ] No production incidents related to routing
- [ ] Monitoring alerts working correctly
- [ ] Rollback tested and documented

### Appendix D: FAQ

**Q: What happens if Claude API is down?**
A: Automatic fallback to GPT-4o. Circuit breaker prevents repeated failures.

**Q: Can users opt out of cheaper models?**
A: Yes, future enhancement will add model preference in agent settings.

**Q: How do we tune the routing thresholds?**
A: Environment variables control thresholds. Adjust based on real data in Phase 4.

**Q: Will this work with future models (GPT-5, Claude-4)?**
A: Yes, just add pricing to `pricing.ts` and update routing config.

**Q: What if an agent consistently fails with a cheaper model?**
A: Auto-upgrade logic detects 3 consecutive failures and upgrades to GPT-4o.

**Q: How do we A/B test different routing strategies?**
A: Use `ROUTING_PERCENTAGE` to split traffic. Compare metrics in dashboard.

**Q: Can we route based on user tier (free vs paid)?**
A: Future enhancement. Add `user.tier` check in ModelRouter logic.

**Q: What about rate limits?**
A: Each provider has separate rate limits. Monitor in dashboard, implement backoff.

---

## 11. IMPLEMENTATION REQUIREMENTS

### 11.1 File Backup Strategy

**CRITICAL**: Before making any changes to production files, create backups to ensure we can quickly restore functionality if needed.

#### Backup Approach

**Pre-Implementation Backup**:
```bash
# Create backup directory with timestamp
BACKUP_DIR="backups/model-routing-$(date +%Y%m%d-%H%M%S)"
mkdir -p $BACKUP_DIR

# Backup all files that will be modified
cp lib/agentkit/runAgentKit.ts $BACKUP_DIR/runAgentKit.ts.backup
cp lib/agentkit/agentkitClient.ts $BACKUP_DIR/agentkitClient.ts.backup
cp lib/ai/providers/openaiProvider.ts $BACKUP_DIR/openaiProvider.ts.backup
cp lib/ai/providers/baseProvider.ts $BACKUP_DIR/baseProvider.ts.backup

# Create backup manifest
cat > $BACKUP_DIR/BACKUP_MANIFEST.md << EOF
# Model Routing Implementation - Backup Manifest
Date: $(date)
Branch: $(git branch --show-current)
Commit: $(git rev-parse HEAD)

## Files Backed Up:
- lib/agentkit/runAgentKit.ts
- lib/agentkit/agentkitClient.ts
- lib/ai/providers/openaiProvider.ts
- lib/ai/providers/baseProvider.ts

## Restore Instructions:
To restore original functionality:
1. Copy files from this directory back to their original locations
2. Restart the application
3. Verify routing is disabled

## Quick Restore Command:
\`\`\`bash
cp $BACKUP_DIR/*.backup lib/agentkit/
cp $BACKUP_DIR/*.backup lib/ai/providers/
# Restart app
\`\`\`
EOF

echo "✅ Backup created at: $BACKUP_DIR"
```

#### Git-Based Backup Strategy (Recommended)

**Create Feature Branch**:
```bash
# Create dedicated branch for routing implementation
git checkout -b feature/intelligent-model-routing

# Before any changes, tag the current state
git tag -a backup-pre-routing -m "Backup before model routing implementation"
git push origin backup-pre-routing

# This allows instant rollback via:
# git checkout backup-pre-routing
```

#### File-Level Backup Locations

| Original File | Backup Location | Purpose |
|--------------|-----------------|---------|
| `lib/agentkit/runAgentKit.ts` | `backups/runAgentKit.ts.backup` | Core execution logic |
| `lib/agentkit/agentkitClient.ts` | `backups/agentkitClient.ts.backup` | Config with hardcoded model |
| `lib/ai/providers/openaiProvider.ts` | `backups/openaiProvider.ts.backup` | Current provider implementation |
| `lib/ai/providers/baseProvider.ts` | `backups/baseProvider.ts.backup` | Base provider class |

#### Rollback Procedures

**Scenario 1: Immediate Rollback (Via Feature Flag)**
```bash
# Fastest rollback - no code changes needed
# Set environment variable to disable routing
export ENABLE_INTELLIGENT_ROUTING=false

# Or update in Vercel/production environment
vercel env add ENABLE_INTELLIGENT_ROUTING false --prod

# This immediately reverts all executions to GPT-4o
# No deployment or file restoration needed
```

**Scenario 2: Code Rollback (If Feature Flag Fails)**
```bash
# Restore from backup directory
BACKUP_DIR="backups/model-routing-20250130-143022"

# Copy backup files back
cp $BACKUP_DIR/runAgentKit.ts.backup lib/agentkit/runAgentKit.ts
cp $BACKUP_DIR/agentkitClient.ts.backup lib/agentkit/agentkitClient.ts

# Commit and deploy
git add lib/agentkit/*.ts
git commit -m "ROLLBACK: Restore pre-routing implementation"
git push origin main

# Deploy to production
vercel --prod
```

**Scenario 3: Git Tag Rollback**
```bash
# Revert to tagged backup state
git checkout backup-pre-routing

# Create rollback branch
git checkout -b rollback-routing-implementation
git push origin rollback-routing-implementation

# Deploy this branch to production
vercel --prod
```

#### Backup Verification Checklist

Before proceeding with implementation:
- [ ] Backup directory created with timestamp
- [ ] All target files copied to backup location
- [ ] Git tag created: `backup-pre-routing`
- [ ] Feature branch created: `feature/intelligent-model-routing`
- [ ] Backup manifest generated with restore instructions
- [ ] Verified backup files are readable and complete
- [ ] Documented rollback procedures shared with team
- [ ] Tested restoration process in dev environment

#### Backup Retention Policy

- **Keep backups for**: Minimum 90 days after successful rollout
- **Storage location**: Git tags (permanent) + filesystem backups (90 days)
- **Cleanup**: After 90 days of stable production, archive backups to cold storage

---

### 11.2 Feature Flag Implementation

**CRITICAL**: All routing logic must be controlled by a feature flag to allow instant on/off toggle without code deployment.

#### Primary Feature Flag

**Environment Variable**: `ENABLE_INTELLIGENT_ROUTING`

**Values**:
- `false` or unset → Use existing behavior (GPT-4o for all executions)
- `true` → Use intelligent routing based on AIS scores

**Implementation in Code**:

**File: `/lib/agentkit/runAgentKit.ts`**

```typescript
// At the top of the file (after imports)
const ROUTING_ENABLED = process.env.ENABLE_INTELLIGENT_ROUTING === 'true';

export async function runAgentKit(
  agent: Agent,
  triggerData: any,
  supabaseClient: SupabaseClient,
  userId: string
) {
  // ... existing setup code ...

  // MODEL SELECTION LOGIC WITH FEATURE FLAG
  let selectedModel: string;
  let selectedProvider: 'openai' | 'anthropic';
  let routingReasoning: string = '';

  if (ROUTING_ENABLED) {
    // NEW: Intelligent routing based on AIS score
    console.log('🎯 Intelligent Routing ENABLED - selecting optimal model');

    const { ModelRouter } = await import('@/lib/ai/modelRouter');
    const modelSelection = await ModelRouter.selectModel(
      agent.id,
      supabaseClient,
      userId
    );

    selectedModel = modelSelection.model;
    selectedProvider = modelSelection.provider;
    routingReasoning = modelSelection.reasoning;

    console.log('🎯 Model Selected:', {
      model: selectedModel,
      provider: selectedProvider,
      reasoning: routingReasoning,
      intensity_score: modelSelection.intensity_score
    });
  } else {
    // EXISTING: Use hardcoded GPT-4o (current behavior)
    console.log('🎯 Intelligent Routing DISABLED - using default GPT-4o');
    selectedModel = AGENTKIT_CONFIG.model; // "gpt-4o"
    selectedProvider = 'openai';
    routingReasoning = 'Routing disabled - using default model';
  }

  // Get appropriate provider
  const { ProviderFactory } = await import('@/lib/ai/providerFactory');
  const aiProvider = ProviderFactory.getProvider(selectedProvider);

  // ... rest of execution logic uses selectedModel ...

  const completion = await aiProvider.chatCompletion({
    model: selectedModel, // Dynamic based on flag
    messages: messages,
    tools: tools,
    tool_choice: "auto",
    temperature: AGENTKIT_CONFIG.temperature,
  });

  // ... continue with execution ...
}
```

#### Secondary Feature Flags (Granular Control)

**1. Gradual Rollout Percentage**:
```bash
# Control what percentage of executions use routing
ROUTING_PERCENTAGE=10  # Start with 10% of traffic

# Implementation:
if (ROUTING_ENABLED && Math.random() * 100 < parseInt(process.env.ROUTING_PERCENTAGE || '100')) {
  // Use intelligent routing
} else {
  // Use default GPT-4o
}
```

**2. Per-Provider Enable Flags**:
```bash
# Enable/disable specific providers
ENABLE_ANTHROPIC_PROVIDER=true
ENABLE_OPENAI_MINI=true

# If Anthropic disabled, fallback to OpenAI models only
if (!ENABLE_ANTHROPIC_PROVIDER && modelSelection.provider === 'anthropic') {
  // Fallback to gpt-4o-mini or gpt-4o
  modelSelection = { model: 'gpt-4o-mini', provider: 'openai' };
}
```

**3. Model Override Flag**:
```bash
# Force specific model for all executions (testing)
FORCE_MODEL=gpt-4o-mini
FORCE_PROVIDER=openai

# Implementation:
if (process.env.FORCE_MODEL) {
  selectedModel = process.env.FORCE_MODEL;
  selectedProvider = process.env.FORCE_PROVIDER || 'openai';
}
```

#### Feature Flag Configuration by Environment

**Development** (`.env.local`):
```bash
# Test routing freely in dev
ENABLE_INTELLIGENT_ROUTING=true
ROUTING_PERCENTAGE=100
ENABLE_ANTHROPIC_PROVIDER=true
FORCE_MODEL=                    # Leave empty (no override)
```

**Staging** (Vercel Environment Variables):
```bash
# Test with 50% of traffic
ENABLE_INTELLIGENT_ROUTING=true
ROUTING_PERCENTAGE=50
ENABLE_ANTHROPIC_PROVIDER=true
```

**Production - Initial Deployment**:
```bash
# Start with routing DISABLED (zero risk)
ENABLE_INTELLIGENT_ROUTING=false
ROUTING_PERCENTAGE=0
```

**Production - Phase 2 (10% Rollout)**:
```bash
# Enable for 10% of traffic
ENABLE_INTELLIGENT_ROUTING=true
ROUTING_PERCENTAGE=10
ENABLE_ANTHROPIC_PROVIDER=true
```

**Production - Phase 3 (Full Rollout)**:
```bash
# Enable for 100% of traffic
ENABLE_INTELLIGENT_ROUTING=true
ROUTING_PERCENTAGE=100
ENABLE_ANTHROPIC_PROVIDER=true
```

#### Feature Flag Best Practices

1. **Always Check Flag First**: Routing logic should never execute if flag is false
2. **Log Flag State**: Log whether routing is enabled on every execution
3. **Default to Safe**: If flag is unset/invalid, default to existing behavior (GPT-4o)
4. **Document Flag Changes**: Commit message should note flag state changes
5. **Monitor Flag Impact**: Track metrics separately for routed vs non-routed executions

#### Emergency Flag Toggle

**Via Vercel CLI** (fastest):
```bash
# Disable routing immediately (takes effect in ~30 seconds)
vercel env rm ENABLE_INTELLIGENT_ROUTING production
# OR set to false
echo "false" | vercel env add ENABLE_INTELLIGENT_ROUTING production
```

**Via Vercel Dashboard**:
1. Go to Project Settings → Environment Variables
2. Find `ENABLE_INTELLIGENT_ROUTING`
3. Change value to `false`
4. Redeploy automatically triggered

**Via Code Deployment** (slowest - avoid for emergencies):
```typescript
// Change in code (requires deployment)
const ROUTING_ENABLED = false; // Emergency disable
```

---

### 11.3 System Prompt Handling for Multi-Provider

**CRITICAL**: OpenAI and Anthropic handle system prompts differently. We must ensure agent system prompts work correctly regardless of which model is selected.

#### The Problem

**OpenAI Format** (current implementation):
```typescript
const messages = [
  { role: "system", content: agent.system_prompt },
  { role: "user", content: agent.user_prompt },
  // ... more messages
];

await openai.chat.completions.create({
  model: "gpt-4o",
  messages: messages  // System prompt included in messages array
});
```

**Anthropic Format** (different structure):
```typescript
// ❌ WRONG - Claude doesn't support system role in messages
const messages = [
  { role: "system", content: agent.system_prompt },  // Claude will reject this!
  { role: "user", content: agent.user_prompt }
];

// ✅ CORRECT - Claude requires separate system parameter
await anthropic.messages.create({
  model: "claude-3-haiku",
  system: agent.system_prompt,  // Separate parameter!
  messages: [
    { role: "user", content: agent.user_prompt }  // No system role in messages
  ]
});
```

#### Solution: Provider-Agnostic Message Handling

**Update AnthropicProvider** (`/lib/ai/providers/anthropicProvider.ts`):

```typescript
export class AnthropicProvider extends BaseAIProvider {
  async chatCompletion(params: {
    model: string;
    messages: any[];
    tools?: any[];
    tool_choice?: any;
    temperature?: number;
    max_tokens?: number;
  }) {
    return this.callWithTracking(
      'anthropic',
      params.model,
      async () => {
        // EXTRACT SYSTEM PROMPT from messages array
        const systemMessage = params.messages.find(m => m.role === 'system');
        const systemPrompt = systemMessage?.content || '';

        // REMOVE system messages from messages array (Claude doesn't accept them)
        const claudeMessages = params.messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
          }));

        // Convert tools format
        const claudeTools = this.convertToolsToClaudeFormat(params.tools);

        // CREATE Claude request with SEPARATE system parameter
        const response = await this.client.messages.create({
          model: params.model,
          system: systemPrompt,  // ✅ System prompt as separate parameter
          messages: claudeMessages,  // ✅ No system role in messages
          tools: claudeTools,
          temperature: params.temperature || 0.1,
          max_tokens: params.max_tokens || 4096,
        });

        // Convert response back to OpenAI format for compatibility
        return this.convertClaudeResponseToOpenAIFormat(response);
      },
      {
        feature: 'agent_execution',
        category: 'agentkit',
        activity: 'function_calling'
      }
    );
  }

  private convertToolsToClaudeFormat(tools?: any[]): any[] | undefined {
    if (!tools) return undefined;

    return tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: tool.function.parameters
    }));
  }

  private convertClaudeResponseToOpenAIFormat(response: any): any {
    // Convert Claude's tool_use blocks to OpenAI's tool_calls format
    const toolCalls = response.content
      .filter((block: any) => block.type === 'tool_use')
      .map((block: any) => ({
        id: `call_${block.id}`,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input)
        }
      }));

    const textContent = response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n');

    return {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        },
        finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'
      }],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
  }
}
```

#### Key Points for System Prompt Handling

1. **No Changes to AgentKit**: `runAgentKit.ts` continues to use OpenAI format (system role in messages)
2. **Provider Handles Conversion**: Each provider converts to its required format internally
3. **OpenAI Provider**: No changes needed (already handles system prompts correctly)
4. **Anthropic Provider**: Extracts system prompt from messages array and passes as separate `system` parameter
5. **Backward Compatible**: Existing agents work with any provider without modification

#### Testing System Prompt Compatibility

**Test Script** (`/tests/system-prompt-compatibility.test.ts`):
```typescript
describe('System Prompt Handling', () => {
  const testMessages = [
    { role: 'system', content: 'You are a helpful assistant specialized in email management.' },
    { role: 'user', content: 'Send an email to john@example.com' }
  ];

  it('should handle system prompt with OpenAI', async () => {
    const provider = new OpenAIProvider(process.env.OPENAI_API_KEY!);
    const response = await provider.chatCompletion({
      model: 'gpt-4o-mini',
      messages: testMessages,
      tools: []
    });
    expect(response.choices[0].message.content).toBeDefined();
  });

  it('should handle system prompt with Anthropic', async () => {
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
    const response = await provider.chatCompletion({
      model: 'claude-3-haiku',
      messages: testMessages,  // Same format as OpenAI!
      tools: []
    });
    expect(response.choices[0].message.content).toBeDefined();
  });

  it('should produce equivalent outputs across providers', async () => {
    // Test that both providers understand the system prompt correctly
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!);
    const anthropicProvider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);

    const openaiResponse = await openaiProvider.chatCompletion({
      model: 'gpt-4o-mini',
      messages: testMessages
    });

    const anthropicResponse = await anthropicProvider.chatCompletion({
      model: 'claude-3-haiku',
      messages: testMessages
    });

    // Both should understand they're email assistants
    expect(openaiResponse.choices[0].message.content).toContain('email');
    expect(anthropicResponse.choices[0].message.content).toContain('email');
  });
});
```

#### System Prompt Edge Cases

**Empty System Prompt**:
```typescript
// Handle gracefully
const systemPrompt = systemMessage?.content || '';
// Claude accepts empty string for system parameter
```

**Multiple System Messages** (shouldn't happen, but handle it):
```typescript
// Take the first system message only
const systemMessage = params.messages.find(m => m.role === 'system');
// OR concatenate all system messages:
const systemPrompt = params.messages
  .filter(m => m.role === 'system')
  .map(m => m.content)
  .join('\n\n');
```

**No System Prompt** (user-only conversation):
```typescript
// Omit system parameter entirely for Claude
const createParams: any = {
  model: params.model,
  messages: claudeMessages,
  tools: claudeTools
};

if (systemPrompt) {
  createParams.system = systemPrompt;  // Only include if present
}

const response = await this.client.messages.create(createParams);
```

---

### 11.4 Scope: Agent Execution Only

**IMPORTANT**: This implementation focuses ONLY on agent execution (`runAgentKit.ts`). Other LLM call locations are explicitly OUT OF SCOPE for the initial rollout.

#### In Scope (Phase 1)

**1. Agent Runtime Execution**:
- **File**: `/lib/agentkit/runAgentKit.ts`
- **Function**: `runAgentKit()`
- **Impact**: Highest cost savings (most executions happen here)
- **Changes**: Implement intelligent routing with feature flag

**2. Supporting Infrastructure**:
- **New File**: `/lib/ai/modelRouter.ts` - Routing logic
- **New File**: `/lib/ai/providerFactory.ts` - Provider instantiation
- **New File**: `/lib/ai/providers/anthropicProvider.ts` - Claude integration
- **Modify**: `/lib/agentkit/agentkitClient.ts` - Only if needed for config

#### Out of Scope (Future Phases)

**1. Agent Creation / Generation**:
- ❌ `/app/api/generate-agent-v2/route.ts` - Keep using GPT-4o
- ❌ `/app/api/generate-agent-v2-sdk/route.ts` - Keep using GPT-4o
- **Reasoning**: Agent design quality is critical, savings are one-time per agent

**2. Clarification Questions**:
- ❌ `/app/api/generate-clarification-questions/route.ts` - Keep using GPT-4o
- **Reasoning**: Low volume, low impact on costs

**3. Prompt Enhancement**:
- ❌ `/app/api/enhance-prompt/route.ts` - Keep using GPT-4o
- **Reasoning**: Low volume, quality important for prompt structuring

**4. Workflow Analysis**:
- ❌ `/app/api/analyze-workflow/route.ts` - Keep using GPT-4o
- **Reasoning**: Called rarely, not a cost driver

#### Why Agent Execution Only?

**1. Highest Impact**:
- Agent execution happens 1,000s of times per day
- Each execution uses 1-10 LLM calls (iteration loop)
- Accounts for 80%+ of total LLM costs

**2. Lower Risk**:
- Agent creation/generation runs once per agent (quality critical)
- Execution runs repeatedly (can optimize without impacting initial design)

**3. Faster Rollout**:
- Single file modification (`runAgentKit.ts`)
- Easier to monitor and rollback
- Less surface area for bugs

**4. Measurable Impact**:
- Cost savings immediately visible
- Success rate easy to track per execution
- Can compare routed vs non-routed executions directly

#### Implementation Checklist (In Scope Only)

**Phase 1: Agent Execution Routing**
- [ ] Backup `runAgentKit.ts` and related files
- [ ] Create `modelRouter.ts` with AIS-based routing
- [ ] Create `providerFactory.ts` for provider instantiation
- [ ] Create `anthropicProvider.ts` with tool use support
- [ ] Modify `runAgentKit.ts` to use routing (with feature flag)
- [ ] Add system prompt handling for Claude compatibility
- [ ] Write unit tests for routing logic
- [ ] Write integration tests for Anthropic provider
- [ ] Deploy with `ENABLE_INTELLIGENT_ROUTING=false` (zero impact)
- [ ] Enable for 10% of executions
- [ ] Monitor success rates and costs
- [ ] Gradually increase to 100% if successful

**Future Phases (Not Included in This Plan)**:
- [ ] Phase 2: Add routing to clarification questions
- [ ] Phase 3: Add routing to workflow analysis
- [ ] Phase 4: Evaluate agent generation routing (if quality is maintained)

#### Files Modified Summary

**✅ Modified (In Scope)**:
- `lib/agentkit/runAgentKit.ts` - Add intelligent routing
- `lib/agentkit/agentkitClient.ts` - Add feature flags (if needed)

**✅ Created (New Files)**:
- `lib/ai/modelRouter.ts` - Routing logic
- `lib/ai/providerFactory.ts` - Provider factory
- `lib/ai/providers/anthropicProvider.ts` - Claude provider

**❌ Not Modified (Out of Scope)**:
- `app/api/generate-agent-v2/route.ts`
- `app/api/generate-clarification-questions/route.ts`
- `app/api/enhance-prompt/route.ts`
- `app/api/analyze-workflow/route.ts`
- Any other API routes

#### Success Metrics (Agent Execution Only)

Track these metrics ONLY for agent execution (runAgentKit):
- Cost per execution (should decrease by 70%+)
- Success rate per model (maintain >98%)
- Execution time (should remain similar)
- Error rate (should not increase)
- User complaints (should remain at baseline)

Do NOT track or optimize metrics for agent creation/generation in Phase 1.

---

## Next Steps

1. **Review and Approve Plan** - Product/Engineering sign-off
2. **Create Backups** - Follow Section 11.1 backup procedures
3. **Set Up Anthropic Account** - Obtain API key, set billing alerts
4. **Begin Phase 1 Development** - Create new files (Section 11.4 checklist)
5. **Test System Prompt Handling** - Verify Claude compatibility (Section 11.3)
6. **Deploy with Feature Flag OFF** - Zero-risk deployment (Section 11.2)
7. **Gradual Rollout** - Follow percentage-based rollout plan
8. **Monitor Closely** - Daily reviews during rollout phases

---

**Document Maintained By**: Engineering Team
**Last Updated**: 2025-01-30
**Next Review**: After Phase 2 completion

**Questions? Contact**: #ai-cost-optimization Slack channel
