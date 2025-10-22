# AgentKit Debug Logging Guide

## Overview
Comprehensive debug logging has been added to AgentKit to track exactly what data flows through the OpenAI SDK integration.

## Debug Logs Added

### 1. **Tools Available** (Startup)
```
📊 AGENTKIT DEBUG - TOOLS AVAILABLE:
[
  {
    "type": "function",
    "function": {
      "name": "google-mail__search_emails",
      "description": "[Send, read, and manage Gmail emails] When user wants to find...",
      "parameters": {
        "type": "object",
        "required": [],
        "properties": { ... }
      }
    }
  },
  ...
]
```
**Shows:** All OpenAI functions available to the AI

### 2. **System Prompt** (Before Execution)
```
📊 AGENTKIT DEBUG - SYSTEM PROMPT:
Summarize my last 10 emails

# Connected Services
...

## Instructions
- Use the available functions to accomplish the user's request
- Do NOT provide generic advice or suggestions
...

## IMPORTANT: Result Delivery
- After completing the task, you MUST send the results via email...
```
**Shows:** Complete prompt sent to OpenAI including delivery instructions

### 3. **User Input** (Before Execution)
```
📊 AGENTKIT DEBUG - USER INPUT:
Summarize my last 10 emails

## Available Input Data:
- **email**: offir.omer@gmail.com
- **max_results**: 10
```
**Shows:** User request + input values from agent_configurations table

### 4. **Input Values** (Before Execution)
```
📊 AGENTKIT DEBUG - INPUT VALUES:
{
  "email": "offir.omer@gmail.com",
  "max_results": 10
}
```
**Shows:** Raw input values from agent_configurations

### 5. **Agent Configuration** (Before Execution)
```
📊 AGENTKIT DEBUG - AGENT CONFIG:
{
  "agent_id": "832a8039-d864-4d25-bdbb-23c02db5b810",
  "agent_name": "Email Summary Agent",
  "plugins_required": ["google-mail"],
  "trigger_condintion": {
    "error_handling": {
      "on_failure": "email"
    }
  },
  "input_schema": {...},
  "output_schema": {...}
}
```
**Shows:** Full agent configuration from database

### 6. **OpenAI Request** (Each Iteration)
```
📊 AGENTKIT DEBUG - OPENAI REQUEST:
{
  "model": "gpt-4o",
  "temperature": 0.1,
  "tools_count": 3,
  "messages_count": 2,
  "iteration": 1
}
```
**Shows:** Request metadata sent to OpenAI

### 7. **OpenAI Response** (Each Iteration)
```
📊 AGENTKIT DEBUG - OPENAI RESPONSE:
{
  "has_content": false,
  "content_length": 0,
  "has_tool_calls": true,
  "tool_calls_count": 1,
  "tokens_used": {
    "prompt_tokens": 2847,
    "completion_tokens": 15,
    "total_tokens": 2862
  }
}
```
**Shows:** What OpenAI returned (function calls or final response)

### 8. **Tool Call Details** (Each Tool Call)
```
📊 AGENTKIT DEBUG - TOOL CALL:
{
  "plugin": "google-mail",
  "action": "search_emails",
  "parameters": {
    "query": "in:inbox",
    "max_results": 10
  },
  "tool_call_id": "call_abc123"
}
```
**Shows:** Exact parameters OpenAI decided to use

### 9. **Tool Call Parameters** (Each Tool Call)
```
📊 AGENTKIT DEBUG - TOOL CALL PARAMS:
{
  "query": "in:inbox",
  "max_results": 10,
  "folder": "inbox"
}
```
**Shows:** Formatted parameters being sent to plugin

### 10. **Plugin Result** (Each Tool Call)
```
📊 AGENTKIT DEBUG - PLUGIN RESULT:
{
  "success": true,
  "data": {
    "emails": [...],
    "total_found": 10,
    "search_query": "in:inbox"
  },
  "message": "Found 10 emails matching your search"
}
```
**Shows:** What the plugin returned to OpenAI

