# Orchestrator Logging Unification

**Date**: 2025-11-02
**Status**: Complete ✅

---

## Problem

The Workflow Orchestrator execution path was **returning early** without logging to:
- `agent_executions` table
- `agent_logs` table
- `agent_stats` (via RPC)
- AIS intensity metrics

This caused:
- ❌ Agent statistics never updated
- ❌ No execution logs appeared in agent_logs table
- ❌ No AIS intensity tracking for orchestrator runs

---

## Solution: Unified Logging Architecture

Instead of duplicating logging code, we refactored the API route to have **unified logging** that works for BOTH execution paths.

### Before (Broken)

```typescript
if (orchestratorEnabled) {
  // Execute orchestrator
  const result = await orchestrator.execute(...);

  // Return immediately ❌ (no logging!)
  return NextResponse.json({ ...result });
}

if (use_agentkit) {
  // Execute agentkit
  const result = await runAgentKit(...);

  // Log to agent_executions ✅
  // Log to agent_logs ✅
  // Update agent_stats ✅
  // Update AIS metrics ✅

  return NextResponse.json({ ...result });
}
```

### After (Fixed)

```typescript
let executionResult = null;
let executionType = 'agentkit';
let inputValues = {};

// Execute orchestrator OR agentkit (stores in executionResult)
if (orchestratorEnabled) {
  executionResult = await orchestrator.execute(...);
  executionType = 'orchestrator';
} else if (use_agentkit) {
  executionResult = await runAgentKit(...);
  executionType = 'agentkit';
}

// UNIFIED LOGGING (works for both!)
if (executionResult) {
  // Normalize result format
  const normalizedResult = executionType === 'orchestrator' ? {
    // Map orchestrator result to agentkit-like format
  } : executionResult;

  // 1. Log to agent_executions ✅
  // 2. Log to agent_logs ✅
  // 3. Update agent_stats ✅
  // 4. Update AIS metrics ✅

  return NextResponse.json({ ...normalizedResult });
}
```

---

## Key Changes

### 1. Shared Variables (Line 77-83)
```typescript
let executionResult: any = null;
let executionType: 'orchestrator' | 'agentkit' = 'agentkit';
let shouldExecute = true;
let inputValues: Record<string, any> = {}; // Shared across both paths
let inputSchema: any = null;
```

### 2. Orchestrator Path - No Early Return (Line 131-140)
```typescript
// Execute using WorkflowOrchestrator
const orchestrator = new WorkflowOrchestrator(supabase);
executionResult = await orchestrator.execute(...); // Store, don't return!

executionType = 'orchestrator';
shouldExecute = false; // Don't execute AgentKit
```

### 3. AgentKit Path - No Early Return (Line 203-222)
```typescript
// Execute using OpenAI AgentKit
executionResult = await runAgentKit(...); // Store, don't return!

executionType = 'agentkit';
shouldExecute = false; // Execution complete
```

### 4. Normalize Result Format (Line 248-259)
```typescript
const normalizedResult = executionType === 'orchestrator' ? {
  success: executionResult.success,
  error: executionResult.error,
  executionTime: executionResult.totalExecutionTime, // Map to agentkit format
  tokensUsed: {
    total: executionResult.totalTokensUsed,
    prompt: 0,
    completion: executionResult.totalTokensUsed
  },
  iterations: 1,
  toolCalls: [], // Orchestrator doesn't expose array
  response: executionResult.output?.message || 'Workflow completed',
  model: 'workflow_orchestrator',
  provider: 'neuronforge',
  memoryData: undefined
} : executionResult; // AgentKit already in correct format
```

### 5. Unified Logging (Line 283-444)

#### agent_executions Table (Line 283-313)
```typescript
await supabase.from('agent_executions').insert({
  agent_id: agent.id,
  user_id: user.id,
  execution_type: 'manual',
  status: normalizedResult.success ? 'completed' : 'failed',
  execution_duration_ms: normalizedResult.executionTime,
  logs: executionType === 'orchestrator' ? {
    orchestrator: true,
    executionId: executionResult.executionId,
    stepsCompleted: executionResult.stepsCompleted,
    // ... orchestrator-specific fields
  } : {
    agentkit: true,
    iterations: normalizedResult.iterations,
    // ... agentkit-specific fields
  }
});
```

