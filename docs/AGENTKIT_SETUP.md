# 🤖 AgentKit Integration - Setup Guide

## Overview
AgentKit integrates OpenAI's function calling capabilities with your V2 Plugin System, providing a simpler and more powerful alternative to the legacy 8-phase orchestration pipeline.

---

## 🏗️ Architecture

### What is AgentKit?
AgentKit uses **OpenAI's native function calling** to orchestrate agent executions:
- Converts V2 plugin actions → OpenAI functions
- OpenAI decides which plugins to call and when
- Automatic parameter extraction from natural language
- Built-in retry logic and error handling

### Key Components

1. **`/lib/agentkit/agentkitClient.ts`**
   - Singleton OpenAI client
   - Configuration (model: gpt-4o, max iterations, timeout)

2. **`/lib/agentkit/convertPlugins.ts`**
   - Converts V2 plugin definitions to OpenAI tools
   - Uses `PluginManagerV2.getUserActionablePlugins()` for connected plugins
   - Generates plugin context for system prompt

3. **`/lib/agentkit/runAgentKit.ts`**
   - Main execution orchestrator
   - Function calling loop with V2 PluginExecuterV2
   - Token tracking and analytics

---

## 📦 Database Setup

### 1. Create AgentKit Analytics Table

Run this SQL in your Supabase SQL Editor:

```sql
-- AgentKit Analytics Table
CREATE TABLE IF NOT EXISTS agentkit_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  execution_id TEXT,
  tokens_used JSONB NOT NULL,
  tool_calls INTEGER DEFAULT 0,
  iterations INTEGER DEFAULT 0,
  execution_time_ms INTEGER,
  success BOOLEAN DEFAULT false,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_agentkit_agent_id ON agentkit_analytics(agent_id);
CREATE INDEX idx_agentkit_user_id ON agentkit_analytics(user_id);
CREATE INDEX idx_agentkit_created_at ON agentkit_analytics(created_at);

-- Enable Row Level Security
ALTER TABLE agentkit_analytics ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own analytics
CREATE POLICY "Users can view own agentkit analytics"
  ON agentkit_analytics FOR SELECT
  USING (auth.uid() = user_id);
```

### 2. Agent Configurations (Already Exists)

AgentKit automatically uses the `agent_configurations` table to fetch input values:

- **`input_values`**: JSONB containing actual values for agent execution
- **`input_schema`**: JSONB schema definition (fallback if not in agents table)

AgentKit will:
1. Fetch the most recent `agent_configurations` for the agent + user
2. Extract `input_values` (e.g., `{"recipient_email": "john@example.com", "subject": "Hello"}`)
3. Include these values in the OpenAI prompt context
4. OpenAI uses them when calling plugin functions

---

## 🚀 Usage

### Option 1: Direct API Call

```typescript
// POST /api/run-agent
{
  "agent_id": "your-agent-id",
  "use_agentkit": true,  // Enable AgentKit
  "override_user_prompt": "Send an email to john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Email sent successfully to john@example.com",
  "data": {
    "agent_id": "...",
    "execution_type": "agentkit",
    "tool_calls_count": 1,
    "successful_tool_calls": 1,
    "failed_tool_calls": 0,
    "tokens_used": 1250,
    "execution_time_ms": 3500,
    "iterations": 1
  },
  "agentkit": true
}
```

### Option 2: Queue-Based (QStash)

```typescript
// POST /api/run-agent
{
  "agent_id": "your-agent-id",
  "use_queue": true,       // Use QStash queue
  "use_agentkit": true,    // Execute with AgentKit
  "override_user_prompt": "Summarize my last 10 emails"
}
```

The job will be queued in QStash and executed by `/api/cron/process-queue`.

---

## 🔍 How It Works

### Execution Flow

```
User Request → runAgentKit()
  ↓
1. Fetch agent_configurations (input_values)
   - Get most recent configuration for agent + user
   - Extract input values: {"email": "john@example.com", "subject": "Hello"}
  ↓
2. Load V2 Plugin Definitions (PluginManagerV2)
  ↓
3. Convert Actions → OpenAI Functions
   - google-mail__send_email
   - google-mail__search_emails
   - google-drive__upload_file
   - etc.
  ↓
4. Build Enhanced System Prompt + User Message
   - Agent's system_prompt
   - Plugin context (descriptions, available actions)
   - User message + input values context
   - Execution instructions
  ↓
5. OpenAI Function Calling Loop (max 10 iterations)
   ↓
   OpenAI decides: "I need to call google-mail__search_emails"
   ↓
   PluginExecuterV2.execute(userId, 'google-mail', 'search_emails', params)
   ↓
   GmailPluginExecutor.executeSpecificAction()
   ↓
   Gmail API call
   ↓
   Return results to OpenAI
   ↓
   OpenAI: "Based on the emails, I'll now call google-mail__send_email"
   ↓
   ... repeat until task complete ...
  ↓
5. Final Response to User
```

### Example Execution Log

```
🤖 AgentKit: Starting execution for "Email Assistant"
📦 Required plugins: google-mail, google-drive
📋 AgentKit: Found 3 input values from configuration
🔧 AgentKit: Loaded 6 available actions across 2 plugins
🔄 AgentKit: Iteration 1/10
🔌 AgentKit: Executing 1 tool call(s)...
  → google-mail.search_emails(query, max_results)
    ✓ Success: Found 10 emails matching query
🔄 AgentKit: Iteration 2/10
🔌 AgentKit: Executing 1 tool call(s)...
  → google-mail.send_email(recipients, content)
    ✓ Success: Email sent successfully to 1 recipients
✅ AgentKit: Completed in 2 iterations
💰 Tokens used: 1847 (1023 prompt + 824 completion)
```