### 11. **Final Response** (Completion)
```
📊 AGENTKIT DEBUG - FINAL RESPONSE:
The summary of your last 10 emails has been successfully sent to your email address (offir.omer@gmail.com).
```
**Shows:** Final message OpenAI generated after all tool calls

## How to Use

### Running an Agent
1. Open browser console (F12)
2. Run an agent with AgentKit enabled
3. Watch real-time debug output
4. All logs prefixed with `📊 AGENTKIT DEBUG`

### Example Full Flow

```
🤖 AgentKit: Starting execution for "Email Summary Agent"
📦 Required plugins: google-mail
👤 User: 08456106-aa50-4810-b12c-7ca84102da31

📊 AGENTKIT DEBUG - TOOLS AVAILABLE: [...]
📊 AGENTKIT DEBUG - SYSTEM PROMPT: ...
📊 AGENTKIT DEBUG - USER INPUT: ...
📊 AGENTKIT DEBUG - INPUT VALUES: {...}
📊 AGENTKIT DEBUG - AGENT CONFIG: {...}

🔄 AgentKit: Iteration 1/10
📊 AGENTKIT DEBUG - OPENAI REQUEST: {...}
📊 AGENTKIT DEBUG - OPENAI RESPONSE: {...}

🔌 AgentKit: Executing 1 tool call(s)...
  → google-mail.search_emails(query, max_results)
📊 AGENTKIT DEBUG - TOOL CALL: {...}
📊 AGENTKIT DEBUG - TOOL CALL PARAMS: {...}
📊 AGENTKIT DEBUG - PLUGIN RESULT: {...}
    ✓ Success: Found 10 emails matching your search

🔄 AgentKit: Iteration 2/10
📊 AGENTKIT DEBUG - OPENAI REQUEST: {...}
📊 AGENTKIT DEBUG - OPENAI RESPONSE: {...}

✅ AgentKit: Completed in 2 iterations
💰 Tokens used: 9321 (8373 prompt + 948 completion)
📊 AGENTKIT DEBUG - FINAL RESPONSE: ...
```

## What You Can Debug

### ✅ Input Verification
- Check if agent_configurations data is being loaded
- Verify trigger_condintion settings
- Confirm input_schema and output_schema

### ✅ Prompt Engineering
- See exact system prompt sent to OpenAI
- Verify delivery instructions (email vs dashboard)
- Check plugin context descriptions

### ✅ Function Calling
- See which tools OpenAI has available
- Track which functions OpenAI decides to call
- Verify parameter values chosen by OpenAI

### ✅ Plugin Execution
- See exact parameters sent to plugins
- View plugin responses
- Track validation failures

### ✅ Token Usage
- Monitor token consumption per iteration
- See prompt vs completion token split
- Track total cost

### ✅ Error Diagnosis
- See where validation fails
- Track OpenAI's retry logic
- Identify missing parameters

## Filtering Console Output

In browser console, filter by:
- `AGENTKIT DEBUG` - See only debug logs
- `TOOL CALL` - See only function call data
- `PLUGIN RESULT` - See only plugin responses
- `OPENAI` - See only OpenAI request/response

## Performance Impact

⚠️ **Warning:** Debug logging outputs large JSON objects
- Adds ~10-20ms overhead per log
- Console can get cluttered with large objects
- Consider disabling in production

## Disabling Debug Logs

To disable, comment out or remove lines containing:
```typescript
console.log('\n📊 AGENTKIT DEBUG - ...')
```

Or add a debug flag:
```typescript
const DEBUG = process.env.AGENTKIT_DEBUG === 'true';
if (DEBUG) console.log('...');
```

## Key Files

- **`/lib/agentkit/runAgentKit.ts`** - Main debug logging location
- Lines 87, 123, 148-157, 169-175, 195-201, 208, 243, 260

## Next Steps

After debugging:
1. Review console output for issues
2. Check parameter flow through the system
3. Verify OpenAI is receiving correct context
4. Confirm plugin responses are properly formatted
5. Optimize prompts based on function call patterns
