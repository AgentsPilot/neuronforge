# Transform Orchestrator into State-of-the-Art "Pilot" System

**Date**: 2025-11-02
**Status**: Implementation Plan
**Version**: 1.0

---

## 🎯 OVERVIEW

The orchestrator is **93% complete and production-ready**, but needs enhancements to become a state-of-the-art Pilot system capable of handling very complex agents with many plugins, conditions, data enrichment, and step comparisons.

The "Pilot" is the core execution engine of the AgentsPilot platform - the intelligent system that orchestrates complex multi-step workflows with precision, reliability, and intelligence.

---

## 🔍 KEY FINDINGS

### Current Status (What Works)

- ✅ All 13 core TypeScript components (~6,700 lines) implemented
- ✅ Basic sequential & parallel execution
- ✅ Conditional branching (and/or/not logic)
- ✅ Safe expression evaluation (no eval!)
- ✅ State persistence & checkpointing
- ✅ Plugin integration (PluginExecuterV2)
- ✅ Memory system integration
- ✅ AgentKit integration for LLM decisions
- ✅ AIS intensity tracking
- ✅ Audit trail logging
- ✅ Smart Agent Builder compatibility

### Critical Issue Identified

**`workflow_step_executions` table created but NEVER used!**

- Table exists in database schema
- Methods exist in StateManager (lines 378-447)
- BUT: StepExecutor never calls them (missing dependency injection)
- Result: Only JSONB trace in `workflow_executions`, no normalized step records

**Impact**: Missing detailed step-level analytics, harder to debug complex workflows

### Missing Features for State-of-the-Art

1. ❌ Sub-workflows (workflows within workflows)
2. ❌ Scatter-gather patterns (fan-out/fan-in)
3. ❌ Human-in-the-loop approvals
4. ❌ Per-step timeouts
5. ❌ Advanced retry strategies (circuit breakers, bulkheads)
6. ❌ Data comparison/validation steps
7. ❌ Dynamic workflow generation
8. ❌ Switch/case conditionals
9. ❌ Resume capability (implemented but untested)
10. ❌ Workflow versioning

---

## 📋 IMPLEMENTATION PLAN

### **Phase 1: Fix Foundation & Rename (2-3 days)**

#### 1.1 Rename "Orchestrator" → "Pilot"

**Why**: The Pilot is the intelligent execution engine at the heart of AgentsPilot. The name should reflect this.

**Changes Required**:

**Directory Rename**:
```bash
mv lib/orchestrator lib/pilot
```

**File Renames**:
- `WorkflowOrchestrator.ts` → `WorkflowPilot.ts`
- `ORCHESTRATOR_*.md` → `PILOT_*.md` (all docs)

**Class Renames**:
- `WorkflowOrchestrator` → `WorkflowPilot`
- `OrchestratorConfig` → `PilotConfig`
- All orchestrator-related type names

**Database Config**:
```sql
-- Rename system config key
UPDATE system_config
SET config_key = 'pilot_enabled'
WHERE config_key = 'workflow_orchestrator_enabled';
```

**Files to Update**:
- `app/api/run-agent/route.ts` - Update imports and variable names
- `app/admin/system-config/page.tsx` - Update UI labels and config keys
- `lib/audit/events.ts` - Rename event constants:
  - `ORCHESTRATOR_EXECUTION_STARTED` → `PILOT_EXECUTION_STARTED`
  - `ORCHESTRATOR_EXECUTION_COMPLETED` → `PILOT_EXECUTION_COMPLETED`
  - `ORCHESTRATOR_EXECUTION_FAILED` → `PILOT_EXECUTION_FAILED`
  - `ORCHESTRATOR_STEP_EXECUTED` → `PILOT_STEP_EXECUTED`
  - `ORCHESTRATOR_STEP_FAILED` → `PILOT_STEP_FAILED`

**Documentation Updates**:
- Update all references in markdown files
- Update code comments
- Update README if exists

---

#### 1.2 Fix `workflow_step_executions` Logging

**Problem**: Table exists in database but is never populated due to missing dependency injection.

**Why This Matters**:
- Enables detailed step-level analytics (e.g., "Show me all failed email steps across all executions")
- Better debugging (step-by-step timeline with exact timestamps)
- Normalized data structure (easier to query than JSONB)
- Compliance/audit trail requirements

**Implementation**:

**File 1**: `lib/pilot/StepExecutor.ts` (Constructor - Line 26-28)

```typescript
// BEFORE:
export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
  }
}

// AFTER:
export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private stateManager: StateManager;  // ADD THIS

  constructor(
    supabase: SupabaseClient,
    stateManager: StateManager  // ADD PARAMETER
  ) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.stateManager = stateManager;  // STORE REFERENCE
  }
}
```

**File 2**: `lib/pilot/StepExecutor.ts` (execute method - Line 45-125)

```typescript
async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
  const startTime = Date.now();

  // ✅ ADD: Log step start to workflow_step_executions table
  await this.stateManager.logStepExecution(
    context.executionId,
    step.id,
    step.name || `Step ${step.id}`,
    step.type,
    'running'
  );

  try {
    // Resolve parameters with variable substitution
    const resolvedParams = context.resolveAllVariables(step.params || {});

    let result: any;
    let tokensUsed = 0;

    // Execute based on step type
    switch (step.type) {
      case 'action':
        result = await this.executeAction(step, resolvedParams, context);
        break;
      case 'llm_decision':
      case 'ai_processing':
        const llmResult = await this.executeLLMDecision(step, resolvedParams, context);
        result = llmResult.data;
        tokensUsed = llmResult.tokensUsed;
        break;
      case 'transform':
        result = await this.executeTransform(step, resolvedParams, context);
        break;
      case 'delay':
        result = await this.executeDelay(step, resolvedParams);
        break;
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }

    const executionTime = Date.now() - startTime;

    // Build step output
    const output: StepOutput = {
      stepId: step.id,
      plugin: step.plugin || 'system',
      action: step.action || step.type,
      data: result,
      metadata: {
        success: true,
        executedAt: new Date().toISOString(),
        executionTime,
        itemCount: Array.isArray(result) ? result.length : undefined,
        tokensUsed
      }
    };

    // ✅ ADD: Update step status to 'completed'
    await this.stateManager.updateStepExecution(
      context.executionId,
      step.id,
      'completed',
      output.metadata
    );

    // Audit trail (existing code)
    await this.auditTrail.log({
      action: AUDIT_EVENTS.PILOT_STEP_EXECUTED,
      entityType: 'workflow_execution',
      entityId: context.executionId,
      userId: context.userId,
      resourceName: step.name,
      details: {
        stepId: step.id,
        stepType: step.type,
        executionTime,
        itemCount: output.metadata.itemCount
      },
      severity: 'info'
    });

    return output;

  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    // ✅ ADD: Update step status to 'failed'
    await this.stateManager.updateStepExecution(
      context.executionId,
      step.id,
      'failed',
      { executionTime },
      error.message
    );

    // Audit trail (existing code)
    await this.auditTrail.log({
      action: AUDIT_EVENTS.PILOT_STEP_FAILED,
      entityType: 'workflow_execution',
      entityId: context.executionId,
      userId: context.userId,
      resourceName: step.name,
      details: {
        stepId: step.id,
        stepType: step.type,
        error: error.message,
        executionTime
      },
      severity: 'warning'
    });

    // Build error output
    return {
      stepId: step.id,
      plugin: step.plugin || 'system',
      action: step.action || step.type,
      data: null,
      metadata: {
        success: false,
        executedAt: new Date().toISOString(),
        executionTime,
        error: error.message
      }
    };
  }
}
```

**File 3**: `lib/pilot/WorkflowPilot.ts` (Constructor - Line ~60)

```typescript
// BEFORE:
this.stepExecutor = new StepExecutor(supabase);

// AFTER:
this.stepExecutor = new StepExecutor(supabase, this.stateManager);
```

