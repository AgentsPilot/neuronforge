# Agent Execution Flow & OpenAI Integration

## Overview
This document explains the complete agent execution flow and where/how OpenAI SDK is used in the system.

---

## 🚀 Complete Execution Flow

### Entry Points

#### 1. **Manual Execution (Immediate)**
**File**: [app/api/run-agent/route.ts](app/api/run-agent/route.ts)
- **Endpoint**: `POST /api/run-agent`
- **Parameters**:
  ```typescript
  {
    agent_id: string
    input_variables?: Record<string, any>
    override_user_prompt?: string
    use_queue?: false  // Immediate execution
  }
  ```
- **Flow**: Calls `runAgentWithContext()` directly

#### 2. **Queue-Based Execution (QStash)**
**File**: [app/api/run-agent/route.ts](app/api/run-agent/route.ts#L68-L181)
- **Endpoint**: `POST /api/run-agent` with `use_queue: true`
- **Flow**:
  1. Creates execution record in `agent_executions` table
  2. Calls `addManualExecution()` from [lib/queues/qstashQueue.ts](lib/queues/qstashQueue.ts)
  3. QStash queues the job
  4. Later executed by [app/api/cron/process-queue/route.ts](app/api/cron/process-queue/route.ts)

#### 3. **Scheduled Execution (Cron)**
**File**: [app/api/run-scheduled-agents/route.ts](app/api/run-scheduled-agents/route.ts)

> ⚠️ **Schedule retired (2026-09-27, admin reorganisation slice 5, part A).** AgentsPilot is parked, and on Offir's instruction ("sunset them for now") `/api/run-scheduled-agents` is **no longer in `vercel.json`**, so scheduled agents do not run on a schedule. The route code is unchanged. To re-enable, add `{ "path": "/api/run-scheduled-agents", "schedule": "*/5 * * * *" }` back to `crons` in `vercel.json` (and update `lib/cron/__tests__/vercelCrons.test.ts`). The two other AgentsPilot schedules, `/api/cron/update-template-scores` (`0 3 * * *`) and `/api/cron/memory-consolidation` (`0 4 * * 0`), were retired the same way.

- **Trigger**: Vercel Cron (every 5 minutes) — *retired 2026-09-27, see the note above*
- **Flow**:
  1. Finds agents where `next_run < now` and `schedule_enabled = true`
  2. Creates execution record for each
  3. Queues via QStash
  4. Updates `next_run` timestamp

---

## 🧠 Core Execution Engine

### Main Orchestrator
**File**: [lib/utils/runAgentWithContext.ts](lib/utils/runAgentWithContext.ts#L154-L450)

**Function**: `runAgentWithContext()`

### 8-Phase Execution Pipeline

#### **Phase 0: Memory Initialization** (Lines 188-199)
- Simplified user context initialization
- Pattern recognition preparation

#### **Phase 1: Intent Analysis** (Lines 201-226)
- **File**: [lib/intelligence/analysis/IntentAnalyzer.ts](lib/intelligence/analysis/IntentAnalyzer.ts)
- **Purpose**: Understand what the user wants
- **Output**:
  ```typescript
  {
    primaryIntent: string
    dataSource: string
    actionType: string
    complexity: 'simple' | 'moderate' | 'complex'
    urgency: 'low' | 'medium' | 'high' | 'critical'
    confidenceLevel: number
    businessContext: object
  }
  ```
- **OpenAI Call**: Yes (in IntentAnalyzer)

#### **Phase 2: Strategy Generation** (Lines 228-245)
- **File**: [lib/intelligence/analysis/StrategyEngine.ts](lib/intelligence/analysis/StrategyEngine.ts)
- **Purpose**: Determine best approach to execute
- **Output**:
  ```typescript
  {
    primaryApproach: string
    fallbackStrategies: string[]
    performanceOptimizations: string[]
  }
  ```

#### **Phase 3: Plugin Coordination** (Lines 247-266)
- **File**: [lib/intelligence/execution/PluginCoordinator.ts](lib/intelligence/execution/PluginCoordinator.ts)
- **Purpose**: Execute required plugins (Gmail, Drive, Slack, etc.)
- **Output**: `pluginContext` with data from each plugin
- **Example**:
  ```typescript
  {
    gmail: {
      messages: [...],  // Actual Gmail messages
      error: null
    },
    drive: {
      files: [...],     // Actual Drive files
      error: null
    }
  }
  ```

#### **Phase 4: Document Processing** (Lines 268-275)
- **File**: [lib/intelligence/execution/DocumentProcessor.ts](lib/intelligence/execution/DocumentProcessor.ts)
- **Purpose**: Process PDFs, images, etc. from input or plugin data

#### **Phase 5: Smart Prompt Generation** (Lines 277-292)
- **File**: [lib/intelligence/execution/PromptGenerator.ts](lib/intelligence/execution/PromptGenerator.ts)
- **Purpose**: Build optimized system + user prompts
- **Output**:
  ```typescript
  {
    systemPrompt: string,  // Context-aware system instructions
    userPrompt: string,    // Optimized user request with data
    strategy: string       // Execution strategy used
  }
  ```

#### **Phase 6: LLM Execution** (Lines 294-307)
- **Function**: `executeWithDataAwareIntelligence()` (Lines 523-595)
- **🔥 THIS IS WHERE OPENAI IS CALLED 🔥**
- **Model**: GPT-4o
- **Parameters**:
  ```typescript
  {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: enhancedSystemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.1 - 0.3 (based on complexity),
    max_tokens: 3000 - 4000 (based on urgency),
    top_p: 0.9,
    frequency_penalty: 0.1,
    presence_penalty: 0.1
  }
  ```

#### **Phase 7: Quality Validation** (Lines 309-384)
- **Class**: `UniversalQualityValidator` (Lines 34-152)
- **Purpose**: Check if response is actually useful
- **Features**:
  - Detects if AI processed actual data vs generic advice
  - Automatic retry if response is poor but data is good
  - Retry uses more aggressive prompting

#### **Phase 8: Output Handling** (Lines 401-408)
- **File**: [lib/intelligence/utils/EmailHandler.ts](lib/intelligence/utils/EmailHandler.ts)
- **Purpose**: Format final output, send emails if needed

---

## 🤖 OpenAI API Calls - Complete List

### 1. **Main Agent Execution**
**File**: [lib/utils/runAgentWithContext.ts:573](lib/utils/runAgentWithContext.ts#L573)
```typescript
const completion = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: enhancedSystemPrompt },
    { role: 'user', content: userPrompt }
  ],
  temperature: 0.1-0.3,
  max_tokens: 3000-4000
})
```

### 2. **Retry Execution** (if quality is poor)
**File**: [lib/utils/runAgentWithContext.ts:332](lib/utils/runAgentWithContext.ts#L332)
```typescript
const retryResponse = await executeWithDataAwareIntelligence(
  retryPrompt.systemPrompt,
  retryPrompt.userPrompt,
  intentAnalysis,
  adaptiveStrategy,
  pluginContext,
  true  // isRetry = more aggressive
)
```

### 3. **Intent Analysis**
**File**: [lib/intelligence/analysis/IntentAnalyzer.ts](lib/intelligence/analysis/IntentAnalyzer.ts)
- Analyzes user prompt to understand intent
- Uses GPT-4o to extract business context

### 4. **Recovery System** (on failure)
**File**: [lib/intelligence/execution/RecoverySystem.ts](lib/intelligence/execution/RecoverySystem.ts)
- Fallback execution when main flow fails
- Uses simpler prompting

### 5. **Plugin Suggestions**
**File**: [app/api/plugins/suggest/route.ts](app/api/plugins/suggest/route.ts)
- Suggests which plugins to use for a prompt

### 6. **Schema Generation**
**File**: [app/api/generate/input-schema/route.ts](app/api/generate/input-schema/route.ts)
- Generates input schemas for agents

### 7. **Orchestration Steps**
**File**: [app/api/orchestration/generate-steps/route.ts](app/api/orchestration/generate-steps/route.ts)
- Breaks down complex tasks into steps

---

## 🎯 Where to Implement OpenAI SDK Properly

### Current Implementation Issues

#### ❌ **Problem 1: Multiple OpenAI Instances**
Each file creates its own OpenAI client:
```typescript
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
```

#### ❌ **Problem 2: No Centralized Error Handling**
Each file handles OpenAI errors differently

#### ❌ **Problem 3: No Analytics/Tracking**
No centralized tracking of:
- Token usage
- API costs
- Response times
- Error rates

### ✅ **Recommended Solution: Centralized Provider**

You already have a good foundation in [lib/ai/providers/openaiProvider.ts](lib/ai/providers/openaiProvider.ts)!

#### **Step 1: Enhance OpenAIProvider**

```typescript
// lib/ai/providers/openaiProvider.ts
import OpenAI from 'openai';
import { BaseAIProvider, CallContext } from './baseProvider';

export class OpenAIProvider extends BaseAIProvider {
  private static instance: OpenAIProvider | null = null;
  private openai: OpenAI;

  private constructor(apiKey: string, analytics?: any) {
    super(analytics);
    this.openai = new OpenAI({ apiKey });
  }

  // Singleton pattern
  static getInstance(analytics?: any): OpenAIProvider {
    if (!OpenAIProvider.instance) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY not configured');
      }
      OpenAIProvider.instance = new OpenAIProvider(apiKey, analytics);
    }
    return OpenAIProvider.instance;
  }

  async chatCompletion(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext
  ) {
    return this.callWithTracking(
      context,
      'openai',
      params.model,
      'chat/completions',
      () => this.openai.chat.completions.create(params),
      (result) => ({
        inputTokens: result.usage?.prompt_tokens || 0,
        outputTokens: result.usage?.completion_tokens || 0,
        cost: this.calculateCost(params.model, result.usage),
        responseSize: JSON.stringify(result).length
      })
    );
  }

  // Specialized methods for common use cases
  async generateWithRetry(
    params: OpenAI.Chat.ChatCompletionCreateParams,
    context: CallContext,
    maxRetries: number = 3
  ) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.chatCompletion(params, context);
      } catch (error: any) {
        lastError = error;
        if (error?.status === 429) {
          // Rate limit - exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
          continue;
        }
        throw error; // Don't retry on other errors
      }
    }
    throw lastError;
  }

  private calculateCost(model: string, usage: any): number {
    const pricing = {
      'gpt-4o': { input: 0.0025, output: 0.01 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.001, output: 0.002 }
    };

    const modelPricing = pricing[model] || pricing['gpt-3.5-turbo'];

    return (
      (usage?.prompt_tokens || 0) * modelPricing.input / 1000 +
      (usage?.completion_tokens || 0) * modelPricing.output / 1000
    );
  }
}
```

#### **Step 2: Replace Direct OpenAI Calls**

**Before** (in runAgentWithContext.ts):
```typescript
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const completion = await openai.chat.completions.create(modelParams)
```

**After**:
```typescript
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider'

const openaiProvider = OpenAIProvider.getInstance()

const completion = await openaiProvider.chatCompletion(modelParams, {
  agentId: agent.id,
  userId: userId,
  executionId: executionId,
  phase: 'main_execution'
})
```

#### **Step 3: Add Analytics Collection**

```typescript
// lib/ai/analytics/aiAnalytics.ts
export class AIAnalytics {
  async trackCall(data: {
    agentId: string
    userId: string
    executionId: string
    phase: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
    latency: number
    success: boolean
    error?: string
  }) {
    // Store in Supabase ai_analytics table
    await supabase.from('ai_analytics').insert(data)
  }

  async getAgentCosts(agentId: string, days: number = 30) {
    // Query analytics for cost insights
  }
}
```

---

## 📊 Execution Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  User Triggers Agent                                        │
│  • Manual: POST /api/run-agent                              │
│  • Scheduled: Vercel Cron → /api/run-scheduled-agents       │
│  • Queued: QStash → /api/cron/process-queue                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  runAgentWithContext() - Main Orchestrator                  │
│  📁 lib/utils/runAgentWithContext.ts                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 1: Intent Analysis                                    │
│  🤖 OpenAI Call #1 - Analyze user intent                     │
│  📁 lib/intelligence/analysis/IntentAnalyzer.ts              │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 2: Strategy Generation                                │
│  📁 lib/intelligence/analysis/StrategyEngine.ts              │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 3: Plugin Coordination                                │
│  • Execute Gmail, Drive, Slack, etc.                         │
│  • Collect real data from user's accounts                    │
│  📁 lib/intelligence/execution/PluginCoordinator.ts          │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 4: Document Processing                                │
│  📁 lib/intelligence/execution/DocumentProcessor.ts          │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 5: Smart Prompt Generation                            │
│  • Build context-aware system prompt                         │
│  • Inject plugin data into user prompt                       │
│  📁 lib/intelligence/execution/PromptGenerator.ts            │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 6: LLM Execution (MAIN OPENAI CALL)                   │
│  🤖 OpenAI Call #2 - Execute with GPT-4o                     │
│  • Model: gpt-4o                                             │
│  • Temperature: 0.1-0.3                                      │
│  • Max Tokens: 3000-4000                                     │
│  📁 lib/utils/runAgentWithContext.ts:573                     │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 7: Quality Validation                                 │
│  • Check if response is useful                               │
│  • If poor quality + good data exists:                       │
│    🤖 OpenAI Call #3 - Retry with aggressive prompt          │
│  📁 lib/utils/runAgentWithContext.ts:309-384                 │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Phase 8: Output Handling                                    │
│  • Format response                                           │
│  • Send email if configured                                  │
│  📁 lib/intelligence/utils/EmailHandler.ts                   │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Return Result to User                                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 Key Files to Modify for OpenAI SDK Implementation

### Priority 1: Core Execution
1. **[lib/utils/runAgentWithContext.ts](lib/utils/runAgentWithContext.ts)** - Main execution (2-3 OpenAI calls)
2. **[lib/intelligence/analysis/IntentAnalyzer.ts](lib/intelligence/analysis/IntentAnalyzer.ts)** - Intent analysis (1 OpenAI call)
3. **[lib/intelligence/execution/RecoverySystem.ts](lib/intelligence/execution/RecoverySystem.ts)** - Fallback execution (1 OpenAI call)

### Priority 2: Helper Functions
4. **[app/api/plugins/suggest/route.ts](app/api/plugins/suggest/route.ts)** - Plugin suggestions
5. **[app/api/generate/input-schema/route.ts](app/api/generate/input-schema/route.ts)** - Schema generation
6. **[app/api/orchestration/generate-steps/route.ts](app/api/orchestration/generate-steps/route.ts)** - Step generation

### Priority 3: Provider Enhancement
7. **[lib/ai/providers/openaiProvider.ts](lib/ai/providers/openaiProvider.ts)** - Centralized OpenAI client

---

## 💡 Benefits of Centralized OpenAI Provider

1. **Single Source of Truth** - One OpenAI client instance
2. **Automatic Tracking** - Track all API calls, tokens, costs
3. **Error Handling** - Consistent retry logic and error handling
4. **Rate Limiting** - Built-in exponential backoff
5. **Cost Monitoring** - Real-time cost tracking per agent/user
6. **Performance Insights** - Analyze which prompts are expensive
7. **A/B Testing** - Easy to test different models/parameters
8. **Debugging** - Centralized logging of all LLM interactions

---

## 🔍 Next Steps

1. **Enhance OpenAIProvider** with singleton pattern and retry logic
2. **Create AIAnalytics service** to track usage
3. **Replace direct OpenAI calls** in runAgentWithContext.ts first
4. **Add Supabase table** for ai_analytics
5. **Build dashboard** to visualize costs and performance
6. **Implement caching** for common prompts (optional)
7. **Add streaming support** for long responses (optional)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-27 | AgentsPilot cron schedules retired | `/api/run-scheduled-agents`, `/api/cron/update-template-scores` and `/api/cron/memory-consolidation` removed from `vercel.json` (admin reorganisation slice 5, part A; OQ-4). Code kept; re-enable by re-adding the `vercel.json` entry. See [ADMIN_MODULE_BOS_REORGANISATION_SLICE5_WORKPLAN.md](/docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE5_WORKPLAN.md) §4 |
