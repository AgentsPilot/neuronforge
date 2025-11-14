# AgentPilot Workflow Orchestrator - System Design

**Version**: 1.0
**Author**: AI Systems Engineering Team
**Last Updated**: 2025-11-02

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System Analysis](#current-system-analysis)
3. [Architecture Overview](#architecture-overview)
4. [Core Components](#core-components)
5. [Data Flow & Execution Model](#data-flow--execution-model)
6. [Database Schema](#database-schema)
7. [API Design](#api-design)
8. [Security & Privacy](#security--privacy)
9. [Error Handling & Recovery](#error-handling--recovery)
10. [Performance Optimization](#performance-optimization)
11. [Integration Points](#integration-points)
12. [Implementation Roadmap](#implementation-roadmap)
13. [Testing Strategy](#testing-strategy)

---

## Executive Summary

### Problem Statement

AgentPilot currently stores LLM-generated `workflow_steps` in the database but **does not execute them**. All agent logic relies on:
- **AgentKit Path**: OpenAI's function calling with prompt engineering (intelligent but non-deterministic)
- **Legacy Path**: 8-phase orchestration with manual plugin coordination (complex, unmaintainable)

This limits complex automation use cases:
- ❌ No multi-step workflows with data enrichment
- ❌ No conditional branching (if/else logic)
- ❌ No loops/iterations over arrays
- ❌ No parallel execution of independent tasks
- ❌ No pause/resume capability for approval workflows
- ❌ No deterministic control flow

### Solution Overview

**Build a hybrid orchestration layer** that combines:
1. **Deterministic Workflow Execution** - Execute workflow_steps with precise control flow
2. **LLM Intelligence** - Use AgentKit/OpenAI for decisions within each step
3. **State Persistence** - Enable pause/resume, checkpointing, debugging
4. **Privacy-First Design** - Same sanitization as existing agent_logs

### Key Design Principles

✅ **Backward Compatible** - Agents without workflow_steps continue using AgentKit unchanged
✅ **Extend, Don't Replace** - Build on top of AgentKit's strengths (AIS tracking, memory, audit)
✅ **Hybrid Execution** - Deterministic orchestration + LLM intelligence
✅ **Observable** - Real-time progress tracking via Supabase Realtime
✅ **Recoverable** - Checkpoint after each step, support rollback
✅ **Privacy-Compliant** - Store metadata only, never customer data

---

## Current System Analysis

### Current Execution Paths

```
POST /api/run-agent
├── use_agentkit=true → AgentKit (RECOMMENDED)
│   ├── Model routing based on AIS score
│   ├── Memory injection from past runs
│   ├── OpenAI function calling loop (max 10 iterations)
│   ├── Plugin execution via PluginExecuterV2
│   ├── Intensity tracking (AIS)
│   └── Memory summarization (async)
│
├── use_queue=true → QStash Queue (Production)
│   └── Background execution via /api/execute-queued-agent
│
└── default → Legacy 8-Phase Orchestration (DEPRECATED)
    └── No AIS tracking, complex orchestration
```

### Current Agent Schema

```sql
CREATE TABLE agents (
  id UUID PRIMARY KEY,
  user_id UUID,
  agent_name TEXT,

  -- Prompts
  system_prompt TEXT,
  user_prompt TEXT,

  -- Plugins
  plugins_required TEXT[],

  -- I/O Schemas
  input_schema JSONB,
  output_schema JSONB,

  -- Workflow (STORED but NOT EXECUTED)
  workflow_steps JSONB,

  -- Triggers
  schedule_cron TEXT,

  -- Metadata
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Current workflow_steps Format (LLM-Generated)

```json
[
  {
    "id": "step1",
    "name": "Search VIP emails",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "is:unread from:{{vip_list}}"
    }
  },
  {
    "id": "step2",
    "name": "Enrich sender info",
    "type": "action",
    "plugin": "hubspot",
    "action": "get_contact_by_email",
    "params": {
      "email": "{{step1.data[*].from}}"
    },
    "dependencies": ["step1"]
  },
  {
    "id": "step3",
    "name": "Check urgency",
    "type": "conditional",
    "condition": {
      "field": "step2.data.priority",
      "operator": "==",
      "value": "high"
    }
  },
  {
    "id": "step4",
    "name": "Send to Slack",
    "type": "action",
    "plugin": "slack",
    "action": "send_message",
    "params": {
      "channel": "#urgent-vip",
      "message": "Urgent email from {{step1.data.from}}"
    },
    "dependencies": ["step3"],
    "executeIf": "step3.result == true"
  }
]
```

**Current State**: Created by SmartAgentBuilder LLM, stored in DB, **ignored during execution**.

---

## Architecture Overview

### System Context Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER / SCHEDULER                          │
│                   POST /api/run-agent                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR ENTRY POINT                      │
│              Check: agent.workflow_steps exists?                 │
│         ┌────────────┴──────────────┐                           │
│         ▼                            ▼                           │
│   YES: Workflow Mode          NO: AgentKit Mode                 │
│   Use WorkflowOrchestrator    Use runAgentKit (unchanged)       │
└─────────┬────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   WORKFLOW ORCHESTRATOR                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 1. WorkflowParser                                         │ │
│  │    - Parse workflow_steps into DAG                        │ │
│  │    - Resolve dependencies                                 │ │
│  │    - Detect parallel groups                               │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 2. ExecutionContext                                       │ │
│  │    - Initialize in-memory context                         │ │
│  │    - Load input values                                    │ │
│  │    - Load memory context (via MemoryInjector)             │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 3. StateManager                                           │ │
│  │    - Create workflow_executions record                    │ │
│  │    - Checkpoint after each step                           │ │
│  │    - Enable pause/resume                                  │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 4. Execution Loop                                         │ │
│  │    FOR each step in execution plan:                       │ │
│  │      ├─ ConditionalEvaluator.evaluate(step.condition)     │ │
│  │      ├─ StepExecutor.execute(step, context)               │ │
│  │      ├─ context.setStepOutput(stepId, result)             │ │
│  │      ├─ StateManager.checkpoint(context)                  │ │
│  │      └─ ErrorRecovery.handleError(error, step)            │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 5. OutputValidator                                        │ │
│  │    - Validate final output against output_schema          │ │
│  │    - Format response                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STEP EXECUTOR                               │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Step Type Router:                                         │ │
│  │  - action → PluginExecuterV2.execute()                    │ │
│  │  - llm_decision → AgentKit for complex logic              │ │
│  │  - loop → ParallelExecutor.executeLoop()                  │ │
│  │  - parallel_group → ParallelExecutor.executeParallel()    │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────┬──────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  PLUGIN EXECUTER V2                              │
│  (Existing system - unchanged)                                   │
│  - OAuth token management                                        │
│  - Parameter validation                                          │
│  - API calls to external services                                │
│  - Result formatting                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Component Architecture

```
lib/orchestrator/
├── types.ts                    # Core type definitions
├── WorkflowOrchestrator.ts     # Main orchestration engine
├── WorkflowParser.ts           # Parse workflow_steps into DAG
├── ExecutionContext.ts         # In-memory state management
├── StateManager.ts             # DB persistence layer
├── StepExecutor.ts             # Execute individual steps
├── ConditionalEvaluator.ts     # Safe expression evaluation
├── ParallelExecutor.ts         # Parallel step execution
├── ErrorRecovery.ts            # Retry & fallback logic
└── OutputValidator.ts          # Output schema validation
```

---

## Core Components

### 1. WorkflowParser

**Purpose**: Parse workflow_steps into executable dependency graph (DAG)

**Input**: `workflow_steps` JSONB from database

**Output**: `ExecutionPlan` with ordered steps and parallel groups

```typescript
interface ExecutionPlan {
  steps: ExecutionStep[];
  parallelGroups: ParallelGroup[];
  totalSteps: number;
  estimatedDuration: number;
}

interface ExecutionStep {
  stepId: string;
  stepDefinition: WorkflowStep;
  dependencies: string[];
  level: number;  // Execution level (0 = no deps, 1 = depends on level 0, etc.)
  canRunInParallel: boolean;
  parallelGroupId?: string;
}

class WorkflowParser {
  /**
   * Parse workflow steps into execution plan
   */
  parse(workflowSteps: WorkflowStep[]): ExecutionPlan {
    // 1. Build dependency graph
    const graph = this.buildDependencyGraph(workflowSteps);

    // 2. Topological sort
    const sortedSteps = this.topologicalSort(graph);

    // 3. Detect parallel groups (steps at same level with no interdependencies)
    const parallelGroups = this.detectParallelGroups(sortedSteps);

    // 4. Calculate execution levels
    const executionSteps = this.assignExecutionLevels(sortedSteps, graph);

    return {
      steps: executionSteps,
      parallelGroups,
      totalSteps: workflowSteps.length,
      estimatedDuration: this.estimateDuration(executionSteps)
    };
  }

  /**
   * Validate workflow for cycles and missing dependencies
   */
  validate(workflowSteps: WorkflowStep[]): ValidationResult {
    const errors: string[] = [];

    // Check for circular dependencies
    if (this.hasCycle(workflowSteps)) {
      errors.push('Circular dependency detected');
    }

    // Check for missing dependencies
    const stepIds = new Set(workflowSteps.map(s => s.id));
    workflowSteps.forEach(step => {
      step.dependencies?.forEach(depId => {
        if (!stepIds.has(depId)) {
          errors.push(`Step ${step.id} depends on non-existent step ${depId}`);
        }
      });
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
```

### 2. ExecutionContext

**Purpose**: Manage in-memory state during workflow execution

**Responsibilities**:
- Store step outputs
- Resolve variable references (e.g., `{{step1.data.email}}`)
- Track execution progress
- Provide context to ConditionalEvaluator

```typescript
interface ExecutionContext {
  // Execution metadata
  executionId: string;
  agentId: string;
  userId: string;
  sessionId: string;

  // Agent configuration
  agent: Agent;
  inputValues: Record<string, any>;

  // Execution state
  status: 'running' | 'paused' | 'completed' | 'failed';
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  skippedSteps: string[];  // Due to failed conditions

  // Step outputs (in-memory during execution)
  stepOutputs: Map<string, StepOutput>;

  // Runtime variables
  variables: Record<string, any>;

  // Memory context (from MemoryInjector)
  memoryContext: MemoryContext;

  // Timing
  startedAt: Date;
  completedAt?: Date;

  // Token tracking
  totalTokensUsed: number;
  totalExecutionTime: number;
}

interface StepOutput {
  stepId: string;
  plugin: string;
  action: string;

  // Actual plugin response (EPHEMERAL - not persisted)
  data: any;

  // Metadata (persisted to DB)
  metadata: {
    success: boolean;
    executedAt: string;
    executionTime: number;
    itemCount?: number;
    tokensUsed?: number;
    error?: string;
  };
}

class ExecutionContext {
  private stepOutputs: Map<string, StepOutput>;
  private variables: Record<string, any>;

  constructor(
    executionId: string,
    agent: Agent,
    userId: string,
    inputValues: Record<string, any>
  ) {
    this.executionId = executionId;
    this.agent = agent;
    this.userId = userId;
    this.inputValues = inputValues;
    this.stepOutputs = new Map();
    this.variables = {};
    this.completedSteps = [];
    this.failedSteps = [];
    this.skippedSteps = [];
  }

  /**
   * Store step output
   */
  setStepOutput(stepId: string, output: StepOutput): void {
    this.stepOutputs.set(stepId, output);
    if (output.metadata.success) {
      this.completedSteps.push(stepId);
    } else {
      this.failedSteps.push(stepId);
    }
  }

  /**
   * Get step output
   */
  getStepOutput(stepId: string): StepOutput | undefined {
    return this.stepOutputs.get(stepId);
  }

  /**
   * Resolve variable reference like {{step1.data.email}}
   */
  resolveVariable(reference: string): any {
    // Parse reference: "step1.data[0].email"
    const parts = reference.replace(/\{\{|\}\}/g, '').split('.');

    // Check if it's a step output reference
    if (parts[0].startsWith('step')) {
      const stepId = parts[0];
      const stepOutput = this.stepOutputs.get(stepId);

      if (!stepOutput) {
        throw new Error(`Step ${stepId} has not been executed yet`);
      }

      // Navigate nested path: data.email
      return this.getNestedValue(stepOutput, parts.slice(1));
    }

    // Check if it's an input value reference
    if (parts[0] === 'input') {
      return this.getNestedValue(this.inputValues, parts.slice(1));
    }

    // Check if it's a variable reference
    if (parts[0] === 'var') {
      return this.getNestedValue(this.variables, parts.slice(1));
    }

    throw new Error(`Unknown variable reference: ${reference}`);
  }

  /**
   * Resolve all variables in an object
   */
  resolveAllVariables(obj: any): any {
    if (typeof obj === 'string') {
      // Check if entire string is a variable reference
      if (obj.match(/^\{\{.*\}\}$/)) {
        return this.resolveVariable(obj);
      }

      // Replace inline variables: "Email from {{step1.data.sender}}"
      return obj.replace(/\{\{([^}]+)\}\}/g, (match, ref) => {
        return this.resolveVariable(`{{${ref}}}`);
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveAllVariables(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const resolved: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveAllVariables(value);
      }
      return resolved;
    }

    return obj;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string[]): any {
    let current = obj;

    for (const part of path) {
      // Handle array access: data[0]
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = current[key]?.[parseInt(index)];
      } else {
        current = current[part];
      }

      if (current === undefined) {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Get execution summary for checkpointing
   */
  getSummary(): ExecutionSummary {
    return {
      executionId: this.executionId,
      agentId: this.agent.id,
      userId: this.userId,
      status: this.status,
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      failedSteps: this.failedSteps,
      skippedSteps: this.skippedSteps,
      totalTokensUsed: this.totalTokensUsed,
      totalExecutionTime: this.totalExecutionTime,
      stepCount: {
        total: this.completedSteps.length + this.failedSteps.length + this.skippedSteps.length,
        completed: this.completedSteps.length,
        failed: this.failedSteps.length,
        skipped: this.skippedSteps.length
      }
    };
  }
}
```

### 3. StateManager

**Purpose**: Persist execution state to database for pause/resume and debugging

**Key Features**:
- Create workflow_executions record at start
- Checkpoint after each step
- Support pause/resume
- Store sanitized execution trace (metadata only)

```typescript
class StateManager {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Create new workflow execution record
   */
  async createExecution(
    agentId: string,
    userId: string,
    executionPlan: ExecutionPlan
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .insert({
        agent_id: agentId,
        user_id: userId,
        status: 'running',
        total_steps: executionPlan.totalSteps,
        execution_plan: {
          steps: executionPlan.steps.map(s => ({
            stepId: s.stepId,
            name: s.stepDefinition.name,
            type: s.stepDefinition.type,
            dependencies: s.dependencies,
            level: s.level
          })),
          parallelGroups: executionPlan.parallelGroups
        },
        started_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  /**
   * Checkpoint execution state after each step
   */
  async checkpoint(context: ExecutionContext): Promise<void> {
    const summary = context.getSummary();

    // Build sanitized execution trace (metadata only)
    const executionTrace = {
      completedSteps: summary.completedSteps,
      failedSteps: summary.failedSteps,
      skippedSteps: summary.skippedSteps,
      stepExecutions: Array.from(context.stepOutputs.entries()).map(([stepId, output]) => ({
        stepId,
        plugin: output.plugin,
        action: output.action,
        metadata: output.metadata  // Only metadata, not actual data
      }))
    };

    await this.supabase
      .from('workflow_executions')
      .update({
        status: summary.status,
        current_step: summary.currentStep,
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        execution_trace: executionTrace,
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime,
        updated_at: new Date().toISOString()
      })
      .eq('id', context.executionId);
  }

  /**
   * Mark execution as completed
   */
  async completeExecution(
    executionId: string,
    finalOutput: any,
    context: ExecutionContext
  ): Promise<void> {
    const summary = context.getSummary();

    await this.supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        final_output: finalOutput,
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime
      })
      .eq('id', executionId);
  }

  /**
   * Mark execution as failed
   */
  async failExecution(
    executionId: string,
    error: Error,
    context: ExecutionContext
  ): Promise<void> {
    await this.supabase
      .from('workflow_executions')
      .update({
        status: 'failed',
        error_message: error.message,
        failed_at: new Date().toISOString()
      })
      .eq('id', executionId);
  }

  /**
   * Pause execution
   */
  async pauseExecution(executionId: string): Promise<void> {
    await this.supabase
      .from('workflow_executions')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString()
      })
      .eq('id', executionId);
  }

  /**
   * Resume execution (restore context from checkpoint)
   */
  async resumeExecution(executionId: string): Promise<ExecutionContext> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*, agents(*)')
      .eq('id', executionId)
      .single();

    if (error) throw error;

    // Reconstruct ExecutionContext from checkpoint
    const context = new ExecutionContext(
      data.id,
      data.agents,
      data.user_id,
      data.input_values || {}
    );

    // Restore state
    context.completedSteps = data.execution_trace?.completedSteps || [];
    context.failedSteps = data.execution_trace?.failedSteps || [];
    context.skippedSteps = data.execution_trace?.skippedSteps || [];
    context.totalTokensUsed = data.total_tokens_used || 0;
    context.totalExecutionTime = data.total_execution_time_ms || 0;

    // Note: Actual step output data is NOT restored (ephemeral)
    // Only metadata is available

    return context;
  }
}
```

### 4. ConditionalEvaluator

**Purpose**: Safely evaluate conditional expressions from workflow steps

**Security**: Uses safe expression parser (NO eval() or Function constructor)

```typescript
class ConditionalEvaluator {
  /**
   * Evaluate condition against execution context
   */
  evaluate(condition: Condition, context: ExecutionContext): boolean {
    if (!condition) return true;

    // Simple condition: { field: "step1.data.score", operator: ">", value: 70 }
    if (condition.field && condition.operator && condition.value !== undefined) {
      return this.evaluateSimpleCondition(condition, context);
    }

    // Complex condition: { and: [...], or: [...], not: {...} }
    if (condition.and) {
      return condition.and.every(c => this.evaluate(c, context));
    }

    if (condition.or) {
      return condition.or.some(c => this.evaluate(c, context));
    }

    if (condition.not) {
      return !this.evaluate(condition.not, context);
    }

    // Expression string: "step1.data.score > 70 && step2.success"
    if (typeof condition === 'string') {
      return this.evaluateExpression(condition, context);
    }

    return false;
  }

  /**
   * Evaluate simple condition
   */
  private evaluateSimpleCondition(
    condition: { field: string; operator: string; value: any },
    context: ExecutionContext
  ): boolean {
    const actualValue = context.resolveVariable(`{{${condition.field}}}`);

    switch (condition.operator) {
      case '==':
      case 'equals':
        return actualValue == condition.value;

      case '!=':
      case 'not_equals':
        return actualValue != condition.value;

      case '>':
      case 'greater_than':
        return actualValue > condition.value;

      case '>=':
      case 'greater_than_or_equal':
        return actualValue >= condition.value;

      case '<':
      case 'less_than':
        return actualValue < condition.value;

      case '<=':
      case 'less_than_or_equal':
        return actualValue <= condition.value;

      case 'contains':
        return String(actualValue).includes(String(condition.value));

      case 'not_contains':
        return !String(actualValue).includes(String(condition.value));

      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(actualValue);

      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(actualValue);

      case 'exists':
        return actualValue !== undefined && actualValue !== null;

      case 'not_exists':
        return actualValue === undefined || actualValue === null;

      case 'is_empty':
        return !actualValue || (Array.isArray(actualValue) && actualValue.length === 0);

      case 'is_not_empty':
        return actualValue && (!Array.isArray(actualValue) || actualValue.length > 0);

      default:
        throw new Error(`Unknown operator: ${condition.operator}`);
    }
  }

  /**
   * Safely evaluate expression string (NO eval!)
   * Uses a simple recursive descent parser
   */
  private evaluateExpression(expression: string, context: ExecutionContext): boolean {
    // Resolve all variables first
    const resolved = expression.replace(/\{\{([^}]+)\}\}/g, (match, ref) => {
      const value = context.resolveVariable(`{{${ref}}}`);

      // Convert to JSON-safe string
      if (typeof value === 'string') return `"${value}"`;
      return JSON.stringify(value);
    });

    // Parse and evaluate using safe parser
    // (Implementation uses recursive descent parser, not shown for brevity)
    return this.safeEvaluate(resolved);
  }

  /**
   * Safe expression evaluator (simplified)
   */
  private safeEvaluate(expression: string): boolean {
    // This is a simplified version
    // Production would use a proper expression parser library like mathjs or jsep

    // For now, support basic comparisons
    const comparisons = [
      { op: '>=', fn: (a: any, b: any) => a >= b },
      { op: '<=', fn: (a: any, b: any) => a <= b },
      { op: '>', fn: (a: any, b: any) => a > b },
      { op: '<', fn: (a: any, b: any) => a < b },
      { op: '==', fn: (a: any, b: any) => a == b },
      { op: '!=', fn: (a: any, b: any) => a != b }
    ];

    for (const { op, fn } of comparisons) {
      if (expression.includes(op)) {
        const [left, right] = expression.split(op).map(s => s.trim());
        const leftVal = this.parseValue(left);
        const rightVal = this.parseValue(right);
        return fn(leftVal, rightVal);
      }
    }

    // Boolean literals
    if (expression === 'true') return true;
    if (expression === 'false') return false;

    throw new Error(`Cannot evaluate expression: ${expression}`);
  }

  private parseValue(value: string): any {
    // Try number
    if (!isNaN(Number(value))) return Number(value);

    // Try boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Try string (remove quotes)
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    return value;
  }
}
```

### 5. StepExecutor

**Purpose**: Execute individual workflow steps

**Supports**:
- `action` steps → Plugin execution via PluginExecuterV2
- `llm_decision` steps → AgentKit for complex logic
- `transform` steps → Data transformation
- `delay` steps → Wait/sleep

```typescript
class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Execute a single workflow step
   */
  async execute(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<StepOutput> {
    const startTime = Date.now();

    try {
      // Resolve parameters with variable substitution
      const resolvedParams = context.resolveAllVariables(step.params || {});

      let result: any;

      switch (step.type) {
        case 'action':
          result = await this.executeAction(step, resolvedParams, context);
          break;

        case 'llm_decision':
          result = await this.executeLLMDecision(step, resolvedParams, context);
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
          itemCount: Array.isArray(result) ? result.length : undefined
        }
      };

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.WORKFLOW_STEP_COMPLETED,
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

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.WORKFLOW_STEP_FAILED,
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
        severity: 'error'
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

  /**
   * Execute plugin action
   */
  private async executeAction(
    step: WorkflowStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    if (!step.plugin || !step.action) {
      throw new Error(`Action step ${step.id} missing plugin or action`);
    }

    // Execute via PluginExecuterV2
    const result = await PluginExecuterV2.execute(
      context.userId,
      step.plugin,
      step.action,
      params
    );

    if (!result.success) {
      throw new Error(result.error || `Plugin execution failed: ${step.plugin}.${step.action}`);
    }

    return result.data;
  }

  /**
   * Execute LLM decision step (uses AgentKit)
   */
  private async executeLLMDecision(
    step: WorkflowStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    // Build prompt with context
    const prompt = `
${step.description || step.name}

Context:
${JSON.stringify(params, null, 2)}

Available Information:
${this.buildContextSummary(context)}

Please analyze and provide your decision.
    `.trim();

    // Use AgentKit for intelligent decision
    const result = await runAgentKit(
      context.userId,
      context.agent,
      prompt,
      {},
      context.sessionId
    );

    return {
      decision: result.response,
      reasoning: result.response
    };
  }

  /**
   * Execute data transformation
   */
  private async executeTransform(
    step: WorkflowStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    // Simple transformations: map, filter, reduce, etc.
    const { operation, input, config } = params;

    const data = context.resolveVariable(input);

    switch (operation) {
      case 'map':
        // Apply mapping function to each item
        return data.map((item: any) => this.applyMapping(item, config.mapping, context));

      case 'filter':
        // Filter based on condition
        return data.filter((item: any) => {
          const itemContext = { ...context, variables: { ...context.variables, current: item } };
          return new ConditionalEvaluator().evaluate(config.condition, itemContext);
        });

      case 'reduce':
        // Reduce to single value
        return data.reduce((acc: any, item: any) => {
          return this.applyReduction(acc, item, config.reducer);
        }, config.initialValue);

      case 'sort':
        // Sort by field
        return [...data].sort((a: any, b: any) => {
          const aVal = a[config.field];
          const bVal = b[config.field];
          return config.order === 'desc' ? bVal - aVal : aVal - bVal;
        });

      case 'group':
        // Group by field
        return data.reduce((acc: any, item: any) => {
          const key = item[config.field];
          if (!acc[key]) acc[key] = [];
          acc[key].push(item);
          return acc;
        }, {});

      default:
        throw new Error(`Unknown transform operation: ${operation}`);
    }
  }

  /**
   * Execute delay step
   */
  private async executeDelay(
    step: WorkflowStep,
    params: any
  ): Promise<void> {
    const { duration } = params; // milliseconds
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Build context summary for LLM
   */
  private buildContextSummary(context: ExecutionContext): string {
    const completedSteps = context.completedSteps
      .map(stepId => {
        const output = context.getStepOutput(stepId);
        return `- ${stepId}: ${output?.plugin}.${output?.action} (${output?.metadata.itemCount || 0} items)`;
      })
      .join('\n');

    return `
Completed Steps:
${completedSteps}

Input Values:
${JSON.stringify(context.inputValues, null, 2)}
    `.trim();
  }
}
```

### 6. ParallelExecutor

**Purpose**: Execute multiple independent steps in parallel

**Features**:
- Detect steps at same execution level with no interdependencies
- Respect connection pooling limits (max 3 concurrent plugin calls)
- Aggregate results

```typescript
class ParallelExecutor {
  private stepExecutor: StepExecutor;
  private maxConcurrency: number;

  constructor(stepExecutor: StepExecutor, maxConcurrency: number = 3) {
    this.stepExecutor = stepExecutor;
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Execute parallel group of steps
   */
  async executeParallel(
    steps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<Map<string, StepOutput>> {
    const results = new Map<string, StepOutput>();

    // Execute with concurrency limit
    const chunks = this.chunkArray(steps, this.maxConcurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(step =>
        this.stepExecutor.execute(step, context)
      );

      const chunkResults = await Promise.all(promises);

      chunkResults.forEach((result, index) => {
        results.set(chunk[index].id, result);
      });
    }

    return results;
  }

  /**
   * Execute loop over array of items
   */
  async executeLoop(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const { iterateOver, maxIterations = 100 } = step.params || {};

    // Resolve array to iterate over
    const items = context.resolveVariable(iterateOver);

    if (!Array.isArray(items)) {
      throw new Error(`Loop step ${step.id}: iterateOver must resolve to an array`);
    }

    const limitedItems = items.slice(0, maxIterations);
    const results: any[] = [];

    // Execute loop body for each item
    // (Sequential execution to maintain order and avoid overwhelming APIs)
    for (let i = 0; i < limitedItems.length; i++) {
      const item = limitedItems[i];

      // Create temporary context with current item
      const loopContext = {
        ...context,
        variables: {
          ...context.variables,
          current: item,
          index: i
        }
      };

      // Execute loop body steps
      const loopSteps = step.loopSteps || [];
      for (const loopStep of loopSteps) {
        const result = await this.stepExecutor.execute(loopStep, loopContext);
        results.push(result.data);

        // If step failed and continueOnError is false, break
        if (!result.metadata.success && !step.continueOnError) {
          throw new Error(`Loop iteration ${i} failed: ${result.metadata.error}`);
        }
      }
    }

    return results;
  }

  /**
   * Chunk array for parallel execution with concurrency limit
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

### 7. WorkflowOrchestrator (Main Engine)

**Purpose**: Main orchestration engine that coordinates all components

```typescript
class WorkflowOrchestrator {
  private supabase: SupabaseClient;
  private parser: WorkflowParser;
  private stateManager: StateManager;
  private stepExecutor: StepExecutor;
  private parallelExecutor: ParallelExecutor;
  private conditionalEvaluator: ConditionalEvaluator;
  private errorRecovery: ErrorRecovery;
  private outputValidator: OutputValidator;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.parser = new WorkflowParser();
    this.stateManager = new StateManager(supabase);
    this.stepExecutor = new StepExecutor(supabase);
    this.parallelExecutor = new ParallelExecutor(this.stepExecutor);
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.errorRecovery = new ErrorRecovery();
    this.outputValidator = new OutputValidator();
  }

  /**
   * Execute workflow
   */
  async execute(
    agent: Agent,
    userId: string,
    userInput: string,
    inputValues: Record<string, any>,
    sessionId: string
  ): Promise<WorkflowExecutionResult> {
    // 1. Parse workflow
    const workflowSteps = agent.workflow_steps as WorkflowStep[];
    const executionPlan = this.parser.parse(workflowSteps);

    // 2. Validate workflow
    const validation = this.parser.validate(workflowSteps);
    if (!validation.valid) {
      throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`);
    }

    // 3. Initialize context
    const context = new ExecutionContext(
      '', // executionId set below
      agent,
      userId,
      inputValues
    );
    context.sessionId = sessionId;

    // 4. Load memory context
    const memoryContext = await MemoryInjector.buildMemoryContext(
      agent.id,
      userId,
      { userInput, inputValues }
    );
    context.memoryContext = memoryContext;

    // 5. Create execution record
    const executionId = await this.stateManager.createExecution(
      agent.id,
      userId,
      executionPlan
    );
    context.executionId = executionId;

    try {
      // 6. Execute steps
      await this.executeSteps(executionPlan, context);

      // 7. Validate output
      const finalOutput = this.buildFinalOutput(context, agent.output_schema);
      const validationResult = await this.outputValidator.validate(
        finalOutput,
        agent.output_schema
      );

      if (!validationResult.valid) {
        console.warn('Output validation failed:', validationResult.errors);
      }

      // 8. Mark as completed
      await this.stateManager.completeExecution(executionId, finalOutput, context);

      // 9. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('AIS update failed (non-critical):', err)
      );

      // 10. Summarize for memory (async)
      MemorySummarizer.summarizeExecution(
        agent.id,
        userId,
        executionId,
        context.getSummary()
      ).catch(err =>
        console.error('Memory summarization failed (non-critical):', err)
      );

      return {
        success: true,
        executionId,
        output: finalOutput,
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: context.totalTokensUsed
      };

    } catch (error: any) {
      await this.stateManager.failExecution(executionId, error, context);

      throw error;
    }
  }

  /**
   * Execute all steps in execution plan
   */
  private async executeSteps(
    plan: ExecutionPlan,
    context: ExecutionContext
  ): Promise<void> {
    const stepsByLevel = this.groupStepsByLevel(plan.steps);

    // Execute each level sequentially
    for (const [level, steps] of stepsByLevel.entries()) {
      console.log(`Executing level ${level} with ${steps.length} steps`);

      // Group steps by parallel groups
      const parallelGroups = this.groupByParallelGroup(steps);

      for (const group of parallelGroups) {
        if (group.length === 1) {
          // Single step - execute directly
          await this.executeSingleStep(group[0], context);
        } else {
          // Parallel group - execute concurrently
          await this.executeParallelGroup(group, context);
        }
      }
    }
  }

  /**
   * Execute single step with conditional check
   */
  private async executeSingleStep(
    step: ExecutionStep,
    context: ExecutionContext
  ): Promise<void> {
    const stepDef = step.stepDefinition;

    // Check executeIf condition
    if (stepDef.executeIf) {
      const shouldExecute = this.conditionalEvaluator.evaluate(
        stepDef.executeIf,
        context
      );

      if (!shouldExecute) {
        console.log(`Skipping step ${step.stepId} - condition not met`);
        context.skippedSteps.push(step.stepId);
        return;
      }
    }

    // Handle conditional type
    if (stepDef.type === 'conditional') {
      const result = this.conditionalEvaluator.evaluate(
        stepDef.condition!,
        context
      );

      // Store condition result for downstream steps
      context.setStepOutput(step.stepId, {
        stepId: step.stepId,
        plugin: 'system',
        action: 'conditional',
        data: { result },
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 0
        }
      });

      return;
    }

    // Handle loop type
    if (stepDef.type === 'loop') {
      const results = await this.parallelExecutor.executeLoop(stepDef, context);

      context.setStepOutput(step.stepId, {
        stepId: step.stepId,
        plugin: 'system',
        action: 'loop',
        data: results,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 0,
          itemCount: results.length
        }
      });

      await this.stateManager.checkpoint(context);
      return;
    }

    // Execute step
    context.currentStep = step.stepId;

    const output = await this.errorRecovery.executeWithRetry(
      () => this.stepExecutor.execute(stepDef, context),
      stepDef.retryPolicy
    );

    // Store output
    context.setStepOutput(step.stepId, output);

    // Checkpoint
    await this.stateManager.checkpoint(context);
  }

  /**
   * Execute parallel group
   */
  private async executeParallelGroup(
    steps: ExecutionStep[],
    context: ExecutionContext
  ): Promise<void> {
    const stepDefs = steps.map(s => s.stepDefinition);

    const results = await this.parallelExecutor.executeParallel(stepDefs, context);

    // Store all results
    results.forEach((output, stepId) => {
      context.setStepOutput(stepId, output);
    });

    // Checkpoint
    await this.stateManager.checkpoint(context);
  }

  /**
   * Build final output from context
   */
  private buildFinalOutput(
    context: ExecutionContext,
    outputSchema: any[]
  ): any {
    // If output schema specifies which steps to include
    if (outputSchema && outputSchema.length > 0) {
      const output: any = {};

      outputSchema.forEach((schema: any) => {
        if (schema.source) {
          // Get data from specific step
          const value = context.resolveVariable(`{{${schema.source}}}`);
          output[schema.name] = value;
        }
      });

      return output;
    }

    // Default: return all step outputs
    const output: any = {};
    context.stepOutputs.forEach((stepOutput, stepId) => {
      output[stepId] = stepOutput.data;
    });

    return output;
  }

  /**
   * Group steps by execution level
   */
  private groupStepsByLevel(steps: ExecutionStep[]): Map<number, ExecutionStep[]> {
    const levels = new Map<number, ExecutionStep[]>();

    steps.forEach(step => {
      const level = step.level;
      if (!levels.has(level)) {
        levels.set(level, []);
      }
      levels.get(level)!.push(step);
    });

    // Sort by level
    return new Map([...levels.entries()].sort((a, b) => a[0] - b[0]));
  }

  /**
   * Group steps by parallel group
   */
  private groupByParallelGroup(steps: ExecutionStep[]): ExecutionStep[][] {
    const groups: Map<string, ExecutionStep[]> = new Map();
    const ungrouped: ExecutionStep[] = [];

    steps.forEach(step => {
      if (step.parallelGroupId) {
        if (!groups.has(step.parallelGroupId)) {
          groups.set(step.parallelGroupId, []);
        }
        groups.get(step.parallelGroupId)!.push(step);
      } else {
        ungrouped.push(step);
      }
    });

    return [
      ...Array.from(groups.values()),
      ...ungrouped.map(s => [s])
    ];
  }

  /**
   * Update AIS metrics after execution
   */
  private async updateAISMetrics(
    agentId: string,
    context: ExecutionContext
  ): Promise<void> {
    // Build execution data for AIS
    const executionData = {
      agent_id: agentId,
      execution_id: context.executionId,
      status: 'success',
      duration_ms: context.totalExecutionTime,
      tokens_used: context.totalTokensUsed,
      plugin_calls: Array.from(context.stepOutputs.values()).filter(
        o => o.plugin !== 'system'
      ).length,
      workflow_steps_executed: context.completedSteps.length,
      iterations: 1, // Workflows don't iterate like AgentKit
      model_used: 'workflow', // Workflows use multiple models via steps
      provider: 'orchestrator'
    };

    await updateAgentIntensityMetrics(this.supabase, executionData);
  }
}
```

---

## Data Flow & Execution Model

### High-Level Flow

```
1. User triggers agent execution
   ↓
2. Check if agent.workflow_steps exists
   ↓
3a. NO → Use AgentKit (existing behavior)
   ↓
3b. YES → Use WorkflowOrchestrator
   ↓
4. Parse workflow_steps into execution plan (DAG)
   ↓
5. Initialize ExecutionContext with input values
   ↓
6. Load memory context from past runs
   ↓
7. Create workflow_executions record (state persistence)
   ↓
8. For each execution level:
   ├─ Check conditional expressions
   ├─ Execute parallel groups concurrently
   ├─ Execute single steps sequentially
   ├─ Store step outputs in context
   └─ Checkpoint state to DB
   ↓
9. Validate final output against output_schema
   ↓
10. Update AIS metrics (async)
    ↓
11. Summarize for memory (async)
    ↓
12. Return WorkflowExecutionResult
```

### Data Passing Between Steps

```typescript
// Example workflow
[
  {
    id: "step1",
    type: "action",
    plugin: "google-mail",
    action: "search_emails",
    params: { query: "is:unread" }
  },
  {
    id: "step2",
    type: "transform",
    params: {
      operation: "map",
      input: "{{step1.data}}",  // Reference step1 output
      config: {
        mapping: {
          email: "{{current.from}}",
          subject: "{{current.subject}}"
        }
      }
    }
  },
  {
    id: "step3",
    type: "action",
    plugin: "hubspot",
    action: "enrich_contacts",
    params: {
      emails: "{{step2.data[*].email}}"  // Reference step2 output
    }
  }
]

// Execution flow:
// 1. step1 executes → stores output in context.stepOutputs.get("step1")
// 2. step2 resolves {{step1.data}} from context → transforms → stores output
// 3. step3 resolves {{step2.data[*].email}} from context → executes plugin
```

### Variable Resolution

```typescript
// Supported variable references:
{{step1.data.email}}           // Step output field
{{step1.data[0].email}}        // Array access
{{input.recipient}}            // User input value
{{var.counter}}                // Runtime variable
{{current.item}}               // Loop current item

// Resolution process:
1. ExecutionContext.resolveVariable("{{step1.data.email}}")
2. Split reference: ["step1", "data", "email"]
3. Get step output: context.stepOutputs.get("step1")
4. Navigate nested path: output.data.email
5. Return resolved value
```

---

## Database Schema

### New Tables

```sql
-- Workflow Executions (main execution records)
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Execution state
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  current_step TEXT,

  -- Execution plan (for debugging)
  execution_plan JSONB,
  total_steps INTEGER,

  -- Progress tracking
  completed_steps_count INTEGER DEFAULT 0,
  failed_steps_count INTEGER DEFAULT 0,
  skipped_steps_count INTEGER DEFAULT 0,

  -- Execution trace (SANITIZED - metadata only)
  execution_trace JSONB,

  -- Input/Output
  input_values JSONB,
  final_output JSONB,

  -- Metrics
  total_tokens_used INTEGER DEFAULT 0,
  total_execution_time_ms INTEGER DEFAULT 0,

  -- Error handling
  error_message TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes
  INDEX idx_workflow_executions_agent_id (agent_id),
  INDEX idx_workflow_executions_user_id (user_id),
  INDEX idx_workflow_executions_status (status),
  INDEX idx_workflow_executions_started_at (started_at DESC)
);

-- Workflow Step Executions (detailed step logs)
CREATE TABLE workflow_step_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,

  -- Step identification
  step_id TEXT NOT NULL,
  step_name TEXT,
  step_type TEXT NOT NULL,

  -- Plugin info
  plugin TEXT,
  action TEXT,

  -- Status
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Execution metadata (SANITIZED)
  execution_metadata JSONB,

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metrics
  execution_time_ms INTEGER,
  tokens_used INTEGER,
  item_count INTEGER,

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Indexes
  INDEX idx_workflow_step_executions_workflow_id (workflow_execution_id),
  INDEX idx_workflow_step_executions_step_id (step_id)
);

-- Row Level Security
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_executions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own workflow executions"
  ON workflow_executions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own workflow executions"
  ON workflow_executions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workflow executions"
  ON workflow_executions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view step executions for their workflows"
  ON workflow_step_executions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workflow_executions
      WHERE workflow_executions.id = workflow_step_executions.workflow_execution_id
      AND workflow_executions.user_id = auth.uid()
    )
  );
```

### Example Data

**workflow_executions record**:
```json
{
  "id": "exec-123",
  "agent_id": "agent-456",
  "user_id": "user-789",
  "status": "completed",
  "current_step": null,
  "total_steps": 4,
  "completed_steps_count": 3,
  "failed_steps_count": 0,
  "skipped_steps_count": 1,
  "execution_trace": {
    "completedSteps": ["step1", "step2", "step4"],
    "failedSteps": [],
    "skippedSteps": ["step3"],
    "stepExecutions": [
      {
        "stepId": "step1",
        "plugin": "google-mail",
        "action": "search_emails",
        "metadata": {
          "success": true,
          "executedAt": "2025-11-02T10:00:00Z",
          "executionTime": 1234,
          "itemCount": 15
        }
      },
      {
        "stepId": "step2",
        "plugin": "hubspot",
        "action": "enrich_contacts",
        "metadata": {
          "success": true,
          "executedAt": "2025-11-02T10:00:02Z",
          "executionTime": 890,
          "itemCount": 15
        }
      }
    ]
  },
  "final_output": {
    "enriched_contacts": [...],
    "summary": "..."
  },
  "total_tokens_used": 5420,
  "total_execution_time_ms": 3456,
  "started_at": "2025-11-02T10:00:00Z",
  "completed_at": "2025-11-02T10:00:05Z"
}
```

---

## API Design

### Execution Endpoints

```typescript
// POST /api/run-agent (MODIFIED)
// Add workflow orchestration path
export async function POST(req: NextRequest) {
  const { agent_id, use_agentkit, input_values, user_input } = await req.json();

  // Get agent
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agent_id)
    .single();

  // Check if agent has workflow_steps
  if (agent.workflow_steps && agent.workflow_steps.length > 0) {
    // Use WorkflowOrchestrator
    const orchestrator = new WorkflowOrchestrator(supabase);

    const result = await orchestrator.execute(
      agent,
      userId,
      user_input,
      input_values,
      sessionId
    );

    return NextResponse.json(result);
  }

  // Fallback to AgentKit (existing behavior)
  if (use_agentkit) {
    const result = await runAgentKit(
      userId,
      agent,
      user_input,
      input_values,
      sessionId
    );

    return NextResponse.json(result);
  }

  // ... rest of existing logic
}
```

### Workflow Management Endpoints

```typescript
// GET /api/workflow/:executionId
// Get workflow execution status
export async function GET(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  const { data: execution } = await supabase
    .from('workflow_executions')
    .select('*, workflow_step_executions(*)')
    .eq('id', params.executionId)
    .single();

  return NextResponse.json({
    executionId: execution.id,
    status: execution.status,
    progress: {
      total: execution.total_steps,
      completed: execution.completed_steps_count,
      failed: execution.failed_steps_count,
      skipped: execution.skipped_steps_count
    },
    currentStep: execution.current_step,
    steps: execution.workflow_step_executions,
    metrics: {
      tokensUsed: execution.total_tokens_used,
      executionTime: execution.total_execution_time_ms
    },
    startedAt: execution.started_at,
    completedAt: execution.completed_at
  });
}

// POST /api/workflow/:executionId/pause
// Pause running workflow
export async function POST(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  const stateManager = new StateManager(supabase);
  await stateManager.pauseExecution(params.executionId);

  return NextResponse.json({ success: true });
}

// POST /api/workflow/:executionId/resume
// Resume paused workflow
export async function POST(
  req: NextRequest,
  { params }: { params: { executionId: string } }
) {
  const orchestrator = new WorkflowOrchestrator(supabase);
  const context = await stateManager.resumeExecution(params.executionId);

  // Continue execution from checkpoint
  const result = await orchestrator.continueExecution(context);

  return NextResponse.json(result);
}
```

---

## Security & Privacy

### Privacy-First Design

**Principle**: Store **metadata only**, never customer data

```typescript
// ❌ NEVER STORE:
{
  stepId: "step1",
  data: {
    emails: [
      {
        from: "john@acme.com",
        subject: "Confidential proposal",
        body: "Please review the attached contract..."
      }
    ]
  }
}

// ✅ STORE METADATA ONLY:
{
  stepId: "step1",
  plugin: "google-mail",
  action: "search_emails",
  metadata: {
    success: true,
    executedAt: "2025-11-02T10:00:00Z",
    executionTime: 1234,
    itemCount: 15
  }
}
```

### Data Sanitization

```typescript
class StateManager {
  private sanitizeExecutionTrace(context: ExecutionContext): any {
    return {
      completedSteps: context.completedSteps,
      failedSteps: context.failedSteps,
      skippedSteps: context.skippedSteps,
      stepExecutions: Array.from(context.stepOutputs.entries()).map(([stepId, output]) => ({
        stepId,
        plugin: output.plugin,
        action: output.action,
        // ✅ Only metadata
        metadata: {
          success: output.metadata.success,
          executedAt: output.metadata.executedAt,
          executionTime: output.metadata.executionTime,
          itemCount: output.metadata.itemCount,
          tokensUsed: output.metadata.tokensUsed,
          error: output.metadata.error
        }
        // ❌ NO output.data - contains customer data
      }))
    };
  }
}
```

### Expression Evaluation Security

**Problem**: Conditional expressions could be exploited if using `eval()`

**Solution**: Safe expression parser (no code execution)

```typescript
// ❌ INSECURE (using eval):
const result = eval(condition); // Can execute arbitrary code!

// ✅ SECURE (using safe parser):
class ConditionalEvaluator {
  private safeEvaluate(expression: string): boolean {
    // Use whitelist of allowed operations
    // Parse AST and evaluate safely
    // NO eval(), NO Function(), NO vm.runInContext()
  }
}
```

**Recommended Library**: `jsep` (JavaScript Expression Parser) + custom evaluator

---

## Error Handling & Recovery

### Retry Policies

```typescript
interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];  // e.g., ['TIMEOUT', 'RATE_LIMIT', 'NETWORK_ERROR']
}

class ErrorRecovery {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    policy?: RetryPolicy
  ): Promise<T> {
    const defaultPolicy: RetryPolicy = {
      maxRetries: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      retryableErrors: ['TIMEOUT', 'RATE_LIMIT', 'NETWORK_ERROR', 'ECONNRESET']
    };

    const finalPolicy = { ...defaultPolicy, ...policy };
    let lastError: Error;

    for (let attempt = 0; attempt <= finalPolicy.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        const isRetryable = finalPolicy.retryableErrors.some(
          errType => error.message?.includes(errType) || error.code === errType
        );

        if (!isRetryable || attempt === finalPolicy.maxRetries) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        const delay = finalPolicy.backoffMs * Math.pow(finalPolicy.backoffMultiplier, attempt);
        console.log(`Retry attempt ${attempt + 1}/${finalPolicy.maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}
```

### Fallback Strategies

```typescript
interface WorkflowStep {
  id: string;
  type: string;
  plugin: string;
  action: string;
  params: any;

  // Error handling
  retryPolicy?: RetryPolicy;
  fallbackSteps?: WorkflowStep[];  // Alternative steps if this fails
  continueOnError?: boolean;       // Skip and continue workflow
  rollbackOnError?: boolean;       // Undo previous steps
}

// Example:
{
  id: "step1",
  type: "action",
  plugin: "google-mail",
  action: "send_email",
  params: { ... },
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000
  },
  fallbackSteps: [
    {
      id: "step1_fallback",
      plugin: "sendgrid",
      action: "send_email",
      params: { ... }
    }
  ],
  continueOnError: false
}
```

### Rollback Support

```typescript
interface WorkflowStep {
  rollbackAction?: {
    plugin: string;
    action: string;
    params: any;
  };
}

class ErrorRecovery {
  async rollbackStep(step: WorkflowStep, context: ExecutionContext): Promise<void> {
    if (!step.rollbackAction) return;

    console.log(`Rolling back step ${step.id}`);

    const rollbackParams = context.resolveAllVariables(step.rollbackAction.params);

    await PluginExecuterV2.execute(
      context.userId,
      step.rollbackAction.plugin,
      step.rollbackAction.action,
      rollbackParams
    );
  }

  async rollbackWorkflow(
    context: ExecutionContext,
    upToStep: string
  ): Promise<void> {
    // Rollback completed steps in reverse order
    const completedSteps = context.completedSteps;
    const indexOfFailedStep = completedSteps.indexOf(upToStep);
    const stepsToRollback = completedSteps.slice(0, indexOfFailedStep).reverse();

    for (const stepId of stepsToRollback) {
      const stepOutput = context.getStepOutput(stepId);
      // ... rollback logic
    }
  }
}
```

---

## Performance Optimization

### Parallel Execution

```typescript
// Automatically detect parallel opportunities
const executionPlan = parser.parse(workflowSteps);

// Example:
// Level 0: step1 (fetch emails)
// Level 1: step2 (enrich contacts), step3 (analyze sentiment) ← PARALLEL
// Level 2: step4 (send summary)

parallelGroups: [
  {
    level: 1,
    steps: ["step2", "step3"]
  }
]
```

### Connection Pooling

```typescript
class ParallelExecutor {
  // Limit concurrent plugin calls to avoid overwhelming APIs
  private maxConcurrency = 3;

  async executeParallel(steps: WorkflowStep[], context: ExecutionContext) {
    // Execute in batches
    const chunks = this.chunkArray(steps, this.maxConcurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(step => this.stepExecutor.execute(step, context))
      );
    }
  }
}
```

### Caching

```typescript
// Cache plugin results for idempotent operations
interface WorkflowStep {
  cacheKey?: string;
  cacheTTL?: number; // seconds
}

class StepExecutor {
  private cache = new Map<string, { data: any; expiresAt: number }>();

  async execute(step: WorkflowStep, context: ExecutionContext) {
    // Check cache
    if (step.cacheKey) {
      const cacheKey = context.resolveVariable(step.cacheKey);
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() < cached.expiresAt) {
        console.log(`Cache hit for ${step.id}`);
        return cached.data;
      }
    }

    // Execute
    const result = await this.executePlugin(step, context);

    // Store in cache
    if (step.cacheKey && step.cacheTTL) {
      const cacheKey = context.resolveVariable(step.cacheKey);
      this.cache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + (step.cacheTTL * 1000)
      });
    }

    return result;
  }
}
```

---

## Integration Points

### AgentKit Integration

```typescript
// Use AgentKit for LLM decision steps
{
  id: "step5",
  type: "llm_decision",
  description: "Decide which contacts to prioritize based on engagement",
  params: {
    contacts: "{{step4.data}}"
  }
}

class StepExecutor {
  private async executeLLMDecision(step, params, context) {
    // Build prompt with context
    const prompt = `${step.description}\n\nData: ${JSON.stringify(params)}`;

    // Use AgentKit
    const result = await runAgentKit(
      context.userId,
      context.agent,
      prompt,
      {},
      context.sessionId
    );

    return { decision: result.response };
  }
}
```

### Memory System Integration

```typescript
// Load memory context at workflow start
const orchestrator = new WorkflowOrchestrator(supabase);

// In execute():
const memoryContext = await MemoryInjector.buildMemoryContext(
  agent.id,
  userId,
  { userInput, inputValues }
);

context.memoryContext = memoryContext;

// Summarize after completion
await MemorySummarizer.summarizeExecution(
  agent.id,
  userId,
  executionId,
  context.getSummary()
);
```

### AIS Integration

```typescript
// Update intensity metrics after workflow execution
await updateAgentIntensityMetrics(supabase, {
  agent_id: agentId,
  execution_id: executionId,
  status: 'success',
  duration_ms: context.totalExecutionTime,
  tokens_used: context.totalTokensUsed,
  plugin_calls: Array.from(context.stepOutputs.values())
    .filter(o => o.plugin !== 'system')
    .length,
  workflow_steps_executed: context.completedSteps.length
});
```

### Audit Trail Integration

```typescript
// Log workflow events
await auditTrail.log({
  action: AUDIT_EVENTS.WORKFLOW_EXECUTION_STARTED,
  entityType: 'workflow_execution',
  entityId: executionId,
  userId: userId,
  resourceName: agent.agent_name,
  details: {
    totalSteps: executionPlan.totalSteps,
    estimatedDuration: executionPlan.estimatedDuration
  },
  severity: 'info'
});
```

---

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)

- [x] Design document
- [ ] Database migration
- [ ] Type definitions
- [ ] ExecutionContext
- [ ] StateManager
- [ ] ConditionalEvaluator

**Deliverable**: Basic workflow execution with linear steps

### Phase 2: Advanced Execution (Week 2)

- [ ] WorkflowParser with DAG
- [ ] StepExecutor
- [ ] ParallelExecutor
- [ ] WorkflowOrchestrator

**Deliverable**: Full orchestration with parallel execution

### Phase 3: Error Handling (Week 3)

- [ ] ErrorRecovery
- [ ] OutputValidator
- [ ] Retry policies
- [ ] Fallback strategies

**Deliverable**: Production-ready error handling

### Phase 4: Integration (Week 4)

- [ ] Modify `/app/api/run-agent/route.ts`
- [ ] Modify `/lib/agentkit/runAgentKit.ts`
- [ ] Create workflow management endpoints
- [ ] Real-time progress via Supabase Realtime

**Deliverable**: Full system integration

### Phase 5: Testing & Documentation (Week 5)

- [ ] Unit tests
- [ ] Integration tests
- [ ] Workflow examples documentation
- [ ] API reference documentation

**Deliverable**: Tested, documented system

---

## Testing Strategy

### Unit Tests

```typescript
// Test ConditionalEvaluator
describe('ConditionalEvaluator', () => {
  it('should evaluate simple conditions', () => {
    const context = new ExecutionContext(...);
    context.setStepOutput('step1', {
      stepId: 'step1',
      data: { score: 85 },
      ...
    });

    const evaluator = new ConditionalEvaluator();
    const result = evaluator.evaluate({
      field: 'step1.data.score',
      operator: '>',
      value: 70
    }, context);

    expect(result).toBe(true);
  });
});

// Test WorkflowParser
describe('WorkflowParser', () => {
  it('should detect circular dependencies', () => {
    const steps = [
      { id: 'step1', dependencies: ['step2'] },
      { id: 'step2', dependencies: ['step1'] }
    ];

    const parser = new WorkflowParser();
    const validation = parser.validate(steps);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Circular dependency detected');
  });
});
```

### Integration Tests

```typescript
describe('WorkflowOrchestrator', () => {
  it('should execute multi-step workflow with data passing', async () => {
    const agent = {
      id: 'test-agent',
      workflow_steps: [
        {
          id: 'step1',
          type: 'action',
          plugin: 'google-mail',
          action: 'search_emails',
          params: { query: 'is:unread' }
        },
        {
          id: 'step2',
          type: 'transform',
          params: {
            operation: 'map',
            input: '{{step1.data}}',
            config: {
              mapping: { email: '{{current.from}}' }
            }
          }
        }
      ]
    };

    const orchestrator = new WorkflowOrchestrator(supabase);
    const result = await orchestrator.execute(agent, userId, '', {}, sessionId);

    expect(result.success).toBe(true);
    expect(result.stepsCompleted).toBe(2);
  });
});
```

---

## Conclusion

The AgentPilot Workflow Orchestrator provides a sophisticated, production-ready system for executing complex multi-step workflows while preserving the strengths of the existing AgentKit implementation.

**Key Benefits**:
- ✅ Deterministic control flow with LLM intelligence
- ✅ Data passing between steps with variable resolution
- ✅ Conditional branching and loops
- ✅ Parallel execution for performance
- ✅ State persistence for pause/resume
- ✅ Privacy-first design (metadata only)
- ✅ Backward compatible (extends AgentKit, doesn't replace)

**Next Steps**: Begin implementation with Phase 1 (Core Infrastructure).