**Benefit**: Now every step execution creates a row in `workflow_step_executions` table, enabling:
- Detailed step-level analytics
- Timeline visualization
- Easy debugging ("Show me which steps are slow")
- Compliance audit trails

---

#### 1.3 Test & Verify Resume Capability

**Problem**: Resume capability is implemented but never tested in production.

**Test Plan**:

1. **Create test workflow with long-running steps**:
```json
[
  {
    "id": "step1",
    "type": "action",
    "plugin": "google-sheets",
    "action": "get_rows"
  },
  {
    "id": "step2",
    "type": "delay",
    "params": { "duration": 30000 }
  },
  {
    "id": "step3",
    "type": "action",
    "plugin": "slack",
    "action": "send_message"
  }
]
```

2. **Test pause during step2**:
   - Start execution
   - Call `StateManager.pauseExecution(executionId)` during delay
   - Verify status changes to 'paused'
   - Verify `paused_at` timestamp set

3. **Test resume**:
   - Call `StateManager.resumeExecution(executionId)`
   - Verify context restored from checkpoint
   - Verify execution continues from step2
   - Verify step3 executes successfully

4. **Test error cases**:
   - Resume already-completed execution (should fail gracefully)
   - Resume failed execution (should fail gracefully)
   - Resume with missing checkpoint data

**Files to Create**:
- `scripts/test-pilot-resume.ts` - Test script for pause/resume

**Expected Outcomes**:
- ✅ Pause works during any step
- ✅ Resume restores full context
- ✅ Execution continues from checkpoint
- ✅ Completed steps don't re-execute
- ✅ Error handling works correctly

---

### **Phase 2: Enhanced Conditionals & Control Flow (3-4 days)**

#### 2.1 Add Switch/Case Conditionals

**Use Case**: Route workflow based on discrete values (like priority level, status, category)

**Example**:
```json
{
  "id": "step3",
  "type": "switch",
  "name": "Route by priority",
  "evaluate": "{{step1.data.priority}}",
  "cases": {
    "high": ["step4_urgent", "step5_notify_vip"],
    "medium": ["step6_standard_queue"],
    "low": ["step7_batch_process"]
  },
  "default": ["step8_unknown_handler"]
}
```

**Implementation**:

**File 1**: `lib/pilot/types.ts` - Add SwitchStep type

```typescript
export interface SwitchStep extends WorkflowStepBase {
  type: 'switch';
  evaluate: string; // Expression to evaluate (e.g., "{{step1.data.priority}}")
  cases: Record<string, string[]>; // Map from value to step IDs
  default?: string[]; // Fallback step IDs if no case matches
}

// Add to WorkflowStep union
export type WorkflowStep =
  | ActionStep
  | LLMDecisionStep
  | AIProcessingStep
  | ConditionalStep
  | SwitchStep  // ADD THIS
  | LoopStep
  | TransformStep
  | DelayStep;
```

**File 2**: `lib/pilot/StepExecutor.ts` - Add switch handler

```typescript
async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
  // ... existing code ...

  switch (step.type) {
    case 'action':
      result = await this.executeAction(step, resolvedParams, context);
      break;

    // ADD THIS CASE:
    case 'switch':
      result = await this.executeSwitch(step as SwitchStep, context);
      break;

    // ... other cases ...
  }

  // ... rest of method ...
}

/**
 * Execute switch/case conditional
 */
private async executeSwitch(
  step: SwitchStep,
  context: ExecutionContext
): Promise<any> {
  // Evaluate the switch expression
  const evaluatedValue = context.resolveVariable(step.evaluate);
  const valueStr = String(evaluatedValue);

  console.log(`🔀 [StepExecutor] Switch on "${step.evaluate}" = "${valueStr}"`);

  // Find matching case
  let matchedSteps: string[] | undefined;

  if (step.cases[valueStr]) {
    matchedSteps = step.cases[valueStr];
    console.log(`✅ [StepExecutor] Matched case "${valueStr}" → steps: ${matchedSteps.join(', ')}`);
  } else if (step.default) {
    matchedSteps = step.default;
    console.log(`⚠️ [StepExecutor] No match, using default → steps: ${matchedSteps.join(', ')}`);
  } else {
    console.log(`❌ [StepExecutor] No match and no default case`);
    matchedSteps = [];
  }

  // Store matched branch in context for routing
  context.setVariable(`${step.id}_branch`, matchedSteps);

  return {
    matchedCase: valueStr,
    matchedSteps,
    totalCases: Object.keys(step.cases).length
  };
}
```

**File 3**: `lib/pilot/WorkflowPilot.ts` - Handle switch routing

```typescript
private async executeSingleStep(
  step: ExecutionStep,
  context: ExecutionContext
): Promise<void> {
  const stepDef = step.stepDefinition;

  // Handle switch type
  if (stepDef.type === 'switch') {
    const result = await this.stepExecutor.execute(stepDef, context);

    // Store switch result for routing
    context.setStepOutput(step.stepId, {
      stepId: step.stepId,
      plugin: 'system',
      action: 'switch',
      data: result,
      metadata: {
        success: true,
        executedAt: new Date().toISOString(),
        executionTime: 0
      }
    });

    // Mark non-matched branches as skipped
    const allSteps = new Set<string>();
    Object.values((stepDef as SwitchStep).cases).forEach(branch => {
      branch.forEach(stepId => allSteps.add(stepId));
    });
    if ((stepDef as SwitchStep).default) {
      (stepDef as SwitchStep).default!.forEach(stepId => allSteps.add(stepId));
    }

    const matchedSteps = new Set(result.data.matchedSteps || []);
    allSteps.forEach(stepId => {
      if (!matchedSteps.has(stepId)) {
        context.skippedSteps.push(stepId);
      }
    });

    await this.stateManager.checkpoint(context);
    return;
  }

  // ... existing code for other step types ...
}
```

**Benefit**: Clean routing logic for discrete values (better than chained if/else)

---

#### 2.2 Add Nested Conditionals

**Use Case**: Complex decision trees with multiple levels

**Example**:
```json
{
  "id": "step3",
  "type": "conditional",
  "condition": {
    "and": [
      {
        "field": "step1.data.score",
        "operator": ">",
        "value": 70
      },
      {
        "or": [
          {
            "field": "step2.data.priority",
            "operator": "==",
            "value": "high"
          },
          {
            "and": [
              {
                "field": "step2.data.urgent",
                "operator": "==",
                "value": true
              },
              {
                "field": "step2.data.deadline",
                "operator": "<",
                "value": "2025-12-31"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**Implementation**: Already supported! ConditionalEvaluator handles nested and/or/not recursively.

**Enhancement Needed**: Add support for `if/else if/else` chain:

```typescript
{
  "id": "step3",
  "type": "conditional_chain",
  "branches": [
    {
      "condition": { "field": "score", "operator": ">", "value": 90 },
      "steps": ["step4_excellent"]
    },
    {
      "condition": { "field": "score", "operator": ">", "value": 70 },
      "steps": ["step5_good"]
    },
    {
      "condition": { "field": "score", "operator": ">", "value": 50 },
      "steps": ["step6_average"]
    }
  ],
  "default": ["step7_poor"]
}
```

---

#### 2.3 Dynamic Branch Selection

**Use Case**: Let LLM decide which path to take based on complex criteria

**Example**:
```json
{
  "id": "step3",
  "type": "llm_router",
  "prompt": "Based on this email content, decide if it's: 'urgent_customer_issue', 'sales_inquiry', 'support_request', or 'spam'",
  "input": "{{step1.data.email_body}}",
  "routes": {
    "urgent_customer_issue": ["step4_escalate", "step5_notify_manager"],
    "sales_inquiry": ["step6_route_to_sales"],
    "support_request": ["step7_create_ticket"],
    "spam": ["step8_archive"]
  }
}
```

**Implementation**:

```typescript
export interface LLMRouterStep extends WorkflowStepBase {
  type: 'llm_router';
  prompt: string;
  input: string | Record<string, any>;
  routes: Record<string, string[]>;
  model?: string; // Optional: specify model (e.g., 'gpt-4', 'claude-3')
}

