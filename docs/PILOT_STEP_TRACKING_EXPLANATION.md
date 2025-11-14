# Orchestrator Step Management Architecture

**Date**: 2025-11-02
**Status**: Explanation + Missing Feature

---

## Question

> "How each step is being managed? Why we added initially the workflow_executions_steps. How we handle the steps for complex agent"

---

## Architecture Overview

The orchestrator uses a **two-level tracking system**:

### 1. **Workflow-Level Tracking** (`workflow_executions` table) ✅ WORKING
- Tracks the **overall execution** of an entire workflow
- Stores high-level summary data
- Updated via `StateManager.checkpoint()` after each step

### 2. **Step-Level Tracking** (`workflow_step_executions` table) ❌ NOT WORKING
- Tracks **individual step executions** within a workflow
- Provides detailed step-by-step history
- **NOT currently being populated** (methods exist but never called)

---

## Database Schema

### Table 1: `workflow_executions` (High-Level)

Tracks entire workflow run from start to finish.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  session_id TEXT,

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_step TEXT,  -- Which step is currently executing

  -- Plan (immutable)
  total_steps INTEGER NOT NULL,
  execution_plan JSONB NOT NULL,  -- The parsed DAG with all steps

  -- Input/Output
  input_values JSONB,
  final_output JSONB,

  -- Progress counters
  completed_steps_count INTEGER DEFAULT 0,
  failed_steps_count INTEGER DEFAULT 0,
  skipped_steps_count INTEGER DEFAULT 0,

  -- Execution trace (sanitized metadata only)
  execution_trace JSONB,  -- { completedSteps: [], failedSteps: [], stepExecutions: [] }

  -- Metrics
  total_tokens_used INTEGER DEFAULT 0,
  total_execution_time_ms INTEGER DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  resumed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Error tracking
  error_message TEXT,
  error_stack TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Example Record**:
```json
{
  "id": "exec-123",
  "agent_id": "agent-456",
  "user_id": "user-789",
  "status": "running",
  "current_step": "step2",
  "total_steps": 5,
  "completed_steps_count": 1,
  "failed_steps_count": 0,
  "skipped_steps_count": 0,
  "execution_plan": {
    "steps": [
      { "stepId": "step1", "name": "Search emails", "type": "action", "level": 0 },
      { "stepId": "step2", "name": "Enrich data", "type": "action", "level": 1, "dependencies": ["step1"] },
      { "stepId": "step3", "name": "Check urgency", "type": "conditional", "level": 2 },
      { "stepId": "step4", "name": "Send to Slack", "type": "action", "level": 3 }
    ],
    "parallelGroups": [],
    "totalSteps": 4
  },
  "execution_trace": {
    "completedSteps": ["step1"],
    "failedSteps": [],
    "skippedSteps": [],
    "stepExecutions": [
      {
        "stepId": "step1",
        "plugin": "google-mail",
        "action": "search_emails",
        "metadata": {
          "success": true,
          "executedAt": "2025-11-02T12:00:00Z",
          "executionTime": 1234,
          "tokensUsed": 0,
          "itemCount": 10
        }
      }
    ]
  },
  "total_tokens_used": 0,
  "total_execution_time_ms": 1234
}
```

**Updated By**: `StateManager.checkpoint()` after **each step completes**

---

### Table 2: `workflow_step_executions` (Detailed Step History)

Tracks **each individual step execution** separately (one row per step per execution).

```sql
CREATE TABLE workflow_step_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_execution_id UUID REFERENCES workflow_executions(id) NOT NULL,

  -- Step identification
  step_id TEXT NOT NULL,  -- e.g., "step1", "step2"
  step_name TEXT NOT NULL,
  step_type TEXT NOT NULL,  -- "action", "llm_decision", "conditional", "loop"

  -- Status
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  -- Execution details
  execution_metadata JSONB,  -- { plugin, action, executionTime, tokensUsed, itemCount }
  error_message TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_step_executions_workflow_id
  ON workflow_step_executions(workflow_execution_id);
```

