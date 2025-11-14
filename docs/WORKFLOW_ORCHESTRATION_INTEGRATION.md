# WorkflowPilot Orchestration Integration Guide

**Purpose:** Integrate the orchestration system with WorkflowPilot for end-to-end workflow execution with intent-based optimization.

**Status:** Integration layer complete, ready for WorkflowPilot implementation

---

## Overview

The orchestration system is now ready to integrate with WorkflowPilot via the `WorkflowOrchestrator` class. This integration enables:

- **Intent-based step execution** using specialized handlers
- **Token budget management** with enforcement
- **Compression** for token optimization
- **AIS-based routing** for optimal model selection
- **Audit logging** for all orchestration events
- **Metrics tracking** for cost and performance

---

## Architecture

```
WorkflowPilot
     ↓
WorkflowOrchestrator.initialize()  ← Initialize once per workflow
     ↓
[For each step]
     ↓
WorkflowOrchestrator.executeStep()  ← Execute via handlers
     ↓
HandlerRegistry → Appropriate Handler
     ↓
Result with metrics
     ↓
WorkflowOrchestrator.complete()  ← Get final metrics
     ↓
Execution complete
```

---

## Integration Steps

### Step 1: Initialize Orchestration (Workflow Start)

Add orchestration initialization to WorkflowPilot's `execute()` method:

```typescript
// In WorkflowPilot.execute(), after context creation

import { WorkflowOrchestrator } from '@/lib/orchestration';

// ... existing code ...

// Initialize orchestration (optional - disabled by default)
const orchestrator = new WorkflowOrchestrator(this.supabase);
const orchestrationEnabled = await orchestrator.initialize(
  context.executionId,  // Use as workflowId
  agent.id,
  userId,
  workflowSteps
);

if (orchestrationEnabled) {
  console.log('[WorkflowPilot] Orchestration enabled for this execution');
  // Store orchestrator in context for step execution
  context.orchestrator = orchestrator;
} else {
  console.log('[WorkflowPilot] Orchestration disabled, using normal execution');
}
```

### Step 2: Execute Steps with Orchestration

Modify step execution to use orchestration handlers when available:

**Option A: Modify StepExecutor**

```typescript
// In StepExecutor.execute(), before existing execution logic

async execute(
  step: WorkflowStep,
  context: ExecutionContext
): Promise<StepOutput> {
  const startTime = Date.now();

  // Check if orchestration is active
  if (context.orchestrator && context.orchestrator.isActive()) {
    console.log(`[StepExecutor] Using orchestration for step ${step.id}`);

    try {
      // Execute via orchestration handlers
      const result = await context.orchestrator.executeStep(
        step.id,
        {
          step,
          params: step.params,
          context: context.variables,
        },
        context.memoryContext,
        context.availablePlugins
      );

      if (result) {
        // Return orchestrated result
        return {
          data: result.output,
          tokensUsed: result.tokensUsed.total,
          metadata: {
            compressionApplied: result.compressionApplied,
            tokensSaved: result.tokensSaved,
            routedModel: result.routedModel,
            executionTime: result.executionTime,
          },
        };
      }
    } catch (error) {
      console.warn('[StepExecutor] Orchestration failed, falling back to normal execution:', error);
      // Fall through to normal execution
    }
  }

  // Normal execution (existing code)
  // ... rest of existing execute() logic ...
}
```

**Option B: Create Orchestrated Step Executor**

Create a new `Orchestrated StepExecutor.ts` that wraps orchestration:

```typescript
import { StepExecutor } from './StepExecutor';
import { WorkflowOrchestrator } from '@/lib/orchestration';

export class OrchestratedStepExecutor extends StepExecutor {
  private orchestrator?: WorkflowOrchestrator;

  setOrchestrator(orchestrator: WorkflowOrchestrator) {
    this.orchestrator = orchestrator;
  }

  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
    // Try orchestration first
    if (this.orchestrator?.isActive()) {
      const result = await this.orchestrator.executeStep(
        step.id,
        { step, params: step.params, context: context.variables },
        context.memoryContext,
        context.availablePlugins
      );

      if (result) {
        return {
          data: result.output,
          tokensUsed: result.tokensUsed.total,
          metadata: {
            compressionApplied: result.compressionApplied,
            tokensSaved: result.tokensSaved,
            routedModel: result.routedModel,
          },
        };
      }
    }

    // Fallback to parent implementation
    return super.execute(step, context);
  }
}
```

### Step 3: Complete Orchestration (Workflow End)

Add orchestration completion to get final metrics:

```typescript
// In WorkflowPilot.execute(), after all steps complete

// Complete orchestration and get metrics
if (context.orchestrator) {
  const orchestrationMetrics = await context.orchestrator.complete();

  if (orchestrationMetrics) {
    console.log('[WorkflowPilot] Orchestration metrics:', orchestrationMetrics);

    // Add to execution result
    (executionResult as any).orchestrationMetrics = {
      totalTokensUsed: orchestrationMetrics.totalTokensUsed,
      totalTokensSaved: orchestrationMetrics.totalTokensSaved,
      savingsPercent: (orchestrationMetrics.totalTokensSaved / orchestrationMetrics.totalTokensUsed * 100).toFixed(1) + '%',
      totalCost: orchestrationMetrics.totalCost,
      budgetUtilization: (orchestrationMetrics.budgetUtilization * 100).toFixed(1) + '%',
    };
  }
}
```

---

## ExecutionContext Extension

Add orchestrator field to `ExecutionContext`:

```typescript
// In lib/pilot/ExecutionContext.ts

export class ExecutionContext {
  // ... existing fields ...

  // Orchestration
  public orchestrator?: WorkflowOrchestrator;

  // ... existing methods ...
}
```

---

## Feature Flag Control

The orchestration system is controlled by the `orchestration_enabled` feature flag in `system_settings_config`:

```sql
-- Enable orchestration
UPDATE system_settings_config
SET value = 'true'
WHERE key = 'orchestration_enabled';

-- Enable compression
UPDATE system_settings_config
SET value = 'true'
WHERE key = 'orchestration_compression_enabled';

-- Enable AIS routing
UPDATE system_settings_config
SET value = 'true'
WHERE key = 'orchestration_ais_routing_enabled';
```

All features are **disabled by default** for safe rollout.

---

## Audit Events

The orchestration system logs the following audit events:

1. **ORCHESTRATION_INITIALIZED** - When orchestration starts for a workflow
2. **ORCHESTRATION_STEP_EXECUTED** - After each successful step execution
3. **ORCHESTRATION_STEP_FAILED** - When a step fails
4. **ORCHESTRATION_BUDGET_EXCEEDED** - When a step exceeds its token budget
5. **ORCHESTRATION_COMPLETED** - When workflow orchestration completes

All events include detailed metadata about tokens, cost, compression, and routing.

---

## Token Tracking

Token usage is automatically tracked via:

1. **OrchestrationService.trackStepExecution()** - Called after each step
2. **TokenBudgetManager** - Tracks budget allocation and usage
3. **Audit events** - Log all token metrics

To integrate with existing token tracking:

```typescript
// After orchestration completes
if (orchestrationMetrics) {
  // Save to token_usage table
  await this.supabase
    .from('token_usage')
    .insert({
      agent_id: agent.id,
      user_id: userId,
      execution_id: context.executionId,
      tokens_used: orchestrationMetrics.totalTokensUsed,
      tokens_saved: orchestrationMetrics.totalTokensSaved,
      cost: orchestrationMetrics.totalCost,
      model_info: {
        orchestration: true,
        compression_enabled: context.orchestrator.getMetadata()?.featureFlags.compressionEnabled,
        routing_enabled: context.orchestrator.getMetadata()?.featureFlags.aisRoutingEnabled,
      },
    });
}
```