private async executeLLMRouter(
  step: LLMRouterStep,
  context: ExecutionContext
): Promise<any> {
  // Build prompt with context
  const inputData = typeof step.input === 'string'
    ? context.resolveVariable(step.input)
    : context.resolveAllVariables(step.input);

  const prompt = `${step.prompt}

Input Data:
${JSON.stringify(inputData, null, 2)}

Available routes: ${Object.keys(step.routes).join(', ')}

Respond with ONLY the route name, nothing else.`;

  // Call AgentKit for decision
  const result = await runAgentKit(
    context.userId,
    context.agent,
    prompt,
    {},
    context.sessionId
  );

  // Extract route from response
  const route = result.response.trim();

  // Validate route exists
  if (!step.routes[route]) {
    console.warn(`⚠️ [LLMRouter] LLM returned unknown route "${route}", using first available`);
    const fallbackRoute = Object.keys(step.routes)[0];
    return {
      route: fallbackRoute,
      matchedSteps: step.routes[fallbackRoute],
      llmResponse: result.response,
      tokensUsed: result.tokensUsed
    };
  }

  return {
    route,
    matchedSteps: step.routes[route],
    llmResponse: result.response,
    tokensUsed: result.tokensUsed
  };
}
```

---

### **Phase 3: Advanced Parallel Patterns (4-5 days)**

#### 3.1 Scatter-Gather Pattern

**Use Case**: "For each item, execute multiple operations in parallel, then merge results"

**Example**: Email enrichment from multiple sources
```json
{
  "id": "step2",
  "type": "scatter_gather",
  "name": "Enrich contacts from multiple sources",
  "scatter_over": "{{step1.data.emails}}",
  "parallel_steps": [
    {
      "id": "enrichA",
      "plugin": "hubspot",
      "action": "get_contact_by_email",
      "params": { "email": "{{current.email}}" }
    },
    {
      "id": "enrichB",
      "plugin": "clearbit",
      "action": "enrich",
      "params": { "email": "{{current.email}}" }
    },
    {
      "id": "enrichC",
      "plugin": "linkedin",
      "action": "find_profile",
      "params": { "email": "{{current.email}}" }
    }
  ],
  "gather_strategy": "merge", // "merge", "concat", "first_success", "all_success"
  "continue_on_error": true
}
```

**Result Structure**:
```json
{
  "data": [
    {
      "email": "john@example.com",
      "enrichA": { /* HubSpot data */ },
      "enrichB": { /* Clearbit data */ },
      "enrichC": { /* LinkedIn data */ },
      "merged": { /* Combined data based on strategy */ }
    },
    {
      "email": "jane@example.com",
      "enrichA": { /* HubSpot data */ },
      "enrichB": { /* Clearbit data */ },
      "enrichC": { /* LinkedIn data */ },
      "merged": { /* Combined data */ }
    }
  ]
}
```

**Implementation**:

**File 1**: `lib/pilot/types.ts`

```typescript
export interface ScatterGatherStep extends WorkflowStepBase {
  type: 'scatter_gather';
  scatter_over: string; // Variable reference to array (e.g., "{{step1.data}}")
  parallel_steps: WorkflowStep[]; // Steps to run for each item
  gather_strategy: 'merge' | 'concat' | 'first_success' | 'all_success';
  continue_on_error?: boolean; // Continue if some steps fail
  max_concurrency?: number; // Limit parallel operations (default: 3)
}
```

**File 2**: `lib/pilot/ParallelExecutor.ts` - Add scatter-gather

```typescript
/**
 * Execute scatter-gather pattern
 */
