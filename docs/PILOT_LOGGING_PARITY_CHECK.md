# Orchestrator Logging Parity Check

**Date**: 2025-11-02
**Purpose**: Ensure orchestrator execution has complete parity with AgentKit for all logging, stats, and tracking

---

## Current AgentKit Logging Flow

**File**: `/app/api/run-agent/route.ts` (lines 175-423)

### 1. agent_executions Table Insert (line 265)
```typescript
await supabase.from('agent_executions').insert({
  agent_id: agent.id,
  user_id: user.id,
  execution_type: 'manual',
  status: result.success ? 'completed' : 'failed',
  scheduled_at: now,
  started_at: new Date(Date.now() - result.executionTime).toISOString(),
  completed_at: now,
  execution_duration_ms: result.executionTime,
  error_message: result.error || null,
  logs: {
    agentkit: true,
    iterations: result.iterations,
    toolCalls: sanitizeToolCalls(result.toolCalls),
    tokensUsed: result.tokensUsed,
    model: result.model || 'gpt-4o',
    provider: result.provider || 'openai',
    inputValuesUsed: Object.keys(inputValues).length
  }
});
```

**Data Available from AgentKit**:
- ✅ `result.success`
- ✅ `result.executionTime`
- ✅ `result.error`
- ✅ `result.iterations`
- ✅ `result.toolCalls` (array with plugin/action/success/result)
- ✅ `result.tokensUsed` (object with prompt/completion/total)
- ✅ `result.model` (e.g., "gpt-4o")
- ✅ `result.provider` (e.g., "openai")

**Data Available from Orchestrator**:
- ✅ `result.success`
- ✅ `result.totalExecutionTime` → maps to executionTime
- ✅ `result.error`
- ⚠️  `result.stepsCompleted` → NO direct iterations equivalent
- ⚠️  NO `result.toolCalls` array → Need to extract from execution context
- ✅ `result.totalTokensUsed` → maps to tokensUsed.total
- ❌ NO `result.model` or `result.provider` → orchestrator tracks per-step

---

### 2. agent_logs Table Insert (line 293)
```typescript
await supabase.from('agent_logs').insert({
  agent_id: agent.id,
  user_id: user.id,
  run_output: JSON.stringify({
    success: result.success,
    agentkit: true,
    iterations: result.iterations,
    toolCallsCount: result.toolCalls.length,
    tokensUsed: result.tokensUsed.total,
    executionTimeMs: result.executionTime,
    model: result.model || 'gpt-4o',
    provider: result.provider || 'openai'
  }),
  full_output: {
    agentkit_metadata: {
      model: result.model || 'gpt-4o',
      provider: result.provider || 'openai',
      iterations: result.iterations,
      toolCalls: sanitizeToolCalls(result.toolCalls),
      tokensUsed: result.tokensUsed
    }
  },
  status: result.success ? '✅ AgentKit execution completed successfully' : '❌ AgentKit execution failed',
  created_at: now,
  run_time: result.executionTime, // NEW FIELD
  user_credits_used: Math.ceil(result.tokensUsed.total / 1000), // NEW FIELD
  run_tokens: result.tokensUsed.total // NEW FIELD
});
```

**Required Fields**:
- ✅ `run_output` (JSON string)
- ✅ `full_output` (JSONB object)
- ✅ `status` (string)
- ✅ `run_time` (integer ms)
- ✅ `user_credits_used` (integer)
- ✅ `run_tokens` (integer)

**Orchestrator Equivalent**:
```typescript
await supabase.from('agent_logs').insert({
  agent_id: agent.id,
  user_id: user.id,
  run_output: JSON.stringify({
    success: result.success,
    orchestrator: true,
    stepsCompleted: result.stepsCompleted,
    stepsFailed: result.stepsFailed,
    stepsSkipped: result.stepsSkipped,
    totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
    tokensUsed: result.totalTokensUsed,
    executionTimeMs: result.totalExecutionTime,
    executionId: result.executionId
  }),
  full_output: {
    orchestrator_metadata: {
      executionId: result.executionId,
      stepsCompleted: result.stepsCompleted,
      stepsFailed: result.stepsFailed,
      stepsSkipped: result.stepsSkipped,
      totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
      tokensUsed: result.totalTokensUsed
    }
  },
  status: result.success ? '✅ Orchestrator execution completed successfully' : '❌ Orchestrator execution failed',
  created_at: now,
  run_time: result.totalExecutionTime,
  user_credits_used: Math.ceil(result.totalTokensUsed / 1000),
  run_tokens: result.totalTokensUsed
});
```

---

### 3. increment_agent_stats RPC (line 333)
```typescript
await supabase.rpc('increment_agent_stats', {
  agent_id_input: agent.id,
  user_id_input: user.id,
  success: result.success
});
```

**Required Parameters**:
- ✅ `agent_id_input` (UUID)
- ✅ `user_id_input` (UUID)
- ✅ `success` (boolean)