---

## Testing Strategy

### 1. Unit Tests
- Test WorkflowOrchestrator initialization
- Test step execution via handlers
- Test budget enforcement
- Test metrics collection

### 2. Integration Tests
- Test with WorkflowPilot execution
- Test with real agents and workflows
- Test with various intent types
- Test error handling and fallback

### 3. Feature Flag Testing
- Test with orchestration disabled (normal execution)
- Test with orchestration enabled, compression disabled
- Test with orchestration enabled, routing disabled
- Test with all features enabled

### 4. Performance Testing
- Measure orchestration overhead (<50ms target)
- Measure token savings (30-40% target)
- Measure cost reduction (40-55% target)
- Measure handler execution time

---

## Example: Complete Integration

Here's a complete example of how WorkflowPilot would use orchestration:

```typescript
// In WorkflowPilot.execute()

export class WorkflowPilot {
  async execute(agent: Agent, userId: string, ...args): Promise<WorkflowExecutionResult> {
    // ... existing initialization ...

    // Initialize orchestration
    const orchestrator = new WorkflowOrchestrator(this.supabase);
    const orchestrationEnabled = await orchestrator.initialize(
      context.executionId,
      agent.id,
      userId,
      workflowSteps
    );

    if (orchestrationEnabled) {
      context.orchestrator = orchestrator;
    }

    try {
      // Execute steps (StepExecutor will use orchestrator if available)
      await this.executeSteps(executionPlan, context);

      // Complete orchestration
      if (context.orchestrator) {
        const metrics = await context.orchestrator.complete();
        if (metrics) {
          console.log('💰 Orchestration saved:', metrics.totalTokensSaved, 'tokens');
          console.log('💵 Total cost:', '$' + metrics.totalCost.toFixed(4));
        }
      }

      // ... rest of execution ...

    } catch (error) {
      // ... error handling ...
    }
  }
}
```

---

## Migration Path

**Phase 1: Soft Launch (Current)**
- ✅ Orchestration disabled by default
- ✅ Feature flags in place
- ✅ All systems ready

**Phase 2: Testing**
- Enable for test agents
- Monitor metrics
- Verify token savings
- Check for errors

**Phase 3: Gradual Rollout**
- Enable for specific users
- Enable for specific agent types
- Monitor performance
- Collect feedback

**Phase 4: Full Deployment**
- Enable by default
- Monitor at scale
- Optimize based on data

---

## Troubleshooting

### Orchestration Not Initializing

**Check:**
1. Feature flag: `SELECT value FROM system_settings_config WHERE key = 'orchestration_enabled'`
2. Database migration: Verify Phase 1 and Phase 2 migrations ran
3. Logs: Check for initialization errors

### Steps Not Using Handlers

**Check:**
1. `context.orchestrator.isActive()` returns true
2. Step IDs match between workflow and orchestration metadata
3. Intent classification succeeded

### Budget Exceeded Errors

**Check:**
1. Token budgets in `system_settings_config`
2. Actual vs. estimated token usage
3. Budget allocation strategy (default: proportional)

### Handlers Failing

**Check:**
1. Handler registration: `handlerRegistry.getRegisteredIntents()`
2. API keys (ANTHROPIC_API_KEY)
3. Model availability
4. Handler-specific errors in logs

---

## Next Steps

1. **Implement integration** in WorkflowPilot using this guide
2. **Add unit tests** for WorkflowOrchestrator
3. **Create integration tests** with sample workflows
4. **Enable feature flags** for testing
5. **Monitor metrics** and optimize

---

## Support

For questions or issues:
- Review audit logs for orchestration events
- Check system_settings_config for feature flags
- Review handler logs for execution details
- Consult phase completion docs (PHASE_1_COMPLETE.md, PHASE_2_COMPLETE.md, PHASE_3_COMPLETE.md)