async executeScatterGather(
  step: ScatterGatherStep,
  context: ExecutionContext
): Promise<any[]> {
  // Resolve array to scatter over
  const items = context.resolveVariable(step.scatter_over);

  if (!Array.isArray(items)) {
    throw new Error(`Scatter-gather step ${step.id}: scatter_over must resolve to an array`);
  }

  console.log(`🎯 [ScatterGather] Processing ${items.length} items with ${step.parallel_steps.length} parallel operations each`);

  const results: any[] = [];
  const maxConcurrency = step.max_concurrency || 3;

  // Process items in batches to respect concurrency limit
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (item, batchIndex) => {
      const itemIndex = i + batchIndex;

      // Create temporary context for this item
      const itemContext = {
        ...context,
        variables: {
          ...context.variables,
          current: item,
          index: itemIndex
        }
      };

      // Execute all parallel steps for this item
      const itemResults: Record<string, any> = {
        index: itemIndex,
        item
      };

      const parallelPromises = step.parallel_steps.map(async (parallelStep) => {
        try {
          const stepResult = await this.stepExecutor.execute(parallelStep, itemContext);
          return {
            stepId: parallelStep.id,
            success: true,
            data: stepResult.data
          };
        } catch (error: any) {
          if (!step.continue_on_error) {
            throw error;
          }
          console.warn(`⚠️ [ScatterGather] Step ${parallelStep.id} failed for item ${itemIndex}:`, error.message);
          return {
            stepId: parallelStep.id,
            success: false,
            error: error.message
          };
        }
      });

      const parallelResults = await Promise.all(parallelPromises);

      // Store results by step ID
      parallelResults.forEach(result => {
        itemResults[result.stepId] = result.data;
      });

      // Apply gather strategy
      itemResults.merged = this.applyGatherStrategy(
        parallelResults,
        step.gather_strategy
      );

      return itemResults;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Apply gather strategy to merge parallel results
 */
private applyGatherStrategy(
  results: Array<{ stepId: string; success: boolean; data: any; error?: string }>,
  strategy: 'merge' | 'concat' | 'first_success' | 'all_success'
): any {
  switch (strategy) {
    case 'merge':
      // Deep merge all successful results
      return results
        .filter(r => r.success)
        .reduce((merged, r) => {
          return { ...merged, ...r.data };
        }, {});

    case 'concat':
      // Concatenate all arrays
      return results
        .filter(r => r.success)
        .flatMap(r => Array.isArray(r.data) ? r.data : [r.data]);

    case 'first_success':
      // Return first successful result
      const firstSuccess = results.find(r => r.success);
      return firstSuccess ? firstSuccess.data : null;

    case 'all_success':
      // Return all results (including failures)
      return results.map(r => ({
        stepId: r.stepId,
        success: r.success,
        data: r.data,
        error: r.error
      }));

    default:
      throw new Error(`Unknown gather strategy: ${strategy}`);
  }
}
```

**File 3**: `lib/pilot/StepExecutor.ts` - Add scatter_gather case

```typescript
case 'scatter_gather':
  result = await this.parallelExecutor.executeScatterGather(
    step as ScatterGatherStep,
    context
  );
  break;
```

---

#### 3.2 Fan-Out/Fan-In

**Use Case**: Split workflow into multiple parallel branches, then synchronize

**Example**: Multi-channel notification
```json
{
  "id": "step3",
  "type": "fan_out",
  "name": "Send notifications to all channels",
  "branches": [
    {
      "id": "email_branch",
      "steps": [
        { "id": "step4_email", "plugin": "sendgrid", "action": "send_email" }
      ]
    },
    {
      "id": "slack_branch",
      "steps": [
        { "id": "step5_slack", "plugin": "slack", "action": "send_message" }
      ]
    },
    {
      "id": "sms_branch",
      "steps": [
        { "id": "step6_sms", "plugin": "twilio", "action": "send_sms" }
      ]
    }
  ],
  "fan_in": {
    "wait_for": "all", // "all", "any", "n_of_m"
    "wait_for_count": 2, // If wait_for = "n_of_m"
    "timeout_ms": 30000 // 30 seconds
  }
}
```

**Implementation**: Similar to scatter-gather but with branch-level synchronization

---

#### 3.3 Dynamic Parallelism

**Use Case**: Determine parallel execution count at runtime

**Example**:
```json
{
  "id": "step2",
  "type": "dynamic_parallel",
  "determine_parallelism": {
    "method": "data_size", // or "llm_decision"
    "source": "{{step1.data}}",
    "max_parallel": 10,
    "min_parallel": 1
  },
  "operation": {
    "plugin": "data-processor",
    "action": "process_batch",
    "params": { "data": "{{current}}" }
  }
}
```

---

### **Phase 4: Data Operations & Validation (3-4 days)**

#### 4.1 Data Comparison Step

**Use Case**: Compare data from two sources, find differences, validate quality

**Example 1**: Find differences between datasets
```json
{
  "id": "step5",
  "type": "compare",
  "name": "Compare CRM vs enrichment data",
  "left": "{{step2.data}}",
  "right": "{{step3.data}}",
  "operation": "diff",
  "compare_by": "email", // Key field
  "output": {
    "only_in_left": true,
    "only_in_right": true,
    "matching": true,
    "different": true
  }
}
```

**Result**:
```json
{
  "only_in_left": [{ "email": "john@old.com" }],
  "only_in_right": [{ "email": "jane@new.com" }],
  "matching": [{ "email": "bob@same.com" }],
  "different": [
    {
      "email": "alice@example.com",
      "diff": {
        "name": { "left": "Alice", "right": "Alice Smith" },
        "company": { "left": "Acme", "right": "Acme Corp" }
      }
    }
  ]
}
```

**Example 2**: Validate data quality
```json
{
  "id": "step4",
  "type": "compare",
  "name": "Validate enriched data",
  "operation": "validate",
  "input": "{{step3.data}}",
  "schema": {
    "email": { "required": true, "format": "email" },
    "phone": { "required": false, "format": "phone" },
    "company": { "required": true, "minLength": 2 }
  },
  "on_invalid": "flag" // "flag", "skip", "fail"
}
```

**Implementation**:

**File 1**: `lib/pilot/types.ts`

```typescript
export interface CompareStep extends WorkflowStepBase {
  type: 'compare';
  operation: 'diff' | 'match' | 'validate' | 'merge';

  // For diff/match/merge
  left?: string;
  right?: string;
  compare_by?: string; // Key field for comparison

  // For validate
  input?: string;
  schema?: Record<string, any>;

  // Options
  output?: {
    only_in_left?: boolean;
    only_in_right?: boolean;
    matching?: boolean;
    different?: boolean;
  };
  on_invalid?: 'flag' | 'skip' | 'fail';
}
```

**File 2**: `lib/pilot/StepExecutor.ts`

```typescript
private async executeCompare(
  step: CompareStep,
  resolvedParams: any,
  context: ExecutionContext
): Promise<any> {
  switch (step.operation) {
    case 'diff':
      return this.compareArrays(
        context.resolveVariable(step.left!),
        context.resolveVariable(step.right!),
        step.compare_by,
        step.output
      );

    case 'validate':
      return this.validateData(
        context.resolveVariable(step.input!),
        step.schema!,
        step.on_invalid
      );

    case 'match':
      return this.matchRecords(
        context.resolveVariable(step.left!),
        context.resolveVariable(step.right!)
      );

    case 'merge':
      return this.mergeData(
        context.resolveVariable(step.left!),
        context.resolveVariable(step.right!),
        step.compare_by
      );

    default:
      throw new Error(`Unknown compare operation: ${step.operation}`);
  }
}

private compareArrays(
  left: any[],
  right: any[],
  compareBy?: string,
  output?: CompareStep['output']
): any {
  const result: any = {};

  // Build lookup maps
  const leftMap = new Map(left.map(item => [
    compareBy ? item[compareBy] : JSON.stringify(item),
    item
  ]));
  const rightMap = new Map(right.map(item => [
    compareBy ? item[compareBy] : JSON.stringify(item),
    item
  ]));

  // Find only in left
  if (output?.only_in_left) {
    result.only_in_left = left.filter(item => {
      const key = compareBy ? item[compareBy] : JSON.stringify(item);
      return !rightMap.has(key);
    });
  }

  // Find only in right
  if (output?.only_in_right) {
    result.only_in_right = right.filter(item => {
      const key = compareBy ? item[compareBy] : JSON.stringify(item);
      return !leftMap.has(key);
    });
  }

  // Find matching
  if (output?.matching || output?.different) {
    const matching: any[] = [];
    const different: any[] = [];

    left.forEach(leftItem => {
      const key = compareBy ? leftItem[compareBy] : JSON.stringify(leftItem);
      const rightItem = rightMap.get(key);

      if (rightItem) {
        const leftStr = JSON.stringify(leftItem);
        const rightStr = JSON.stringify(rightItem);

        if (leftStr === rightStr) {
          matching.push(leftItem);
        } else {
          // Find specific differences
          const diff: any = {};
          Object.keys({ ...leftItem, ...rightItem }).forEach(field => {
            if (JSON.stringify(leftItem[field]) !== JSON.stringify(rightItem[field])) {
              diff[field] = { left: leftItem[field], right: rightItem[field] };
            }
          });

          different.push({
            [compareBy || 'key']: key,
            diff
          });
        }
      }
    });

    if (output?.matching) result.matching = matching;
    if (output?.different) result.different = different;
  }

  return result;
}

private validateData(
  data: any[],
  schema: Record<string, any>,
  onInvalid: 'flag' | 'skip' | 'fail' = 'flag'
): any {
  const valid: any[] = [];
  const invalid: any[] = [];

  data.forEach((item, index) => {
    const errors: string[] = [];

    Object.entries(schema).forEach(([field, rules]) => {
      const value = item[field];

      // Check required
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
      }

      // Check format
      if (value && rules.format) {
        if (rules.format === 'email' && !this.isValidEmail(value)) {
          errors.push(`${field} must be valid email`);
        }
        if (rules.format === 'phone' && !this.isValidPhone(value)) {
          errors.push(`${field} must be valid phone`);
        }
      }

      // Check length
      if (value && rules.minLength && String(value).length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
    });

    if (errors.length === 0) {
      valid.push(item);
    } else {
      if (onInvalid === 'fail') {
        throw new Error(`Validation failed at index ${index}: ${errors.join(', ')}`);
      }

      if (onInvalid === 'flag') {
        invalid.push({ item, errors, index });
      }
      // If 'skip', just don't add to valid
    }
  });

  return {
    valid,
    invalid,
    validCount: valid.length,
    invalidCount: invalid.length,
    totalCount: data.length
  };
}

private isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

private isValidPhone(phone: string): boolean {
  return /^[\d\s\-\+\(\)]+$/.test(phone);
}
```

---

#### 4.2 Data Enrichment Pipeline

**Use Case**: Multi-stage enrichment with fallbacks

**Example**:
```json
{
  "id": "step2",
  "type": "enrichment_pipeline",
  "input": "{{step1.data.emails}}",
  "stages": [
    {
      "name": "primary_crm",
      "plugin": "hubspot",
      "action": "get_contact_by_email",
      "fallback_on_error": true
    },
    {
      "name": "secondary_enrichment",
      "plugin": "clearbit",
      "action": "enrich",
      "execute_if": "primary_crm.status != 'found'",
      "fallback_on_error": true
    },
    {
      "name": "tertiary_lookup",
      "plugin": "linkedin",
      "action": "find_profile",
      "execute_if": "secondary_enrichment.status != 'found'"
    }
  ]
}
```

---

#### 4.3 Built-in Joins/Merges

**Example**: Join contacts with companies
```json
{
  "id": "step4",
  "type": "join",
  "left": "{{step2.data.contacts}}",
  "right": "{{step3.data.companies}}",
  "join_type": "left", // "left", "right", "inner", "outer"
  "left_key": "company_id",
  "right_key": "id",
  "output_fields": {
    "contact_name": "left.name",
    "contact_email": "left.email",
    "company_name": "right.name",
    "company_size": "right.size"
  }
}
```

---

### **Phase 5: Sub-Workflows & Modularity (4-5 days)**

#### 5.1 Sub-Workflow Support

**Use Case**: Reusable workflow modules that can be called from parent workflows

**Example**: Email enrichment sub-workflow
```json
{
  "id": "step3",
  "type": "sub_workflow",
  "name": "Enrich email contacts",
  "workflow_id": "email-enrichment-v2",
  "input_mapping": {
    "emails": "{{step1.data.from_addresses}}",
    "enrich_level": "full"
  },
  "output_mapping": {
    "enriched_contacts": "{{sub.output.contacts}}",
    "enrichment_stats": "{{sub.output.stats}}"
  },
  "timeout_ms": 60000,
  "on_error": "continue" // or "fail", "retry"
}
```

**Implementation**:

**File 1**: `lib/pilot/types.ts`

```typescript
export interface SubWorkflowStep extends WorkflowStepBase {
  type: 'sub_workflow';
  workflow_id: string; // ID or name of workflow to execute
  input_mapping: Record<string, string>; // Map parent vars to sub inputs
  output_mapping: Record<string, string>; // Map sub outputs to parent vars
  timeout_ms?: number;
  on_error?: 'fail' | 'continue' | 'retry';
  max_retries?: number;
}
```

**File 2**: `lib/pilot/StepExecutor.ts`

```typescript
private async executeSubWorkflow(
  step: SubWorkflowStep,
  context: ExecutionContext
): Promise<any> {
  console.log(`🔗 [SubWorkflow] Executing sub-workflow: ${step.workflow_id}`);

  // Load sub-workflow definition
  const { data: subAgent, error } = await this.supabase
    .from('agents')
    .select('*')
    .or(`id.eq.${step.workflow_id},agent_name.eq.${step.workflow_id}`)
    .single();

  if (error || !subAgent) {
    throw new Error(`Sub-workflow not found: ${step.workflow_id}`);
  }

  if (!subAgent.workflow_steps || subAgent.workflow_steps.length === 0) {
    throw new Error(`Agent ${step.workflow_id} has no workflow_steps`);
  }

  // Resolve input mapping
  const subInputs: Record<string, any> = {};
  Object.entries(step.input_mapping).forEach(([subKey, parentExpr]) => {
    subInputs[subKey] = context.resolveVariable(parentExpr);
  });

  console.log(`📥 [SubWorkflow] Input mapping:`, subInputs);

  // Execute sub-workflow
  const subPilot = new WorkflowPilot(this.supabase);

  try {
    const subResult = await subPilot.execute(
      subAgent,
      context.userId,
      '', // userInput not needed for sub-workflows
      subInputs,
      context.sessionId
    );

    // Map outputs back to parent context
    const mappedOutputs: Record<string, any> = {};
    Object.entries(step.output_mapping).forEach(([parentKey, subExpr]) => {
      // Replace {{sub.output.X}} with actual value
      const subPath = subExpr.replace(/\{\{sub\.output\./g, '').replace(/\}\}/g, '');
      const value = this.getNestedValue(subResult.output, subPath.split('.'));
      mappedOutputs[parentKey] = value;
    });

    console.log(`📤 [SubWorkflow] Output mapping:`, mappedOutputs);

    return {
      subWorkflowId: step.workflow_id,
      subExecutionId: subResult.executionId,
      outputs: mappedOutputs,
      stepsCompleted: subResult.stepsCompleted,
      executionTime: subResult.totalExecutionTime
    };

  } catch (error: any) {
    console.error(`❌ [SubWorkflow] Execution failed:`, error.message);

    if (step.on_error === 'continue') {
      return {
        subWorkflowId: step.workflow_id,
        error: error.message,
        outputs: {}
      };
    }

    throw error;
  }
}

private getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const part of path) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}
```

**File 3**: Database - Add workflow library table

```sql
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT, -- 'enrichment', 'notification', 'data-processing', etc.
  workflow_steps JSONB NOT NULL,
  input_schema JSONB,
  output_schema JSONB,
  tags TEXT[],
  is_public BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