**Orchestrator Equivalent**:
```typescript
await supabase.rpc('increment_agent_stats', {
  agent_id_input: agent.id,
  user_id_input: user.id,
  success: result.success // ✅ Same
});
```

---

### 4. updateAgentIntensityMetrics (line 384)
```typescript
const executionData: AgentExecutionData = {
  agent_id: agent.id,
  user_id: user.id,
  tokens_used: result.tokensUsed.total,
  input_tokens: result.tokensUsed.prompt,
  output_tokens: result.tokensUsed.completion,
  execution_duration_ms: result.executionTime,
  iterations_count: result.iterations,
  was_successful: result.success,
  retry_count: 0,
  plugins_used: agent.plugins_required || [],
  tool_calls_count: result.toolCalls.length,
  tool_orchestration_time_ms: 0,
  workflow_steps: workflowComplexity.steps,
  conditional_branches: workflowComplexity.branches,
  loop_iterations: workflowComplexity.loops,
  parallel_executions: workflowComplexity.parallel,
  memory_tokens: result.memoryData?.tokens || 0,
  memory_entry_count: result.memoryData?.entryCount || 0,
  memory_types: result.memoryData?.types || [],
};

await updateAgentIntensityMetrics(supabase, executionData);
```

**AgentExecutionData Type** (from `/lib/types/intensity.ts`):
```typescript
export interface AgentExecutionData {
  agent_id: string;
  user_id: string;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  execution_duration_ms: number;
  iterations_count: number;
  was_successful: boolean;
  retry_count: number;
  plugins_used: string[];
  tool_calls_count: number;
  tool_orchestration_time_ms: number;
  workflow_steps: number;
  conditional_branches: number;
  loop_iterations: number;
  parallel_executions: number;
  memory_tokens: number;
  memory_entry_count: number;
  memory_types: string[];
}
```

