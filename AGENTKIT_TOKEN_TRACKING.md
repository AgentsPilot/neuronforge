# AgentKit Token Usage Tracking

## Overview

AgentKit now integrates with the **AI Analytics Service** to automatically track token usage, costs, and performance metrics for every OpenAI API call made during agent execution.

## What Gets Tracked

Every time an agent runs using AgentKit, the following data is automatically logged to the `token_usage` table:

### Basic Metrics
- **Tokens Used**: Input tokens, output tokens, and total tokens per iteration
- **Cost**: Calculated cost in USD based on GPT-4o pricing
- **Latency**: API response time in milliseconds
- **Success/Failure**: Whether the API call succeeded or failed

### Context & Categorization
- **User ID**: Which user triggered the execution
- **Session ID**: Unique identifier linking all iterations of a single agent run
- **Agent ID**: Which agent was executed
- **Feature**: `agentkit_execution`
- **Component**: `run-agentkit`
- **Workflow Step**: `iteration_1`, `iteration_2`, etc.
- **Category**: `agent_execution`

### Activity Tracking
- **Activity Type**: `agent_execution`
- **Activity Name**: `Executing agent: {agent_name}`
- **Activity Step**: `iteration_1_of_10`, etc.

## Architecture

### Components

1. **AIAnalyticsService** ([lib/analytics/aiAnalytics.ts](lib/analytics/aiAnalytics.ts))
   - Core service for tracking AI API calls
   - Inserts data into `token_usage` Supabase table
   - Provides analytics query methods

2. **OpenAIProvider** ([lib/ai/providers/openaiProvider.ts](lib/ai/providers/openaiProvider.ts))
   - Wrapper around OpenAI SDK
   - Automatically tracks all chat completion calls
   - Calculates costs using GPT-4o pricing model
   - Ensures streaming is disabled for accurate token counting

3. **BaseAIProvider** ([lib/ai/providers/baseProvider.ts](lib/ai/providers/baseProvider.ts))
   - Abstract base class for all AI providers
   - Implements `callWithTracking()` method
   - Handles success/failure tracking
   - Measures latency and response size

### Integration Points

#### 1. AgentKit Execution ([lib/agentkit/runAgentKit.ts](lib/agentkit/runAgentKit.ts))

```typescript
// Initialize analytics and provider
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
});

const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics);

// Execute with tracking
const completion = await openaiProvider.chatCompletion(
  {
    model: AGENTKIT_CONFIG.model,
    messages: messages,
    tools: tools,
    tool_choice: "auto",
    temperature: AGENTKIT_CONFIG.temperature,
  },
  {
    userId: userId,
    sessionId: sessionId,
    feature: 'agentkit_execution',
    component: 'run-agentkit',
    workflow_step: `iteration_${iteration}`,
    category: 'agent_execution',
    activity_type: 'agent_execution',
    activity_name: `Executing agent: ${agent.agent_name}`,
    agent_id: agent.id,
    activity_step: `iteration_${iteration}_of_${AGENTKIT_CONFIG.maxIterations}`
  }
);
```

#### 2. API Routes

**[app/api/run-agent/route.ts](app/api/run-agent/route.ts)**
- Generates unique `sessionId` for each execution
- Passes sessionId to `runAgentKit()`

**[app/api/cron/process-queue/route.ts](app/api/cron/process-queue/route.ts)**
- Also generates sessionId for queued executions
- Same tracking as manual executions

## Data Flow

```
User triggers agent
    ↓
Generate sessionId
    ↓
runAgentKit() called with sessionId
    ↓
For each iteration:
    ↓
OpenAIProvider.chatCompletion()
    ↓
BaseAIProvider.callWithTracking()
    ↓
Execute OpenAI API call
    ↓
Extract metrics (tokens, cost, latency)
    ↓
AIAnalyticsService.trackAICall()
    ↓
Insert to token_usage table
```

## Session ID Format

```
session_{timestamp}_{random9chars}
```

Example: `session_1704123456789_a3b9c4d7e`

This allows you to query all API calls from a single agent execution by filtering on `session_id`.

## Cost Calculation

### Pricing (per 1K tokens)