#### agent_logs Table (Line 319-381)
```typescript
await supabase.from('agent_logs').insert({
  agent_id: agent.id,
  user_id: user.id,
  run_output: JSON.stringify(
    executionType === 'orchestrator' ? {
      // Orchestrator format
    } : {
      // AgentKit format
    }
  ),
  run_time: normalizedResult.executionTime,
  user_credits_used: Math.ceil(normalizedResult.tokensUsed.total / 1000),
  run_tokens: normalizedResult.tokensUsed.total,
  status: `✅ ${executionType === 'orchestrator' ? 'Orchestrator' : 'AgentKit'} execution completed`
});
```

#### increment_agent_stats RPC (Line 385-395)
```typescript
await supabase.rpc('increment_agent_stats', {
  agent_id_input: agent.id,
  user_id_input: user.id,
  success: normalizedResult.success, // Works for both!
});
```

#### updateAgentIntensityMetrics (Line 397-444)
```typescript
const executionData: AgentExecutionData = {
  agent_id: agent.id,
  user_id: user.id,
  tokens_used: normalizedResult.tokensUsed.total,
  // ... map both formats to AIS expected structure
  tool_calls_count: executionType === 'orchestrator' ?
    executionResult.stepsCompleted : normalizedResult.toolCalls.length,
  // ... other fields
};

await updateAgentIntensityMetrics(supabase, executionData);
```

### 6. Unified Response (Line 446-475)
```typescript
return NextResponse.json({
  success: normalizedResult.success,
  message: normalizedResult.response,
  data: executionType === 'orchestrator' ? {
    // Orchestrator-specific response
    execution_id: executionResult.executionId,
    steps_completed: executionResult.stepsCompleted,
    // ...
  } : {
    // AgentKit-specific response
    tool_calls_count: normalizedResult.toolCalls.length,
    iterations: normalizedResult.iterations,
    // ...
  },
  [executionType]: true // Dynamic key: 'orchestrator' or 'agentkit'
});
```

---

## Benefits

### 1. No Code Duplication ✅
- Single logging implementation
- Easier to maintain
- Consistent behavior

### 2. Full Parity ✅
- Orchestrator gets same logging as AgentKit
- All stats/analytics work for both
- Complete feature parity

### 3. Clean Architecture ✅
- Orchestrator just orchestrates (no side effects)
- API route handles all logging (separation of concerns)
- Easy to add new execution types in future

### 4. Backward Compatible ✅
- AgentKit behavior unchanged
- All existing code continues to work
- No breaking changes

---

## Testing Checklist

After this change, both execution paths should:

- ✅ Create entry in `agent_executions` table
- ✅ Create entry in `agent_logs` table
- ✅ Update `agent_stats` via RPC
- ✅ Update AIS intensity metrics
- ✅ Return proper response format
- ✅ Track tokens and execution time
- ✅ Handle errors gracefully

---

## Files Changed

| File | Changes | Lines |
|------|---------|-------|
| `app/api/run-agent/route.ts` | Unified logging architecture | ~400 LOC refactored |
| `docs/ORCHESTRATOR_LOGGING_PARITY_CHECK.md` | Parity analysis document | 350 new |
| `docs/ORCHESTRATOR_LOGGING_UNIFICATION.md` | This document | 300 new |

---

## Verification

To verify this works, run an agent with `workflow_steps`:

1. Check `agent_executions` table - should have new entry
2. Check `agent_logs` table - should have new entry
3. Check agent dashboard - statistics should update
4. Check AIS metrics - should track orchestrator execution

**Before this fix**: All 4 would be empty/broken
**After this fix**: All 4 should work correctly

---

## Future Improvements

1. **Token Breakdown**: Orchestrator could expose input/output token split
2. **Memory Metadata**: Orchestrator could expose memory usage stats
3. **Tool Calls Array**: Orchestrator could expose per-step execution details
4. **Retry Tracking**: Both could track retry attempts

These are nice-to-haves, not blockers. Current implementation provides functional parity.