---

## 🎯 Advantages vs Legacy System

| Feature | Legacy (8-Phase) | AgentKit |
|---------|-----------------|----------|
| **Orchestration** | Custom 2000+ lines | OpenAI native |
| **Plugin Integration** | Manual coordination | Automatic function calling |
| **Multi-step Tasks** | Complex logic required | OpenAI handles automatically |
| **Error Handling** | Custom retry logic | Built-in |
| **Conditional Logic** | Hard-coded | OpenAI decides dynamically |
| **Lines of Code** | ~2000 | ~300 |
| **API Calls** | 2-3 (intent, execution, quality) | 1-N (as needed) |
| **Token Usage** | Higher (multiple calls) | Optimized (single conversation) |

---

## 🔧 Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# V2 Plugin System (already configured)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SLACK_CLIENT_ID=...
# ... etc
```

### AgentKit Settings

In `/lib/agentkit/agentkitClient.ts`:

```typescript
export const AGENTKIT_CONFIG = {
  model: "gpt-4o",           // OpenAI model to use
  temperature: 0.1,          // Lower = more deterministic
  maxIterations: 10,         // Max function calling loops
  timeout: 120000,           // 2 minutes
};
```

---

## 📊 Monitoring & Analytics

### View Agent Execution Stats

```sql
-- Total AgentKit executions
SELECT COUNT(*) as total_executions
FROM agent_executions
WHERE logs->>'agentkit' = 'true';

-- Average tokens per execution
SELECT
  agent_id,
  AVG((logs->'tokensUsed'->>'total')::int) as avg_tokens,
  AVG(execution_duration_ms) as avg_duration_ms
FROM agent_executions
WHERE logs->>'agentkit' = 'true'
GROUP BY agent_id;

-- Tool call distribution
SELECT
  tc->>'plugin' as plugin,
  tc->>'action' as action,
  COUNT(*) as call_count
FROM agent_executions,
  jsonb_array_elements(logs->'toolCalls') as tc
WHERE logs->>'agentkit' = 'true'
GROUP BY plugin, action
ORDER BY call_count DESC;
```

---

## 🧪 Testing

### Test with a Simple Agent

1. Create an agent with Gmail plugin connected
2. Call the API:

```bash
curl -X POST https://your-app.vercel.app/api/run-agent \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "your-agent-id",
    "use_agentkit": true,
    "override_user_prompt": "Search for emails from john@example.com in the last week"
  }'
```

3. Check the response for:
   - ✅ `success: true`
   - ✅ `tool_calls_count > 0`
   - ✅ Meaningful response message

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "No plugins are connected"
**Cause**: User hasn't connected required plugins in Settings
**Fix**: Go to Settings → Connected Apps and connect the required plugins

#### 2. "Plugin execution failed"
**Cause**: Token expired or invalid credentials
**Fix**: V2 system auto-refreshes tokens, but if it fails, reconnect in Settings

#### 3. "MAX_ITERATIONS_REACHED"
**Cause**: Task is too complex (>10 function calls needed)
**Fix**:
- Break task into smaller pieces
- Increase `maxIterations` in config
- Check if there's a circular loop

#### 4. High token usage
**Cause**: Complex multi-step tasks or large plugin responses
**Fix**:
- Optimize plugin response size
- Use more specific prompts
- Consider pagination for large datasets

---

## 🚦 Migration Strategy

### Phase 1: Testing (Week 1)
- AgentKit available via `use_agentkit` flag
- Test manually with select agents
- Monitor logs and metrics

### Phase 2: Gradual Rollout (Week 2-3)
- Enable for new agents by default
- Allow existing agents to opt-in
- A/B test performance

### Phase 3: Full Migration (Week 4+)
- Make AgentKit default for all manual executions
- Keep legacy system for backward compatibility
- Eventually deprecate legacy system

---

## 📚 API Reference

### `runAgentKit(userId, agent, userInput)`

**Parameters:**
- `userId` (string): User ID for plugin connections
- `agent` (object): Agent configuration
  - `id`: Agent ID
  - `agent_name`: Display name
  - `system_prompt`: System instructions
  - `enhanced_prompt`: Enhanced prompt (fallback)
  - `user_prompt`: User's original prompt (fallback)
  - `plugins_required`: Array of plugin keys
- `userInput` (string): User's input/request

**Returns:**
```typescript
{
  success: boolean
  response: string
  toolCalls: Array<{
    plugin: string
    action: string
    parameters: any
    result: any
    success: boolean
  }>
  tokensUsed: {
    prompt: number
    completion: number
    total: number
  }
  executionTime: number
  iterations: number
  error?: string
}
```

---

## 🎓 Best Practices

1. **Clear System Prompts**: Be specific about what the agent should do
2. **Connected Plugins Only**: Ensure required plugins are connected before execution
3. **Monitor Token Usage**: Track costs, especially for high-frequency agents
4. **Error Handling**: Always check `success` field in response
5. **Test Incrementally**: Start with simple single-plugin tasks

---

## 🔗 Related Files

- [/lib/agentkit/](../lib/agentkit/) - Core AgentKit implementation
- [/lib/server/plugin-manager-v2.ts](../lib/server/plugin-manager-v2.ts) - V2 Plugin Manager
- [/lib/server/plugin-executer-v2.ts](../lib/server/plugin-executer-v2.ts) - Plugin Executor
- [/app/api/run-agent/route.ts](../app/api/run-agent/route.ts) - Execution API
- [/app/api/cron/process-queue/route.ts](../app/api/cron/process-queue/route.ts) - Queue processor

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review execution logs in Supabase `agent_executions` table
3. Check AgentKit analytics for patterns
4. Review OpenAI API logs for function calling details