#### 5.2 Workflow Templates

**Features**:
- Template marketplace (browse, search, filter)
- Template versioning
- Import/export workflows
- Community sharing

**UI**:
- Admin → Workflow Templates
- Browse by category
- One-click import
- Template editor

---

### **Phase 6: Human-in-the-Loop & Advanced Error Handling (3-4 days)**

#### 6.1 Human Approval Step

**Use Case**: Pause workflow for manual approval before proceeding

**Example**:
```json
{
  "id": "step4",
  "type": "human_approval",
  "name": "Approve bulk email send",
  "message": "Ready to send {{step3.data.count}} emails to high-value customers. Total cost: ${{step3.data.estimated_cost}}",
  "data_preview": {
    "recipients": "{{step3.data.preview}}",
    "subject": "{{step3.data.subject}}"
  },
  "approvers": ["{{input.manager_id}}", "user-admin-123"],
  "require_all_approvers": false,
  "timeout_seconds": 3600,
  "on_timeout": "reject",
  "on_approval": ["step5_send_emails"],
  "on_rejection": ["step6_log_rejection"]
}
```

**Implementation**:

**File 1**: `lib/pilot/types.ts`

```typescript
export interface HumanApprovalStep extends WorkflowStepBase {
  type: 'human_approval';
  message: string;
  data_preview?: Record<string, any>;
  approvers: string[]; // User IDs who can approve
  require_all_approvers?: boolean; // All must approve vs any one
  timeout_seconds?: number;
  on_timeout?: 'approve' | 'reject' | 'fail';
  on_approval?: string[]; // Step IDs to execute if approved
  on_rejection?: string[]; // Step IDs to execute if rejected
}
```

**File 2**: Database table for approvals

```sql
CREATE TABLE workflow_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_id UUID REFERENCES workflow_executions(id) NOT NULL,
  step_id TEXT NOT NULL,
  message TEXT NOT NULL,
  data_preview JSONB,
  approvers UUID[] NOT NULL,
  require_all_approvers BOOLEAN DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'timeout')) DEFAULT 'pending',
  timeout_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id),
  resolution_comment TEXT
);

CREATE TABLE workflow_approval_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id UUID REFERENCES workflow_approvals(id) NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject')),
  comment TEXT,
  voted_at TIMESTAMPTZ DEFAULT NOW()
);
```

**File 3**: `lib/pilot/StepExecutor.ts`

```typescript
private async executeHumanApproval(
  step: HumanApprovalStep,
  resolvedParams: any,
  context: ExecutionContext
): Promise<any> {
  console.log(`⏸️ [HumanApproval] Pausing workflow for approval: ${step.name}`);

  // Resolve approvers
  const approverIds = step.approvers.map(id =>
    id.startsWith('{{') ? context.resolveVariable(id) : id
  );

  // Calculate timeout
  const timeoutAt = step.timeout_seconds
    ? new Date(Date.now() + step.timeout_seconds * 1000)
    : null;

  // Create approval record
  const { data: approval, error } = await this.supabase
    .from('workflow_approvals')
    .insert({
      workflow_execution_id: context.executionId,
      step_id: step.id,
      message: context.resolveAllVariables(step.message),
      data_preview: step.data_preview ? context.resolveAllVariables(step.data_preview) : null,
      approvers: approverIds,
      require_all_approvers: step.require_all_approvers || false,
      timeout_at: timeoutAt?.toISOString()
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create approval request: ${error.message}`);
  }

  // Pause workflow execution
  await this.stateManager.pauseExecution(context.executionId);

  // Send notifications to approvers
  await this.notifyApprovers(approverIds, approval, context);

  // Set up timeout handler (if specified)
  if (timeoutAt) {
    this.scheduleApprovalTimeout(approval.id, timeoutAt, step.on_timeout || 'reject');
  }

  return {
    approvalId: approval.id,
    status: 'pending',
    approvers: approverIds,
    timeoutAt: timeoutAt?.toISOString()
  };
}