**Example Records** (for same execution as above):
```json
[
  {
    "id": "step-exec-1",
    "workflow_execution_id": "exec-123",
    "step_id": "step1",
    "step_name": "Search emails",
    "step_type": "action",
    "status": "completed",
    "execution_metadata": {
      "plugin": "google-mail",
      "action": "search_emails",
      "executionTime": 1234,
      "tokensUsed": 0,
      "itemCount": 10
    },
    "started_at": "2025-11-02T12:00:00Z",
    "completed_at": "2025-11-02T12:00:01Z"
  },
  {
    "id": "step-exec-2",
    "workflow_execution_id": "exec-123",
    "step_id": "step2",
    "step_name": "Enrich data",
    "step_type": "action",
    "status": "running",
    "execution_metadata": null,
    "started_at": "2025-11-02T12:00:02Z",
    "completed_at": null
  }
]
```

**Should Be Updated By**: `StateManager.logStepExecution()` and `StateManager.updateStepExecution()` (but currently NOT called)

---

## Current Implementation Status

### ✅ What's Working

1. **Workflow Executions Table**
   - Created at workflow start: `StateManager.createExecution()`
   - Checkpointed after each step: `StateManager.checkpoint()`
   - Marked complete/failed: `StateManager.completeExecution()` / `StateManager.failExecution()`
   - Stores full execution trace with sanitized metadata in JSONB

2. **Execution Flow**
   ```
   WorkflowOrchestrator.execute()
   ├─ StateManager.createExecution() → Creates workflow_executions record
   ├─ ExecutionContext initialized (in-memory state)
   ├─ FOR each step:
   │   ├─ StepExecutor.execute(step, context)
   │   ├─ context.setStepOutput(stepId, result)
   │   └─ StateManager.checkpoint(context) → Updates workflow_executions
   └─ StateManager.completeExecution() → Final update to workflow_executions
   ```

3. **Execution Trace** (stored in `workflow_executions.execution_trace`)
   - Includes all step metadata
   - Shows which steps completed/failed/skipped
   - Includes execution time, tokens, success status per step

### ❌ What's NOT Working

**`workflow_step_executions` table is NEVER populated!**

**Why?**
- Methods exist: `StateManager.logStepExecution()` and `StateManager.updateStepExecution()`
- But they are **never called** by any component
- `StepExecutor` doesn't have reference to `StateManager` (dependency injection missing)

---

## Why Have Two Tables?

### Design Intent

Having two tables serves different purposes:

#### 1. **workflow_executions** (High-Level Summary)
**Purpose**: Real-time workflow monitoring and resume capability

**Use Cases**:
- Show user "Your workflow is 3/5 steps complete"
- Enable pause/resume (restore from checkpoint)
- Track overall metrics (total tokens, total time)
- Debug which step failed
- Real-time progress via Supabase Realtime

**Advantages**:
- Single row per execution (efficient queries)
- JSONB fields allow flexible metadata storage
- Checkpoint entire state in one UPDATE

#### 2. **workflow_step_executions** (Detailed History)
**Purpose**: Step-by-step audit trail and debugging

**Use Cases**:
- Show detailed step timeline: "Step 1 started at 12:00:00, completed at 12:00:05"
- Analyze which steps are slow
- Debug specific step failures
- Audit trail for compliance
- Query patterns: "Show me all failed email steps across all executions"

**Advantages**:
- One row per step execution (easy to query specific step history)
- Normalized data (better for analytics)
- Can add indexes per step_type, status, etc.
- Enables step-level retry tracking

### Example Queries Enabled

**With workflow_executions only:**
```sql
-- How many workflows failed today?
SELECT COUNT(*) FROM workflow_executions
WHERE status = 'failed' AND DATE(created_at) = CURRENT_DATE;

-- What's the average execution time per agent?
SELECT agent_id, AVG(total_execution_time_ms)
FROM workflow_executions
GROUP BY agent_id;
```

