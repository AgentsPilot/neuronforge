# V6 Workflow Execution Guide

> **Last aligned to code**: 2026-02-22

This guide explains how compiled PILOT workflows are executed at runtime — the step-by-step process from a flat `WorkflowStep[]` array to actual API calls and results.

## Overview

After the V6 pipeline compiles an Enhanced Prompt into a `WorkflowStep[]` (Phases 0–5), the **runtime execution engine** takes over:

```
WorkflowStep[] (PILOT format)
        │
        ▼
┌─────────────────────────────┐
│  WorkflowPilot.execute()    │
│  ┌───────────────────────┐  │
│  │ 1. Parse & Validate   │  │  WorkflowParser builds execution plan
│  │ 2. Build Dep Graph    │  │  Adjacency map of step dependencies
│  │ 3. Topological Sort   │  │  Kahn's algorithm
│  │ 4. Assign Levels      │  │  Level 0, 1, 2, ...
│  │ 5. Detect Parallel    │  │  Which steps can run concurrently
│  └───────────────────────┘  │
│            │                │
│            ▼                │
│  ┌───────────────────────┐  │
│  │ Execute Level 0       │  │  StepExecutor processes each step
│  │ Execute Level 1       │  │  ParallelExecutor for parallel groups
│  │ Execute Level 2       │  │  ConditionalEvaluator for branches
│  │ ...                   │  │  ExecutionContext stores state
│  └───────────────────────┘  │
└─────────────────────────────┘
        │
        ▼
  Execution Results
```

---

## Main Components

| Component | Source | Purpose |
|-----------|--------|---------|
| **WorkflowPilot** | [`lib/pilot/WorkflowPilot.ts`](../../lib/pilot/WorkflowPilot.ts) | Main orchestrator — parses workflow, builds plan, manages lifecycle |
| **StepExecutor** | [`lib/pilot/StepExecutor.ts`](../../lib/pilot/StepExecutor.ts) | Routes each step to the correct handler, resolves variables, tracks metrics |
| **ConditionalEvaluator** | [`lib/pilot/ConditionalEvaluator.ts`](../../lib/pilot/ConditionalEvaluator.ts) | Evaluates conditions for `conditional` and `switch` steps |
| **ExecutionContext** | [`lib/pilot/ExecutionContext.ts`](../../lib/pilot/ExecutionContext.ts) | Stores step outputs, resolves `{{variable}}` references, tracks tokens/time |
| **ParallelExecutor** | [`lib/pilot/ParallelExecutor.ts`](../../lib/pilot/ParallelExecutor.ts) | Handles parallel groups, scatter-gather loops, concurrency limits |

---

## Execution Plan Building

The WorkflowPilot builds the execution plan in 6 stages:

### Stage 1: Normalization
- Auto-generate missing step IDs
- Convert V4 scatter-gather format to internal representation

### Stage 2: Validation
- Check for dependency cycles
- Check for missing dependencies (step references non-existent step)
- Validate required fields per step type

### Stage 3: Dependency Graph
- Build adjacency map: `stepId → Set<dependencyStepId>`
- Dependencies come from explicit `dependencies` array and implicit `{{stepX.data}}` variable references

### Stage 4: Topological Sort
- Uses Kahn's algorithm to determine safe execution order
- Detects cycles (rejects workflow if found)

### Stage 5: Execution Level Assignment
- **Level 0**: Steps with no dependencies (can start immediately)
- **Level N**: `max(dependency levels) + 1`

```
Level 0: [step1]               ← no deps, runs first
Level 1: [step2, step3]        ← both depend only on step1
Level 2: [step4]               ← depends on step2 or step3
```

### Stage 6: Parallel Group Detection

Steps at the same level are grouped for parallel execution if they meet criteria:

**Can run in parallel**: `action`, `transform`
**Cannot run in parallel**: `conditional`, `switch`, `loop`, `scatter_gather`, `sub_workflow`, `human_approval`, `llm_decision`, `ai_processing`

---

## Execution Flow

```typescript
for (const [level, steps] of stepsByLevel) {
  const parallelGroups = groupByParallelGroup(steps)
  for (const group of parallelGroups) {
    if (group.length === 1) {
      await executeSingleStep(group[0], context)
    } else {
      await executeParallelGroup(group, context)  // concurrent, up to maxConcurrency
    }
  }
  // Wait for all steps in level before moving to next
}
```

**Key rules**:
- Levels execute sequentially (Level 0 finishes before Level 1 starts)
- Within a level, parallel groups execute concurrently (max concurrency: 3 by default)
- Within a parallel group, steps are chunked: `[step2, step3, step4, step5]` with maxConcurrency=3 → chunk1: [step2,step3,step4] → chunk2: [step5]