| Model | Input | Output |
|-------|-------|--------|
| gpt-4o | $0.0025 | $0.01 |
| gpt-4 | $0.03 | $0.06 |
| gpt-3.5-turbo | $0.001 | $0.002 |

### Formula

```typescript
cost = (prompt_tokens × input_price / 1000) + (completion_tokens × output_price / 1000)
```

## Example Usage Analytics

### Query all calls from a session

```sql
SELECT
  workflow_step,
  input_tokens,
  output_tokens,
  cost_usd,
  latency_ms,
  created_at
FROM token_usage
WHERE session_id = 'session_1704123456789_a3b9c4d7e'
ORDER BY created_at;
```

### Get total cost per agent

```sql
SELECT
  agent_id,
  COUNT(*) as total_calls,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(cost_usd) as total_cost,
  AVG(latency_ms) as avg_latency
FROM token_usage
WHERE activity_type = 'agent_execution'
GROUP BY agent_id;
```

### Get user's total spend

```sql
SELECT
  user_id,
  SUM(cost_usd) as total_cost,
  COUNT(*) as total_api_calls,
  SUM(input_tokens + output_tokens) as total_tokens
FROM token_usage
WHERE user_id = 'user-uuid'
  AND created_at >= NOW() - INTERVAL '30 days';
```

## Comparison with enhance-prompt API

AgentKit uses the **same analytics system** as the prompt enhancement API:

| Feature | enhance-prompt | AgentKit |
|---------|---------------|----------|
| Service | AIAnalyticsService | AIAnalyticsService |
| Provider | OpenAIProvider | OpenAIProvider |
| Feature Flag | `prompt_enhancement` | `agentkit_execution` |
| Component | `enhance-prompt-api` | `run-agentkit` |
| Activity Type | `agent_creation` | `agent_execution` |
| Session Tracking | ✅ | ✅ |
| Agent Tracking | ✅ | ✅ |
| Cost Tracking | ✅ | ✅ |

## Benefits

1. **Cost Transparency**: See exactly how much each agent execution costs
2. **Performance Monitoring**: Track API latency and optimize slow agents
3. **Usage Analysis**: Understand token consumption patterns
4. **Debugging**: Session-based tracking links all iterations together
5. **Billing**: Accurate cost data for charging users or tracking budgets
6. **Analytics**: Rich data for dashboards and reports

## Console Logging

When an agent runs, you'll see console logs like:

```
📊 Starting AI call tracking: {
  user_id: 'user-123',
  feature: 'agentkit_execution',
  component: 'run-agentkit',
  model: 'gpt-4o',
  cost: 0.00234,
  activity_type: 'agent_execution'
}

📊 Inserting to token_usage table: {
  call_id: 'call_1704123456_abc123',
  user_id: 'user-123',
  model_name: 'gpt-4o',
  feature: 'agentkit_execution',
  component: 'run-agentkit',
  activity_type: 'agent_execution',
  cost_usd: 0.00234,
  success: true
}

✅ AI call tracked successfully in database
```

## Future Enhancements

- Real-time cost alerts when execution exceeds budget
- Per-user monthly cost limits
- Cost optimization suggestions
- Token usage trends dashboard
- Comparison of AgentKit vs legacy system costs
- Model performance comparison (GPT-4o vs GPT-4)

## Related Files

- [lib/agentkit/runAgentKit.ts](lib/agentkit/runAgentKit.ts) - Main AgentKit execution with tracking
- [lib/analytics/aiAnalytics.ts](lib/analytics/aiAnalytics.ts) - Core analytics service
- [lib/ai/providers/openaiProvider.ts](lib/ai/providers/openaiProvider.ts) - OpenAI provider wrapper
- [lib/ai/providers/baseProvider.ts](lib/ai/providers/baseProvider.ts) - Base provider with tracking
- [app/api/run-agent/route.ts](app/api/run-agent/route.ts) - Manual execution endpoint
- [app/api/cron/process-queue/route.ts](app/api/cron/process-queue/route.ts) - Queue processing endpoint
- [app/api/enhance-prompt/route.ts](app/api/enhance-prompt/route.ts) - Example of same tracking system