**With workflow_step_executions:**
```sql
-- Which step type fails most often?
SELECT step_type, COUNT(*) as failures
FROM workflow_step_executions
WHERE status = 'failed'
GROUP BY step_type
ORDER BY failures DESC;

-- How long does the "search_emails" step typically take?
SELECT AVG((execution_metadata->>'executionTime')::int) as avg_ms
FROM workflow_step_executions
WHERE step_name = 'Search emails' AND status = 'completed';

-- Show me the step-by-step timeline for execution X
SELECT step_name, status, started_at, completed_at
FROM workflow_step_executions
WHERE workflow_execution_id = 'exec-123'
ORDER BY started_at;
```

---

## How It SHOULD Work (Design Intent)

### Execution Flow with Both Tables

```typescript
// 1. Create workflow execution record
const executionId = await stateManager.createExecution(agent, userId, sessionId, executionPlan, inputValues);
// → Inserts to workflow_executions

// 2. For each step
for (const step of steps) {
  // 2a. Log step start
  await stateManager.logStepExecution(
    executionId,
    step.id,
    step.name,
    step.type,
    'running'
  );
  // → Inserts to workflow_step_executions with status='running'

  // 2b. Execute step
  const output = await stepExecutor.execute(step, context);

  // 2c. Update step status
  await stateManager.updateStepExecution(
    executionId,
    step.id,
    output.metadata.success ? 'completed' : 'failed',
    output.metadata,
    output.metadata.error
  );
  // → Updates workflow_step_executions row

  // 2d. Checkpoint entire workflow state
  await stateManager.checkpoint(context);
  // → Updates workflow_executions with execution_trace
}
```

### What We Get

**workflow_executions** (1 row):
```json
{
  "id": "exec-123",
  "status": "completed",
  "completed_steps_count": 3,
  "execution_trace": { /* summarized metadata */ }
}
```

**workflow_step_executions** (3 rows):
```json
[
  { "step_id": "step1", "status": "completed", "execution_metadata": {...} },
  { "step_id": "step2", "status": "completed", "execution_metadata": {...} },
  { "step_id": "step3", "status": "completed", "execution_metadata": {...} }
]
```

---

## Current Problem: Missing Integration

### What's Missing

**StepExecutor needs access to StateManager** to call logging methods.