---

## Step Execution by Type

### 1. Action Steps (Plugin Operations)

```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-mail",
  "action": "search_emails",
  "params": { "query": "newer_than:7d", "max_results": 100 },
  "output_variable": "emails_result"
}
```

**Execution flow**:
1. Resolve `{{variable}}` references in params
2. Get plugin executor via PluginManagerV2
3. Execute plugin action with resolved params (real API call)
4. Store result in context as `step1.data`
5. If `output_variable` is set, also register `context.setVariable("emails_result", data)`
6. Track tokens if the action involved AI

---

### 2. Transform Steps (Data Operations)

```json
{
  "step_id": "step2",
  "type": "transform",
  "operation": "filter",
  "input": "{{step1.data.emails}}",
  "config": { "condition": "item.subject.includes('urgent')" }
}
```

**Supported operations**: `map`, `filter`, `reduce`, `sort`, `group`, `group_by`, `aggregate`, `deduplicate`, `flatten`, `set`, `join`, `pivot`, `split`, `expand`, `partition`, `rows_to_objects`, `map_headers`, `render_table`, `fetch_content`

**Execution flow**:
1. Resolve input variable → get source data
2. Route to appropriate transform handler
3. Apply operation (e.g., filter evaluates condition for each item)
4. Store result in context

---

### 3. AI Processing Steps (LLM Operations)

```json
{
  "step_id": "step3",
  "type": "ai_processing",
  "input": "{{step2.data}}",
  "prompt": "Classify each email as urgent, normal, or low priority",
  "config": {
    "ai_type": "classify",
    "output_schema": { "fields": [{ "name": "priority", "type": "string" }] },
    "temperature": 0
  }
}
```

**Execution flow**:
1. Resolve input variable and template variables in prompt
2. **Auto-detect file inputs**: If the input data contains file content (PDF, image), redirects to `deterministic_extraction` automatically via `shouldUseDeterministicExtraction()`
3. Route through AI orchestration (model selection, prompt optimization)
4. Call LLM with resolved prompt
5. Parse response (handle JSON mode if configured)
6. Store result and track tokens

---

### 4. Deterministic Extraction Steps

```json
{
  "step_id": "step4",
  "type": "deterministic_extraction",
  "input": "{{current_attachment.content}}",
  "prompt": "Extract invoice number, date, vendor, and total amount",
  "output_schema": {
    "fields": [
      { "name": "invoice_number", "type": "string" },
      { "name": "date", "type": "string" },
      { "name": "vendor", "type": "string" },
      { "name": "total_amount", "type": "number" }
    ]
  }
}
```

**Execution flow**:
1. Resolve input (file content — PDF, image, etc.)
2. Use PDF parser + Textract + AI pipeline for structured extraction
3. Validate output against `output_schema`
4. Store structured result

---

### 5. Conditional Steps (Branching)

```json
{
  "step_id": "step5",
  "type": "conditional",
  "condition": { "field": "{{emails_result.total_found}}", "operator": "greater_than", "value": 0 },
  "then": [
    { "step_id": "step5a", "type": "action", "plugin": "google-mail", "action": "send_email", "params": { "body": "Found results!" } }
  ],
  "else": [
    { "step_id": "step5b", "type": "action", "plugin": "google-mail", "action": "send_email", "params": { "body": "No results found." } }
  ],
  "output_variable": "branch_result"
}
```

**Execution flow**:
1. **Evaluate condition** via `ConditionalEvaluator`:
   - Resolve field reference through ExecutionContext
   - Apply operator comparison
   - Return boolean result
2. **Select branch**: If `true` → execute `then` steps; if `false` → execute `else` steps
3. **Execute branch steps** sequentially (each step goes through the full StepExecutor pipeline)
4. **Register output_variable** from the last branch step result if `output_variable` is specified

**Condition formats supported**:

| Format | Example |
|--------|---------|
| Simple | `{ field: "score", operator: ">", value: 70 }` |
| Complex AND | `{ conditionType: "complex_and", conditions: [{...}, {...}] }` |
| Complex OR | `{ conditionType: "complex_or", conditions: [{...}, {...}] }` |
| Complex NOT | `{ conditionType: "complex_not", condition: {...} }` |
| String expression | `"step1.data.score > 70 && step2.success"` |

**Comparison operators**:

| Category | Operators |
|----------|-----------|
| Equality | `==`, `equals`, `eq`, `!=`, `not_equals`, `ne` |
| Numeric | `>`, `>=`, `<`, `<=`, `greater_than`, `greater_than_or_equal`, `less_than`, `less_than_or_equal`, `gt`, `gte`, `lt`, `lte` |
| Collection | `contains`, `not_contains`, `in`, `not_in` |
| Existence | `exists`, `not_exists` |
| Emptiness | `is_empty`, `is_not_empty` |
| Pattern | `matches`, `matches_regex`, `starts_with`, `ends_with` |
| Date | `within_last_days`, `before`, `after` |

**Truthiness rules** (when resolving a value without an explicit operator):

| Type | Truthy | Falsy |
|------|--------|-------|
| String | Non-empty `"hello"` | Empty `""` |
| Number | Non-zero `42` | Zero `0` |
| Boolean | `true` | `false` |
| null / undefined | — | Always falsy |
| Array | **Always truthy, even `[]`** | — |
| Object | Non-empty `{ a: 1 }` | Empty `{}` |

> **Important**: In JavaScript, an empty array `[]` is **truthy**. A condition like `{{emails_result.emails}}` will evaluate to `true` even when the array is empty. To check for empty arrays, use the `is_empty` or `is_not_empty` operator, or check `.length > 0`.

---

### 6. Scatter-Gather Steps (Loops)

```json
{
  "step_id": "step6",
  "type": "scatter_gather",
  "scatter": {
    "input": "{{step1.data.emails}}",
    "itemVariable": "current_email",
    "steps": [
      { "step_id": "step6_1", "type": "ai_processing", "input": "{{current_email.body}}", "prompt": "Classify this email" }
    ],
    "maxConcurrency": 3
  },
  "gather": { "operation": "collect", "from": "classifications" },
  "output_variable": "classified_emails"
}
```

**Execution flow**:
1. **Resolve scatter input** → get array to iterate over
2. **For each item** in the array:
   a. **Clone context**: `parentContext.clone(resetMetrics: true)` — prevents double-counting tokens
   b. **Set item variable**: `itemContext.setVariable("current_email", item)`
   c. **Set index**: `itemContext.setVariable("index", i)`
   d. **Execute nested steps** sequentially within the item context
   e. **Register output_variable** for each nested step if specified
   f. **Collect result** from the last step
3. **Aggregate results** based on `gather.operation`:
   - `collect`: Combine all results into an array
   - `merge`: Deep merge objects
   - `reduce`: Apply reduce expression
   - `flatten`: Flatten nested arrays
4. **Merge metrics** back to parent context (sum tokens, time)
5. **Store result** as `output_variable` if specified

**Concurrency**: Items are processed in chunks based on `maxConcurrency` (default: 3). Chunk 1 runs in parallel, waits for completion, then chunk 2 runs, etc.

---

### 7. Switch Steps (Multi-Branch)

```json
{
  "step_id": "step7",
  "type": "switch",
  "condition": { "field": "{{step3.data.category}}" },
  "cases": {
    "urgent": [{ "step_id": "step7a", "type": "action", ... }],
    "normal": [{ "step_id": "step7b", "type": "action", ... }]
  },
  "default": [{ "step_id": "step7c", "type": "action", ... }]
}
```

**Execution flow**: Resolves the field value, matches against case keys, executes the matching branch (or default if no match).

---

### 8. Other Step Types

| Type | Description |
|------|-------------|
| `delay` | Wait/sleep for specified duration |
| `validation` | Validate data against schema or rules |
| `enrichment` | Merge data from multiple sources |
| `comparison` | Compare two data sources |
| `sub_workflow` | Execute a nested workflow recursively |
| `human_approval` | Pause execution and wait for human input |

---

## Template Variable Resolution

### Supported Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Step output | `{{step1.data}}` | Entire step result |
| Nested field | `{{step1.data.emails[0].subject}}` | Nested data access |
| Named output | `{{emails_result.total_found}}` | Via `output_variable` |
| Input value | `{{input.recipient}}` | User-provided input |
| Loop variable | `{{current_email.subject}}` | Current scatter item |
| Loop index | `{{index}}` | Current iteration number |
| Array wildcard | `{{step1.data[*].email}}` | All elements of array |
| Quoted property | `{{step1.data['Sales Person']}}` | Properties with spaces |

### Resolution Process

1. **Extract path**: `"{{step1.data.emails}}"` → `["step1", "data", "emails"]`
2. **Identify root**:
   - `step*` → step outputs map
   - `input` / `inputs` → input values
   - `var` → runtime variables
   - `current` / `item` → loop context
   - Custom names → check variables first, then scatter context
3. **Navigate path** with smart field matching:
   - Exact match (case-sensitive)
   - Case-insensitive fallback
   - snake_case ↔ camelCase conversion
   - PascalCase fallback