**Orchestrator Data Mapping**:
- ✅ `agent_id` → `agent.id`
- ✅ `user_id` → `user.id`
- ✅ `tokens_used` → `result.totalTokensUsed`
- ⚠️  `input_tokens` → NOT tracked by orchestrator (use 0 or estimate)
- ⚠️  `output_tokens` → NOT tracked by orchestrator (use totalTokensUsed)
- ✅ `execution_duration_ms` → `result.totalExecutionTime`
- ⚠️  `iterations_count` → NOT applicable (orchestrator doesn't iterate, use 1)
- ✅ `was_successful` → `result.success`
- ⚠️  `retry_count` → NOT implemented yet (use 0)
- ✅ `plugins_used` → `agent.plugins_required`
- ⚠️  `tool_calls_count` → Use `result.stepsCompleted`? (not exact equivalent)
- ✅ `tool_orchestration_time_ms` → Use `result.totalExecutionTime`
- ✅ `workflow_steps` → `result.stepsCompleted + result.stepsFailed + result.stepsSkipped`
- ⚠️  `conditional_branches` → NOT tracked yet (use 0 or count from workflow_steps)
- ⚠️  `loop_iterations` → NOT tracked yet (use 0)
- ⚠️  `parallel_executions` → NOT tracked yet (use 0)
- ⚠️  `memory_tokens` → NOT exposed by orchestrator (check if available)
- ⚠️  `memory_entry_count` → NOT exposed by orchestrator
- ⚠️  `memory_types` → NOT exposed by orchestrator

---

## Missing Orchestrator Data

### Critical Missing Fields:
1. **Token Breakdown** (`input_tokens`, `output_tokens`)
   - AgentKit tracks via `result.tokensUsed.prompt` and `result.tokensUsed.completion`
   - Orchestrator only tracks `totalTokensUsed`
   - **Solution**: Use `totalTokensUsed` for both input/output until orchestrator provides breakdown

2. **Memory Metadata** (`memory_tokens`, `memory_entry_count`, `memory_types`)
   - AgentKit exposes `result.memoryData`
   - Orchestrator uses MemoryInjector/MemorySummarizer internally but doesn't expose to result
   - **Solution**: Extract from orchestrator execution context or set to 0

3. **Workflow Complexity** (`conditional_branches`, `loop_iterations`, `parallel_executions`)
   - AgentKit calculates from `agent.workflow_steps`
   - Orchestrator executes these but doesn't expose counts in result
   - **Solution**: Calculate from `agent.workflow_steps` (same as AgentKit)

---

## Recommended Orchestrator Logging Implementation

```typescript
// After orchestrator.execute() returns result:
const now = new Date().toISOString();

// 1. agent_executions insert
await supabase.from('agent_executions').insert({
  agent_id: agent.id,
  user_id: user.id,
  execution_type: 'manual',
  status: result.success ? 'completed' : 'failed',
  scheduled_at: now,
  started_at: new Date(Date.now() - result.totalExecutionTime).toISOString(),
  completed_at: now,
  execution_duration_ms: result.totalExecutionTime,
  error_message: result.error || null,
  logs: {
    orchestrator: true,
    executionId: result.executionId,
    stepsCompleted: result.stepsCompleted,
    stepsFailed: result.stepsFailed,
    stepsSkipped: result.stepsSkipped,
    totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
    tokensUsed: result.totalTokensUsed,
    inputValuesUsed: Object.keys(inputValues).length
  }
});

// 2. agent_logs insert
await supabase.from('agent_logs').insert({
  agent_id: agent.id,
  user_id: user.id,
  run_output: JSON.stringify({
    success: result.success,
    orchestrator: true,
    stepsCompleted: result.stepsCompleted,
    stepsFailed: result.stepsFailed,
    stepsSkipped: result.stepsSkipped,
    totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
    tokensUsed: result.totalTokensUsed,
    executionTimeMs: result.totalExecutionTime,
    executionId: result.executionId
  }),
  full_output: {
    orchestrator_metadata: {
      executionId: result.executionId,
      stepsCompleted: result.stepsCompleted,
      stepsFailed: result.stepsFailed,
      stepsSkipped: result.stepsSkipped,
      totalSteps: result.stepsCompleted + result.stepsFailed + result.stepsSkipped,
      tokensUsed: result.totalTokensUsed
    }
  },
  status: result.success ? '✅ Orchestrator execution completed successfully' : '❌ Orchestrator execution failed',
  created_at: now,
  run_time: result.totalExecutionTime,
  user_credits_used: Math.ceil(result.totalTokensUsed / 1000),
  run_tokens: result.totalTokensUsed
});

// 3. increment_agent_stats RPC
await supabase.rpc('increment_agent_stats', {
  agent_id_input: agent.id,
  user_id_input: user.id,
  success: result.success
});

// 4. updateAgentIntensityMetrics
const workflowSteps = agent.workflow_steps || [];
const workflowComplexity = {
  steps: workflowSteps.length,
  branches: workflowSteps.filter((s: any) => s.type === 'conditional' || s.type === 'branch').length,
  loops: workflowSteps.filter((s: any) => s.type === 'loop' || s.type === 'iteration').length,
  parallel: workflowSteps.filter((s: any) => s.parallel === true).length,
};

const executionData: AgentExecutionData = {
  agent_id: agent.id,
  user_id: user.id,
  tokens_used: result.totalTokensUsed,
  input_tokens: 0, // Orchestrator doesn't track separately
  output_tokens: result.totalTokensUsed,
  execution_duration_ms: result.totalExecutionTime,
  iterations_count: 1, // Orchestrator doesn't iterate
  was_successful: result.success,
  retry_count: 0, // Not implemented yet
  plugins_used: agent.plugins_required || [],
  tool_calls_count: result.stepsCompleted,
  tool_orchestration_time_ms: result.totalExecutionTime,
  workflow_steps: workflowComplexity.steps,
  conditional_branches: workflowComplexity.branches,
  loop_iterations: workflowComplexity.loops,
  parallel_executions: workflowComplexity.parallel,
  memory_tokens: 0, // Not exposed by orchestrator yet
  memory_entry_count: 0,
  memory_types: [],
};

await updateAgentIntensityMetrics(supabase, executionData);
```

---

## Parity Checklist

| Feature | AgentKit | Orchestrator | Status |
|---------|----------|--------------|--------|
| agent_executions insert | ✅ | ✅ | Parity achieved |
| agent_logs insert | ✅ | ✅ | Parity achieved |
| increment_agent_stats | ✅ | ✅ | Parity achieved |
| updateAgentIntensityMetrics | ✅ | ✅ | Parity achieved (with reasonable defaults) |
| Token tracking | ✅ Full | ⚠️ Total only | Acceptable (orchestrator limitation) |
| Memory metadata | ✅ Full | ❌ Not exposed | Need to add to orchestrator result |
| Workflow complexity | ✅ Full | ✅ Full | Parity achieved |
| Error tracking | ✅ Full | ✅ Full | Parity achieved |

---

## Action Items

1. ✅ Add all 4 logging operations to orchestrator path in `/app/api/run-agent/route.ts`
2. ⚠️  Consider enhancing orchestrator to expose memory metadata in result
3. ⚠️  Consider enhancing orchestrator to track input/output tokens separately
4. ✅ Use workflow_steps from agent definition to calculate complexity metrics (same as AgentKit)

---

## Conclusion

The orchestrator can achieve **functional parity** with AgentKit for all logging, stats, and tracking by:
1. Using the same 4 logging operations
2. Mapping orchestrator result fields to AgentKit equivalents
3. Using reasonable defaults for fields not tracked by orchestrator
4. Calculating workflow complexity from agent.workflow_steps (same as AgentKit)

This ensures:
- ✅ Statistics update correctly (agent_stats)
- ✅ Logs appear in agent_logs table
- ✅ Executions tracked in agent_executions
- ✅ AIS metrics update with execution data