**Current Code** ([StepExecutor.ts:25-28](lib/orchestrator/StepExecutor.ts#L25-L28)):
```typescript
export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    // ❌ Missing: this.stateManager = stateManager;
  }
```

**Should Be**:
```typescript
export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private stateManager: StateManager;  // ADD THIS

  constructor(supabase: SupabaseClient, stateManager: StateManager) {  // ADD PARAM
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.stateManager = stateManager;  // ADD THIS
  }
```

**Then in execute() method** ([StepExecutor.ts:45-125](lib/orchestrator/StepExecutor.ts#L45-L125)):
```typescript
async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepOutput> {
  const startTime = Date.now();

  // ✅ ADD: Log step start
  await this.stateManager.logStepExecution(
    context.executionId,
    step.id,
    step.name,
    step.type,
    'running'
  );

  try {
    // ... existing execution logic ...

    // ✅ ADD: Update step success
    await this.stateManager.updateStepExecution(
      context.executionId,
      step.id,
      'completed',
      output.metadata
    );

    return output;
  } catch (error: any) {
    // ✅ ADD: Update step failure
    await this.stateManager.updateStepExecution(
      context.executionId,
      step.id,
      'failed',
      { executionTime: Date.now() - startTime },
      error.message
    );

    throw error;
  }
}
```

---

## How Complex Agents Are Handled

### Simple Agent (No workflow_steps)

**Execution Path**: `runAgentKit()` directly
- No orchestration
- AgentKit does iterative function calling (max 10 iterations)
- Single execution logged to `agent_executions` and `agent_logs`

### Complex Agent (With workflow_steps)

**Execution Path**: `WorkflowOrchestrator` → multiple steps

#### Example: Email Triage Agent

**Workflow Definition** (from Smart Agent Builder):
```json
[
  {
    "id": "step1",
    "name": "Search VIP emails",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": { "query": "is:unread from:{{vip_list}}" }
  },
  {
    "id": "step2",
    "name": "Enrich sender with CRM data",
    "type": "action",
    "plugin": "hubspot",
    "action": "get_contact_by_email",
    "params": { "email": "{{step1.data[*].from}}" },
    "dependencies": ["step1"]
  },
  {
    "id": "step3",
    "name": "AI decision: Is this urgent?",
    "type": "llm_decision",
    "prompt": "Based on email content and CRM priority, is this urgent?",
    "dependencies": ["step1", "step2"]
  },
  {
    "id": "step4",
    "name": "Send urgent alert to Slack",
    "type": "action",
    "plugin": "slack",
    "action": "send_message",
    "params": {
      "channel": "#urgent",
      "message": "Urgent email from {{step1.data.from}}: {{step3.data.decision}}"
    },
    "dependencies": ["step3"],
    "executeIf": "step3.data.decision == 'urgent'"
  },
  {
    "id": "step5",
    "name": "Archive email",
    "type": "action",
    "plugin": "google-mail",
    "action": "modify_labels",
    "params": { "messageId": "{{step1.data.id}}", "addLabels": ["processed"] },
    "dependencies": ["step4"]
  }
]
```

**Execution Flow**:

1. **Parse workflow** → Dependency graph:
   ```
   Level 0: [step1]
   Level 1: [step2]
   Level 2: [step3]
   Level 3: [step4] (conditional)
   Level 4: [step5]
   ```

2. **Execute Level 0** (no dependencies):
   - `step1`: Search emails via `PluginExecuterV2.execute('google-mail', 'search_emails', params)`
   - Result stored: `context.setStepOutput('step1', { data: [email1, email2, ...] })`
   - Checkpoint: `StateManager.checkpoint(context)`

3. **Execute Level 1** (depends on step1):
   - Resolve params: `{{step1.data[*].from}}` → `['vip1@example.com', 'vip2@example.com']`
   - Loop detected! → `ParallelExecutor.executeLoop()` creates parallel group
   - `step2` executed twice in parallel (once per email)
   - Results merged: `context.setStepOutput('step2', { data: [crm1, crm2] })`
   - Checkpoint: `StateManager.checkpoint(context)`

4. **Execute Level 2** (depends on step1, step2):
   - `step3`: LLM decision via `runAgentKit()` with context:
     ```
     Prompt: "Based on email content and CRM priority, is this urgent?"
     Context:
     - step1.data: [email objects]
     - step2.data: [crm objects]
     ```
   - AgentKit returns: `{ decision: 'urgent', reasoning: '...' }`
   - Result stored: `context.setStepOutput('step3', { data: { decision: 'urgent' } })`
   - Checkpoint: `StateManager.checkpoint(context)`

5. **Execute Level 3** (conditional):
   - Check `executeIf`: `step3.data.decision == 'urgent'` → **TRUE**
   - `step4`: Send Slack message via `PluginExecuterV2.execute('slack', 'send_message', params)`
   - Result stored: `context.setStepOutput('step4', { data: { messageId: 'T12345' } })`
   - Checkpoint: `StateManager.checkpoint(context)`

6. **Execute Level 4**:
   - `step5`: Archive email via `PluginExecuterV2.execute('google-mail', 'modify_labels', params)`
   - Result stored: `context.setStepOutput('step5', { data: { success: true } })`
   - Checkpoint: `StateManager.checkpoint(context)`

7. **Complete execution**:
   - Build final output from output_schema mappings
   - `StateManager.completeExecution(executionId, finalOutput, context)`
   - Update AIS metrics (async)
   - Summarize for memory (async)

**Database Records Created**:

**workflow_executions** (1 row):
```json
{
  "id": "exec-abc123",
  "agent_id": "agent-456",
  "status": "completed",
  "total_steps": 5,
  "completed_steps_count": 5,
  "failed_steps_count": 0,
  "skipped_steps_count": 0,
  "execution_trace": {
    "completedSteps": ["step1", "step2", "step3", "step4", "step5"],
    "stepExecutions": [
      { "stepId": "step1", "plugin": "google-mail", "metadata": {...} },
      { "stepId": "step2", "plugin": "hubspot", "metadata": {...} },
      { "stepId": "step3", "plugin": "system", "metadata": {...} },
      { "stepId": "step4", "plugin": "slack", "metadata": {...} },
      { "stepId": "step5", "plugin": "google-mail", "metadata": {...} }
    ]
  },
  "total_tokens_used": 1500,
  "total_execution_time_ms": 8234
}
```

**workflow_step_executions** (5 rows) - ❌ Currently NOT created:
```json
[
  { "step_id": "step1", "step_name": "Search VIP emails", "status": "completed", ... },
  { "step_id": "step2", "step_name": "Enrich sender with CRM data", "status": "completed", ... },
  { "step_id": "step3", "step_name": "AI decision: Is this urgent?", "status": "completed", ... },
  { "step_id": "step4", "step_name": "Send urgent alert to Slack", "status": "completed", ... },
  { "step_id": "step5", "step_name": "Archive email", "status": "completed", ... }
]
```

---

## Summary

### Two-Level Tracking System

| Feature | workflow_executions | workflow_step_executions |
|---------|---------------------|--------------------------|
| **Granularity** | One row per workflow run | One row per step per run |
| **Purpose** | High-level monitoring, pause/resume | Detailed audit trail, analytics |
| **Status** | ✅ Working | ❌ Not populated |
| **Updated By** | `StateManager.checkpoint()` | `StateManager.logStepExecution()` (NOT called) |
| **Contains** | Execution trace JSONB with metadata | Individual step records |
| **Use Cases** | "Show workflow progress", resume | "Show step timeline", debug specific steps |

### Why Both?

- **workflow_executions**: For real-time monitoring and resume capability (1 row = 1 workflow)
- **workflow_step_executions**: For detailed step history and analytics (N rows = N steps)

### Current Status

- ✅ **workflow_executions** works perfectly and contains all metadata in `execution_trace` JSONB
- ❌ **workflow_step_executions** table exists but is never populated
- 🔧 **Fix required**: Inject `StateManager` into `StepExecutor` and call logging methods

### Complex Agent Handling

Complex agents with workflow_steps:
1. Parsed into dependency graph (DAG)
2. Executed level-by-level (respecting dependencies)
3. Steps can run in parallel if no dependencies
4. Supports loops (map over arrays)
5. Supports conditionals (if/else branching)
6. Supports LLM decisions (AgentKit integration)
7. Checkpointed after each step for pause/resume
8. Full execution trace stored in workflow_executions table

---

## Recommendation

You have two options:

### Option 1: Keep Both Tables (Full Implementation)
**Pros**:
- Detailed step-level history for debugging
- Better analytics capabilities
- Normalized data structure

**Cons**:
- Requires code changes to populate step table
- More database writes per execution

**Implementation**: Inject `StateManager` into `StepExecutor` and call logging methods

### Option 2: Remove workflow_step_executions Table
**Pros**:
- Simpler architecture
- All data already in `execution_trace` JSONB
- Fewer database writes

**Cons**:
- Harder to query step-level analytics
- No separate indexes per step type/status

**Implementation**: Drop the table, rely on `execution_trace` JSONB

**My Recommendation**: **Option 1** - Keep both tables and implement the logging. The detailed step history is valuable for debugging complex workflows, and the implementation is straightforward (just dependency injection + 3 method calls).