private async notifyApprovers(
  approverIds: string[],
  approval: any,
  context: ExecutionContext
): Promise<void> {
  // Send email/slack notification to each approver
  // Include link to approval UI: /approvals/{approval.id}

  for (const approverId of approverIds) {
    // Send notification (email, Slack, in-app, etc.)
    console.log(`📧 [HumanApproval] Notifying approver: ${approverId}`);

    // TODO: Implement notification sending
    // Could use existing notification system or integrate with email/Slack
  }
}

private scheduleApprovalTimeout(
  approvalId: string,
  timeoutAt: Date,
  action: 'approve' | 'reject' | 'fail'
): void {
  // Schedule timeout handler
  // In production, this should use a job queue (e.g., QStash, Bull)

  const delay = timeoutAt.getTime() - Date.now();

  setTimeout(async () => {
    // Check if still pending
    const { data: approval } = await this.supabase
      .from('workflow_approvals')
      .select('status')
      .eq('id', approvalId)
      .single();

    if (approval?.status === 'pending') {
      console.log(`⏰ [HumanApproval] Timeout reached for ${approvalId}, action: ${action}`);

      // Update approval status
      await this.supabase
        .from('workflow_approvals')
        .update({
          status: 'timeout',
          resolved_at: new Date().toISOString()
        })
        .eq('id', approvalId);

      // Handle timeout action
      if (action === 'approve') {
        // Auto-approve and resume
        await this.processApprovalDecision(approvalId, 'approved');
      } else if (action === 'reject') {
        // Auto-reject and resume
        await this.processApprovalDecision(approvalId, 'rejected');
      } else {
        // Fail workflow
        // TODO: Mark workflow execution as failed
      }
    }
  }, delay);
}

private async processApprovalDecision(
  approvalId: string,
  decision: 'approved' | 'rejected'
): Promise<void> {
  // Resume workflow execution based on decision
  // This is called when user approves/rejects or timeout occurs

  const { data: approval } = await this.supabase
    .from('workflow_approvals')
    .select('workflow_execution_id')
    .eq('id', approvalId)
    .single();

  if (approval) {
    // Resume execution
    await this.stateManager.resumeExecution(approval.workflow_execution_id);
  }
}
```

**File 4**: Approval UI API route

```typescript
// app/api/approvals/[id]/route.ts
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { decision, comment } = await req.json(); // 'approve' or 'reject'
  const userId = req.headers.get('x-user-id'); // From auth

  // Validate user is an approver
  const { data: approval } = await supabase
    .from('workflow_approvals')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!approval.approvers.includes(userId)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Record vote
  await supabase.from('workflow_approval_votes').insert({
    approval_id: params.id,
    user_id: userId,
    vote: decision,
    comment
  });

  // Check if decision is final
  const { data: votes } = await supabase
    .from('workflow_approval_votes')
    .select('vote')
    .eq('approval_id', params.id);

  let finalDecision: 'approved' | 'rejected' | null = null;

  if (approval.require_all_approvers) {
    // All must approve
    const allApproved = approval.approvers.every(approverId =>
      votes.some(v => v.user_id === approverId && v.vote === 'approve')
    );
    const anyRejected = votes.some(v => v.vote === 'reject');

    if (allApproved) finalDecision = 'approved';
    if (anyRejected) finalDecision = 'rejected';
  } else {
    // Any one can approve/reject
    if (decision === 'approve') finalDecision = 'approved';
    if (decision === 'reject') finalDecision = 'rejected';
  }

  if (finalDecision) {
    // Update approval status
    await supabase
      .from('workflow_approvals')
      .update({
        status: finalDecision,
        resolved_at: new Date().toISOString(),
        resolved_by: userId
      })
      .eq('id', params.id);

    // Resume workflow
    const pilot = new WorkflowPilot(supabase);
    await pilot.resumeAfterApproval(approval.workflow_execution_id, finalDecision);
  }

  return NextResponse.json({ success: true, decision: finalDecision });
}
```

---

#### 6.2 Per-Step Timeouts

**Implementation**: Add timeout to each step

```typescript
export interface WorkflowStepBase {
  id: string;
  name?: string;
  type: string;
  dependencies?: string[];
  executeIf?: Condition | string;
  continueOnError?: boolean;
  retryPolicy?: RetryPolicy;
  timeout_ms?: number; // ADD THIS
  on_timeout?: 'fail' | 'skip' | 'retry'; // ADD THIS
}
```

**File**: `lib/pilot/StepExecutor.ts`

```typescript
async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
  const startTime = Date.now();

  // Wrap execution in timeout if specified
  if (step.timeout_ms) {
    return await this.executeWithTimeout(step, context, step.timeout_ms);
  }

  // ... existing execution logic ...
}

private async executeWithTimeout(
  step: WorkflowStep,
  context: ExecutionContext,
  timeoutMs: number
): Promise<StepOutput> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Step ${step.id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const executionPromise = this.executeStepInternal(step, context);

  try {
    return await Promise.race([executionPromise, timeoutPromise]);
  } catch (error: any) {
    if (error.message.includes('timed out')) {
      console.warn(`⏰ [StepExecutor] Step ${step.id} timed out`);

      if (step.on_timeout === 'skip') {
        return {
          stepId: step.id,
          plugin: step.plugin || 'system',
          action: step.action || step.type,
          data: null,
          metadata: {
            success: false,
            executedAt: new Date().toISOString(),
            executionTime: timeoutMs,
            error: 'Timeout',
            skipped: true
          }
        };
      }

      if (step.on_timeout === 'retry') {
        console.log(`🔄 [StepExecutor] Retrying timed-out step ${step.id}`);
        return await this.execute(step, context); // Retry once
      }

      // Default: fail
      throw error;
    }

    throw error;
  }
}

