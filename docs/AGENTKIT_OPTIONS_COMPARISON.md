# AgentKit Agent Generation - Options Comparison

## Overview

We've implemented two approaches for intelligent agent generation using AgentKit:

- **Option 1 (V2)**: Custom GPT-4o Analysis with Plugin Context
- **Option 2 (V2-SDK)**: AgentKit SDK Native Planning with Function Calling

Both are now live and can be tested! The system tries Option 2 first, then falls back to Option 1, then V1.

---

## Option 1: Custom GPT-4o Analysis (V2)

### Files:
- `/lib/agentkit/analyzePrompt.ts` (main implementation)
- `/lib/agentkit/analyzePrompt-v1-backup.ts` (backup)
- `/app/api/generate-agent-v2/route.ts`

### How it Works:
1. Fetch user's connected plugins from database
2. Load full plugin definitions (name, description, actions, parameters)
3. Send enhanced prompt to GPT-4o with:
   - User prompt
   - Available plugins context (JSON)
   - Strict rules ("ONLY suggest plugins explicitly mentioned")
   - Examples of correct detection
4. GPT-4o returns structured JSON with:
   - Agent name, description
   - Suggested plugins
   - Required inputs
   - Workflow steps with reasoning
5. Validate suggested plugins against available list
6. Return structured analysis

### Pros:
✅ Full control over prompt engineering
✅ Can add detailed examples and rules
✅ Plugin context is explicit and comprehensive
✅ Easy to debug and tune
✅ Can enforce strict "no random defaults" rules

### Cons:
⚠️ Custom implementation to maintain
⚠️ Requires manual prompt engineering
⚠️ Two-step process (our analysis + AgentKit execution)

### Example Logs:
```
🧠 AgentKit: Analyzing prompt for intelligent agent generation
📦 Available plugins: google-mail, chatgpt-research, google-sheets
📊 AGENTKIT ANALYSIS - RAW RESPONSE:
{
  "agent_name": "Email Summarizer",
  "suggested_plugins": ["google-mail", "chatgpt-research"],
  "confidence": 0.95
}
✅ AGENTKIT ANALYSIS RESULT: { workflow_type: 'ai_external_actions', ... }
```

---

## Option 2: AgentKit SDK Native Planning (V2-SDK)

### Files:
- `/lib/agentkit/analyzePrompt-v2-sdk.ts`
- `/app/api/generate-agent-v2-sdk/route.ts`

### How it Works:
1. Fetch user's connected plugins from database
2. Convert plugins to OpenAI tools using `convertPluginsToTools()`
   - Same conversion used during agent execution
   - Ensures planning matches execution capabilities
3. Send planning prompt to OpenAI with tools available
4. Ask OpenAI to PLAN (not execute) the workflow
5. OpenAI responds with tool_calls (the planned steps)
6. Extract workflow from tool_calls:
   - Each tool_call becomes a workflow step
   - Parse parameters to identify missing inputs
   - Infer workflow type from tools used
7. Return structured analysis

### Pros:
✅ Uses AgentKit's native function calling intelligence
✅ Planning matches execution (same tool conversion)
✅ Simpler - leverage OpenAI's built-in capabilities
✅ Consistent with execution engine
✅ Automatically detects missing parameters

### Cons:
⚠️ Less control over strict "no defaults" enforcement
⚠️ Relies on OpenAI's function calling behavior
⚠️ Harder to add custom rules/examples

### Example Logs:
```
🧠 AgentKit SDK: Planning workflow for prompt
🔧 AgentKit SDK: Loaded 15 available actions
🎯 AgentKit SDK: Requesting workflow plan from GPT-4o...
📊 AGENTKIT SDK PLANNING - RESPONSE:
{
  has_tool_calls: true,
  tool_calls_count: 3
}
✅ AGENTKIT SDK ANALYSIS RESULT: { workflow_type: 'ai_external_actions', ... }
```

---

## Current Cascade System

The frontend now tries all three in order:

```typescript
// 1. Try V2-SDK (Option 2) - AgentKit Native Planning
fetch('/api/generate-agent-v2-sdk')
  ↓ if fails
// 2. Try V2 (Option 1) - Custom Analysis
fetch('/api/generate-agent-v2')
  ↓ if fails
// 3. Try V1 - Original GPT-based
fetch('/api/generate-agent')
```

### Console Logs Show Which Was Used:
```
versionUsed: 'v2-sdk'  // Option 2 succeeded
versionUsed: 'v2'      // Option 2 failed, Option 1 succeeded
versionUsed: 'v1'      // Both failed, V1 fallback succeeded
```

---

## Testing Recommendations

### Test Cases:

1. **Simple Pure AI**:
   - Prompt: "Summarize this text"
   - Expected: NO plugins, pure AI processing
   - Tests: Strict "no defaults" enforcement

2. **Explicit Plugin Mention**:
   - Prompt: "Read my last 10 emails and send a summary to google sheet"
   - Expected: google-mail, google-sheets
   - Tests: Plugin detection accuracy

3. **Missing Inputs**:
   - Prompt: "Send to my sheet"
   - Expected: google-sheets + input for sheet_id/sheet_name
   - Tests: Input schema detection (CRITICAL DIFFERENCE)

4. **Platform Plugins**:
   - Prompt: "Research AI trends"
   - Expected: chatgpt-research (no connection required)
   - Tests: Platform plugin auto-include

### Key Comparison: Input Schema Detection

**Option 1 (Custom)**: Relies on GPT understanding parameter requirements from JSON context
**Option 2 (SDK)**: Extracts from actual tool_calls with parsed parameters

Option 2 should be BETTER at detecting missing inputs because it sees the actual function signatures.

---

## Recommendation

After testing both, we should choose based on:

1. **Accuracy**: Which one avoids random plugin defaults better?
2. **Input Detection**: Which one correctly identifies missing inputs (sheet_id, etc.)?
3. **Consistency**: Which one produces more consistent results across similar prompts?
4. **Maintainability**: Which one is easier to tune and improve?

**My prediction**: Option 2 will be better at input detection because it uses actual function calling mechanics.

---

## Next Steps

1. ✅ Both implementations complete
2. ✅ Cascade fallback system in place
3. ⏳ Test with real prompts and compare results
4. ⏳ Measure which version is used most often
5. ⏳ Decide which to keep as primary

The beauty of this setup: We can A/B test in production and see which works better! 🚀