4. **Null vs Undefined**:
   - `undefined` → key doesn't exist → resolution error
   - `null` → key exists but explicitly null → preserved as-is

### output_variable System

When a step has `output_variable: "emails_result"`:

1. Step executes normally (result stored as `step1.data` in step outputs map)
2. **Additionally**, the data is registered as a named variable: `context.setVariable("emails_result", data)`
3. Downstream steps can reference via either path:
   - `{{step1.data.emails}}` → resolves through step outputs
   - `{{emails_result.emails}}` → resolves through named variables

This is used by:
- **Scatter-gather**: Each iteration's output is registered by the loop's `output_variable`
- **Conditional branches**: Branch step results registered for downstream access
- **IR formalization**: The LLM assigns meaningful variable names (e.g., `emails_result`, `filtered_invoices`)

---

## Token Usage and Cost Tracking

### Token De-duplication for Retries

ExecutionContext tracks tokens with retry awareness:

```typescript
setStepOutput(stepId, output) {
  const previousOutput = this.stepOutputs.get(stepId)
  if (previousOutput) {
    // Subtract previous attempt tokens before adding new
    this.totalTokensUsed -= getTokenTotal(previousOutput.metadata.tokensUsed)
  }
  this.stepOutputs.set(stepId, output)
  this.totalTokensUsed += getTokenTotal(output.metadata.tokensUsed)
}
```

This prevents overcharging users for failed AI call attempts.

### Context Cloning for Scatter-Gather

When executing scatter-gather items in parallel:
- Each item gets a **cloned context** with `resetMetrics: true`
- Tokens and time start at 0 in the clone (prevents double-counting)
- After all items complete, metrics are **summed back** to the parent context

---

## Error Handling

### Retry Logic

Steps can configure retry policies:

```json
{
  "retry_policy": {
    "max_attempts": 3,
    "backoff_ms": 1000,
    "exponential_backoff": true
  }
}
```

**Behavior**: Execute → if fails, wait `backoff_ms` → retry → exponential increase → up to `max_attempts`

### Error Propagation

1. **Step failure**: Marks step as failed, stores error in context
2. **Dependent steps**: Skipped if dependency failed (in batch calibration mode: checks for non-recoverable errors)
3. **Workflow result**: `success: false` if any critical step fails
4. **Partial results**: Completed steps still available in output

### Common Runtime Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `VariableResolutionError: {{step1.data}} not found` | Step1 hasn't executed or failed | Check dependencies array |
| `Plugin execution failed: Not authenticated` | Missing/expired OAuth tokens | Re-connect plugin in UI |
| Empty array treated as truthy | Conditional on `{{result.items}}` where items is `[]` | Use `is_empty` / `is_not_empty` operator |
| Conditional branch steps not executing | `then`/`else` arrays empty after Phase 5 translation | Check Phase 4 DSL output for branch content |
| `SyntaxError: Unexpected token {{` | Template variable used inside JS expression body | Use `input` field for data, `condition` for logic |
| Scatter-gather returns empty | Input array was empty — loop body never executes | Add conditional check before scatter-gather |

---

## Execution Methods

### Method 1: Test Page (Recommended for Testing)

```
http://localhost:3000/test-v6-declarative.html
```

See [V6_TEST_DECLARATIVE.md](./V6_TEST_DECLARATIVE.md) for the full test page guide.

### Method 2: API Call

```typescript
const result = await fetch('/api/v6/execute-test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflow: compiledWorkflowSteps,
    plugins_required: ['google-mail', 'google-sheets'],
    user_id: 'offir.omer@gmail.com',
    workflow_name: 'Test Workflow',
    input_variables: {}
  })
})

const { success, data } = await result.json()
// data.stepsCompleted, data.stepsFailed, data.execution_time_ms
```

### Method 3: Programmatic (Direct)

```typescript
const pilot = new WorkflowPilot(supabase, stateManager)
const result = await pilot.execute(
  agent,           // Agent object with pilot_steps
  userId,
  'Execution name',
  inputVariables,
  sessionId,
  stepEmitter,     // Optional: real-time progress events
  debugMode        // Optional: step-by-step tracing
)
```

---

## Related Documentation

- [V6 Architecture](./V6_ARCHITECTURE.md) — Compilation pipeline phases
- [V6 API Reference](./V6_API_REFERENCE.md) — API schemas for execute-test endpoint
- [V6 Developer Guide](./V6_DEVELOPER_GUIDE.md) — Debugging execution issues
- [V6 Test Declarative](./V6_TEST_DECLARATIVE.md) — Test page UI guide

---

*V6 Agent Generation System - Neuronforge*