private async executeStepInternal(
  step: WorkflowStep,
  context: ExecutionContext
): Promise<StepOutput> {
  // All the existing execution logic from execute() method
  // ... (move existing code here)
}
```

---

#### 6.3 Circuit Breakers & Bulkheads

**Use Case**: Prevent cascade failures when external services are down

**Example**:
```json
{
  "id": "step2",
  "type": "action",
  "plugin": "external-api",
  "action": "fetch_data",
  "circuit_breaker": {
    "failure_threshold": 5,
    "timeout_ms": 5000,
    "reset_timeout_ms": 60000
  }
}
```

**Implementation**: Add circuit breaker to ErrorRecovery.ts

```typescript
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private failureThreshold: number,
    private resetTimeoutMs: number
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        console.log('🔧 Circuit breaker: Half-open, attempting recovery');
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await fn();

      // Success - reset circuit
      if (this.state === 'half-open') {
        console.log('✅ Circuit breaker: Closed, service recovered');
        this.state = 'closed';
        this.failures = 0;
      }

      return result;

    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.failureThreshold) {
        console.error(`🔥 Circuit breaker: OPEN after ${this.failures} failures`);
        this.state = 'open';
      }

      throw error;
    }
  }
}
```

---

#### 6.4 Advanced Retry Strategies

**Already Implemented**: Exponential backoff with jitter in ErrorRecovery.ts

**Enhancement**: Add smart retry (LLM decides if retry makes sense)

```typescript
private async shouldRetry(
  error: Error,
  attempt: number,
  maxRetries: number,
  context: ExecutionContext
): Promise<boolean> {
  // Simple heuristics
  if (attempt >= maxRetries) return false;
  if (error.message.includes('401') || error.message.includes('403')) return false; // Auth errors don't retry

  // Optional: Ask LLM if retry makes sense
  if (context.agent.smart_retry_enabled) {
    const prompt = `This operation failed with error: "${error.message}".
    Attempt ${attempt} of ${maxRetries}.
    Should we retry? Respond with YES or NO only.`;

    const result = await runAgentKit(
      context.userId,
      context.agent,
      prompt,
      {},
      context.sessionId
    );

    return result.response.toUpperCase().includes('YES');
  }

  return true;
}
```

---

### **Phase 7: SmartAgentBuilder Improvements (2-3 days)**

#### 7.1 Generate Dependencies

**Problem**: Generated workflows have all steps in parallel (no dependencies)

**Fix**: Update AI prompt in `app/api/generate-agent-v2/route.ts`

**Current Prompt** (Line ~189-195):
```typescript
const prompt = `Create a workflow for: ${userPrompt}

Available plugins: ${JSON.stringify(availablePlugins)}

Generate workflow_steps as JSON array...`
```

**New Prompt**:
```typescript
const prompt = `Create a workflow for: ${userPrompt}

Available plugins: ${JSON.stringify(availablePlugins)}

Generate workflow_steps as JSON array with these rules:

1. Each step must have an "id" (e.g., "step1", "step2", "step3")
2. Each step must have a "name" (human-readable description)
3. Each step must have a "type" (action, llm_decision, conditional, loop, transform)
4. For action steps, include "plugin" and "action" fields
5. **IMPORTANT**: Add "dependencies" array to indicate which steps must complete first
   - Example: { "id": "step2", "dependencies": ["step1"] } means step2 waits for step1
   - Steps without dependencies run immediately
   - Multiple dependencies: { "dependencies": ["step1", "step2"] } waits for both
6. **IMPORTANT**: Use variable references to pass data between steps
   - Format: {{stepX.data.fieldName}}
   - Example: { "params": { "email": "{{step1.data.from}}" } }
7. Generate sequential dependencies by default (step2 depends on step1, step3 depends on step2)
8. Only make steps parallel if they truly don't depend on each other

Example:
[
  {
    "id": "step1",
    "name": "Fetch emails",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": { "query": "is:unread" }
  },
  {
    "id": "step2",
    "name": "Extract sender emails",
    "type": "transform",
    "params": {
      "operation": "map",
      "input": "{{step1.data}}",
      "config": { "mapping": { "email": "{{current.from}}" } }
    },
    "dependencies": ["step1"]
  },
  {
    "id": "step3",
    "name": "Send notification",
    "type": "action",
    "plugin": "slack",
    "action": "send_message",
    "params": {
      "channel": "#inbox",
      "message": "Found {{step1.data.length}} new emails"
    },
    "dependencies": ["step2"]
  }
]

Now generate workflow_steps for: ${userPrompt}`;
```

---

#### 7.2 Generate Parameter References

**Enhancement**: Teach LLM to use {{variable}} syntax

**Add to prompt**:
```typescript
Parameter Reference Rules:
- Use {{input.fieldName}} for user-provided inputs
- Use {{step1.data.fieldName}} for output from previous steps
- Use {{step1.data[0].fieldName}} for array access
- Use {{step1.data.length}} for array length
- Always reference previous step outputs when possible

Bad: { "params": { "email": "" } }
Good: { "params": { "email": "{{step1.data.from}}" } }
```

---

#### 7.3 Better Default Parameters

**Enhancement**: Use plugin schema to generate sensible defaults

```typescript
// If plugin action requires "query" param for search_emails
// and user said "search for VIP emails"
// → Auto-fill: { "query": "from:{{input.vip_list}} is:unread" }

// Use LLM to infer parameter values from user intent
const paramPrompt = `This step needs parameter "${paramName}" for action "${action}".
Based on user intent: "${userPrompt}"
What should the value be? Use {{variable}} syntax if referencing previous steps.`;
```

---

### **Phase 8: Monitoring & Analytics (2-3 days)**

#### 8.1 Real-Time Progress Dashboard

**Features**:
- Visual DAG representation of workflow
- Real-time step progress via Supabase Realtime
- Color-coded step status (pending, running, completed, failed, skipped)
- Live execution metrics

**UI Component**: `components/pilot/PilotExecutionViewer.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function PilotExecutionViewer({ executionId }: { executionId: string }) {
  const [execution, setExecution] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    // Subscribe to real-time updates
    const channel = supabase
      .channel(`pilot-execution-${executionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workflow_executions',
          filter: `id=eq.${executionId}`
        },
        (payload) => {
          setExecution(payload.new);
        }
      )
      .subscribe();

    // Fetch initial state
    supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single()
      .then(({ data }) => setExecution(data));

    return () => {
      channel.unsubscribe();
    };
  }, [executionId]);

  if (!execution) return <div>Loading...</div>;

  return (
    <div className="pilot-execution-viewer">
      <h2>Workflow Execution: {execution.id}</h2>
      <div className="status">Status: {execution.status}</div>
      <div className="progress">
        {execution.completed_steps_count} / {execution.total_steps} steps completed
      </div>

      <div className="dag-visualization">
        {/* Render DAG from execution_plan */}
        {execution.execution_plan?.steps.map((step: any) => (
          <div key={step.stepId} className={`step step-${getStepStatus(step, execution)}`}>
            <div className="step-name">{step.name}</div>
            <div className="step-type">{step.type}</div>
          </div>
        ))}
      </div>

      <div className="step-timeline">
        {/* Render step execution timeline */}
        {execution.execution_trace?.stepExecutions.map((stepExec: any) => (
          <div key={stepExec.stepId} className="timeline-entry">
            <div className="step-id">{stepExec.stepId}</div>
            <div className="plugin">{stepExec.plugin}.{stepExec.action}</div>
            <div className="duration">{stepExec.metadata.executionTime}ms</div>
            <div className="status">{stepExec.metadata.success ? '✅' : '❌'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStepStatus(step: any, execution: any): string {
  const trace = execution.execution_trace;
  if (trace.completedSteps.includes(step.stepId)) return 'completed';
  if (trace.failedSteps.includes(step.stepId)) return 'failed';
  if (trace.skippedSteps.includes(step.stepId)) return 'skipped';
  if (execution.current_step === step.stepId) return 'running';
  return 'pending';
}
```

---

#### 8.2 Workflow Analytics

**Queries to Implement**:

```sql
-- Success/failure rates per step type
SELECT
  step_type,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(COUNT(*) FILTER (WHERE status = 'completed')::decimal / NULLIF(COUNT(*), 0) * 100, 2) as success_rate
FROM workflow_step_executions
GROUP BY step_type
ORDER BY COUNT(*) DESC;

-- Average execution time per step type
SELECT
  step_type,
  AVG((execution_metadata->>'executionTime')::int) as avg_execution_time_ms,
  MIN((execution_metadata->>'executionTime')::int) as min_time_ms,
  MAX((execution_metadata->>'executionTime')::int) as max_time_ms
FROM workflow_step_executions
WHERE status = 'completed'
GROUP BY step_type;

-- Bottleneck detection (slowest steps)
SELECT
  step_id,
  step_name,
  AVG((execution_metadata->>'executionTime')::int) as avg_time_ms,
  COUNT(*) as execution_count
FROM workflow_step_executions
WHERE status = 'completed'
GROUP BY step_id, step_name
ORDER BY avg_time_ms DESC
LIMIT 10;

-- Cost tracking per workflow
SELECT
  we.id,
  a.agent_name,
  we.total_tokens_used,
  ROUND(we.total_tokens_used::decimal / 1000 * 0.002, 4) as estimated_cost_usd,
  we.total_execution_time_ms,
  we.completed_steps_count
FROM workflow_executions we
JOIN agents a ON a.id = we.agent_id
WHERE we.status = 'completed'
ORDER BY we.total_tokens_used DESC;
```

---

#### 8.3 Alerting & SLA Monitoring

**Features**:
- Alert when workflow fails
- Alert when workflow exceeds expected duration
- Alert when step failure rate exceeds threshold
- Alert when cost exceeds budget

**Implementation**: Create alert rules table

```sql
CREATE TABLE pilot_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  agent_id UUID REFERENCES agents(id),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('failure', 'duration', 'cost', 'step_failure_rate')),
  threshold JSONB NOT NULL, -- { "max_duration_ms": 60000, "max_cost": 1.00, etc. }
  notification_channels TEXT[], -- ['email', 'slack', 'webhook']
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### **Phase 9: Enterprise Features (Optional, 4-6 weeks)**

#### 9.1 Workflow Versioning

**Features**:
- Version control for workflow definitions
- Rollback to previous versions
- A/B testing between versions
- Blue/green deployments

**Implementation**:

```sql
CREATE TABLE workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) NOT NULL,
  version_number INTEGER NOT NULL,
  workflow_steps JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT false,
  changelog TEXT,
  UNIQUE(agent_id, version_number)
);
```

---

#### 9.2 Multi-Tenancy

**Features**:
- Isolate workflows per organization
- Resource quotas per tenant
- Priority queues

---

#### 9.3 Workflow Marketplace

**Features**:
- Share workflows with community
- Browse/search templates
- One-click import
- Rating/reviews

---

## 📊 PRIORITY RANKING

### Must Have (Weeks 1-2) - Foundation
1. ✅ Fix `workflow_step_executions` logging (1 day)
2. ✅ Rename to "Pilot" (1 day)
3. ✅ Test resume capability (1 day)
4. ✅ Switch/case conditionals (2 days)
5. ✅ Scatter-gather patterns (3 days)
6. ✅ Data comparison steps (2 days)

**Total: ~10 days**

### Should Have (Weeks 3-4) - Advanced Features
7. ✅ Sub-workflows (4 days)
8. ✅ Human-in-the-loop approvals (3 days)
9. ✅ Per-step timeouts (1 day)
10. ✅ SmartAgentBuilder improvements (2 days)

**Total: ~10 days**

### Nice to Have (Weeks 5-6) - Polish
11. ✅ Real-time monitoring dashboard (3 days)
12. ✅ Advanced retry strategies (2 days)
13. ✅ Workflow templates (3 days)
14. ✅ Analytics improvements (2 days)

**Total: ~10 days**

### Future (Weeks 7+) - Enterprise
15. Workflow versioning (5 days)
16. A/B testing (3 days)
17. Marketplace (10 days)
18. Multi-tenancy (5 days)

---

## 🎯 EXPECTED OUTCOMES

After full implementation, the **Pilot** will support:

### ✅ Very Complex Agents
- 50+ steps per workflow
- Nested conditionals and loops
- Multiple parallel branches
- Dynamic workflow generation

### ✅ Many Plugins Coordinated
- Scatter-gather across 10+ data sources
- Intelligent fallbacks
- Circuit breakers for resilience
- Rate limiting and throttling

### ✅ Advanced Conditions
- Switch/case statements
- Nested if/else if/else chains
- LLM-based routing decisions
- Dynamic branch selection

### ✅ Data Enrichment
- Multi-source lookups with cascading fallbacks
- Data quality validation
- Schema enforcement
- Intelligent merging and deduplication

### ✅ Step Comparison
- Diff datasets from multiple sources
- Data quality scoring
- Anomaly detection
- Validation pipelines

### ✅ Full Orchestration
- Sub-workflows and modularity
- Human-in-the-loop approvals
- Pause/resume capability
- Real-time monitoring
- State-of-the-art features rivaling Temporal, Prefect, n8n

---

## 📁 FILES TO MODIFY

### Core Pilot Engine
- `lib/orchestrator/` → `lib/pilot/` (rename entire directory)
- `lib/pilot/WorkflowPilot.ts` (rename + add sub-workflow, resume improvements)
- `lib/pilot/StepExecutor.ts` (fix logging, add new step types: switch, compare, scatter_gather, human_approval, sub_workflow)
- `lib/pilot/ParallelExecutor.ts` (add scatter-gather, fan-out/fan-in)
- `lib/pilot/ConditionalEvaluator.ts` (add switch/case evaluation)
- `lib/pilot/types.ts` (add new step types)
- `lib/pilot/StateManager.ts` (add approval handling, improve resume)
- `lib/pilot/ErrorRecovery.ts` (add circuit breakers, smart retry)

### Integration
- `app/api/run-agent/route.ts` (update imports, variable names, config keys)
- `app/admin/system-config/page.tsx` (update UI labels, config keys)
- `app/api/generate-agent-v2/route.ts` (improve SmartAgentBuilder prompts)
- `lib/audit/events.ts` (rename orchestrator events to pilot events)

### New Files to Create
- `app/api/approvals/[id]/route.ts` (human approval API)
- `components/pilot/PilotExecutionViewer.tsx` (real-time monitoring UI)
- `components/pilot/ApprovalModal.tsx` (approval UI)
- `scripts/test-pilot-resume.ts` (resume capability tests)
- `scripts/test-pilot-scatter-gather.ts` (scatter-gather tests)

### Database Migrations
- Create: `workflow_approvals` table
- Create: `workflow_approval_votes` table
- Create: `workflow_templates` table
- Create: `workflow_versions` table (Phase 9)
- Create: `pilot_alert_rules` table
- Update: Rename `workflow_orchestrator_enabled` → `pilot_enabled` in system_config

### Documentation
- Rename: All `ORCHESTRATOR_*.md` → `PILOT_*.md`
- Update: All references in markdown files
- Create: `PILOT_USER_GUIDE.md` (user-facing documentation)
- Create: `PILOT_DEVELOPER_GUIDE.md` (developer documentation)

---

## 🚀 IMPLEMENTATION TIMELINE

### Week 1-2: Foundation (Must Have)
- Fix step logging
- Rename to Pilot
- Test resume
- Switch/case conditionals
- Scatter-gather
- Data comparison

**Deliverable**: Solid foundation with key missing features

### Week 3-4: Advanced Features (Should Have)
- Sub-workflows
- Human approvals
- Per-step timeouts
- SmartAgentBuilder improvements

**Deliverable**: Production-ready with advanced capabilities

### Week 5-6: Polish (Nice to Have)
- Real-time monitoring
- Advanced retry
- Workflow templates
- Analytics

**Deliverable**: State-of-the-art orchestration system

### Week 7+: Enterprise (Future)
- Versioning
- A/B testing
- Marketplace
- Multi-tenancy

**Deliverable**: Enterprise-grade platform

---

## ✅ SUCCESS CRITERIA

The Pilot system is considered state-of-the-art when:

1. ✅ Can handle workflows with 100+ steps without performance degradation
2. ✅ Supports 20+ different step types (action, llm, conditional, switch, loop, scatter, compare, etc.)
3. ✅ 99.9% execution reliability with circuit breakers and fallbacks
4. ✅ Real-time monitoring with <1 second latency
5. ✅ Human-in-the-loop workflows with approval tracking
6. ✅ Sub-workflow modularity for code reuse
7. ✅ Comprehensive analytics and cost tracking
8. ✅ Resume capability tested and working in production
9. ✅ Smart Agent Builder generates optimal workflows with proper dependencies
10. ✅ Documentation complete (user guide + developer guide)

---

## 📝 NOTES

- **Backward Compatibility**: All changes must maintain backward compatibility. Existing agents without workflow_steps continue using AgentKit unchanged.
- **Database Migrations**: Test all migrations in development before production.
- **Performance**: Monitor execution time increases. Target: <10% overhead vs. current implementation.
- **Testing**: Each phase should include comprehensive tests before moving to next phase.
- **Documentation**: Update docs as features are implemented, not at the end.

---

**End of Implementation Plan**
