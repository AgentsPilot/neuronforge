# V6 Agent Generation System - Architecture

> **Last aligned to code**: 2026-02-22

This document provides a deep technical dive into each phase of the V6 pipeline — both compilation (Phases 0–5) and runtime execution.

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Phase 0: Hard Requirements Extraction](#phase-0-hard-requirements-extraction)
3. [Phases 1 & 2: Skipped](#phases-1--2-skipped)
4. [Phase 3: IR Formalization](#phase-3-ir-formalization)
5. [Phase 4: Deterministic Compilation](#phase-4-deterministic-compilation)
6. [Phase 5: PILOT Translation](#phase-5-pilot-translation)
7. [Validation Gates](#validation-gates)
8. [Auto-Recovery](#auto-recovery)
9. [Runtime Execution Engine](#runtime-execution-engine)
10. [Data Flow: Compilation to Execution](#data-flow-compilation-to-execution)
11. [Error Handling](#error-handling)

---

## Pipeline Overview

The V6 pipeline is orchestrated by [`V6PipelineOrchestrator.ts`](../../lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts). It runs as a single API call from the client perspective but internally executes multiple phases with validation gates between them.

```
                        Enhanced Prompt (from thread conversation)
                                    │
                                    ▼
            ┌───────────────────────────────────────────┐
            │         V6PipelineOrchestrator.run()       │
            │                                           │
            │   Phase 0: HardRequirementsExtractor      │ ← LLM (admin-configured)
            │       │                                   │
            │       ▼                                   │
            │   [Phase 1 & 2 SKIPPED]                   │ ← block-commented
            │       │                                   │
            │       ▼                                   │
            │   Phase 3: IRFormalizer + Gate 3           │ ← LLM (admin-configured)
            │       │         + AutoRecovery            │
            │       ▼                                   │
            │   Phase 4: ExecutionGraphCompiler + Gate 4 │ ← deterministic
            │       │                                   │
            │       ▼                                   │
            │   Phase 5: translateToPilotFormat + Gate 5 │ ← deterministic
            │                                           │
            └───────────────────────────────────────────┘
                                    │
                                    ▼
                        WorkflowStep[] (PILOT format)
                                    │
                                    ▼
            ┌───────────────────────────────────────────┐
            │         WorkflowPilot.execute()            │
            │                                           │
            │   Parse → Build Execution Plan            │
            │       │ (dependency levels, parallel)     │
            │       ▼                                   │
            │   Execute Level 0 steps                   │
            │       ▼                                   │
            │   Execute Level 1 steps (may be parallel) │
            │       ▼                                   │
            │   ...until all levels complete             │
            │                                           │
            └───────────────────────────────────────────┘
                                    │
                                    ▼
                            Execution Results
```

---

## Phase 0: Hard Requirements Extraction

**Class**: [`HardRequirementsExtractor.ts`](../../lib/agentkit/v6/requirements/HardRequirementsExtractor.ts)

**Purpose**: Use an LLM to extract **machine-checkable constraints** from the Enhanced Prompt. These constraints are tracked through every subsequent phase.

**Default model**: `gpt-4o-mini` at temperature `0.0` (configurable via admin config).

**System prompt**: [`hard-requirements-extraction-system.md`](../../lib/agentkit/v6/requirements/prompts/hard-requirements-extraction-system.md)

### Requirement Types

| Type | Description | Example |
|------|-------------|---------|
| `unit_of_work` | Entity being iterated over | `email`, `attachment`, `row` |
| `threshold` | Conditional filter gating an action | `Stage == 4`, `amount > 50` |
| `routing_rule` | Deterministic data routing | `group_by=Sales Person → per_person_email` |
| `invariant` | Constraint that must never be violated | `sequential_dependency`, `no_duplicate_writes` |
| `empty_behavior` | What to do when no data found | `fail`, `skip`, `notify` |
| `required_output` | Fields that must appear in output | `["Date", "Name", "Email"]` |
| `side_effect_constraint` | Conditions gating side effects | `append_sheets only when amount > 50` |

### Outputs

- **HardRequirements**: The structured constraints object
- **RequirementMap**: Tracking map where each requirement starts as `pending` and flows through `compiled → enforced`

### Fallback

If the LLM call fails, returns empty requirements (pipeline continues with no constraint enforcement).

---

## Phases 1 & 2: Skipped

**Status**: Lines ~143–286 of `V6PipelineOrchestrator.ts` are wrapped in a `/* ... */` block comment.

**Why skipped**: The Enhanced Prompt already contains structured sections (`data`, `actions`, `output`, `delivery`) with `specifics.services_involved` and `specifics.resolved_user_inputs`. Phases 1 & 2 were found to just rephrase what's already there, adding ~3,500 tokens and 15–30 seconds with no new information.

**What the commented code did**:
- **Phase 1** (`SemanticPlanGenerator.generate()`): LLM call to produce a semantic plan with assumptions and reasoning
- **Phase 2** (Mock grounding): Created a mock `groundedPlan` with `grounding_confidence: 1.0`

**Downstream impact**:
- `semanticPlan` and `groundedPlan` return as `undefined` in the response
- Gates 1 & 2 produce dummy PASS results
- The requirement map is updated directly from the IR's `requirements_enforcement` array (Week 1 fix)

**Re-enabling**: Remove the block comment. The code says: *"Do NOT delete this code until we achieve 'golden gate' (90%+ success)!"*

---

## Phase 3: IR Formalization

**Class**: [`IRFormalizer.ts`](../../lib/agentkit/v6/semantic-plan/IRFormalizer.ts)

**Purpose**: Map the Enhanced Prompt to a `DeclarativeLogicalIRv4` execution graph. This is the core LLM-heavy phase.

**Default model**: `claude-opus-4-6` at temperature `0.0` (configurable via admin config).

### IR v4.0 Execution Graph

The output is a DAG of typed nodes:

```typescript
interface DeclarativeLogicalIRv4 {
  ir_version: '4.0'
  goal: string
  execution_graph: {
    start: string                           // Entry node ID
    nodes: Record<string, ExecutionNode>    // Flat node map
    variables?: VariableDefinition[]        // Variable declarations
  }
  requirements_enforcement?: RequirementEnforcement[]
}
```

### Node Types

```typescript
interface ExecutionNode {
  id: string
  type: 'operation' | 'choice' | 'parallel' | 'loop' | 'end'

  operation?: {
    operation_type: 'fetch' | 'transform' | 'ai' | 'deliver' | 'file_op'
    fetch?: { plugin_key: string; action: string; config?: Record<string, any> }
    transform?: { type: 'map' | 'filter' | 'reduce' | 'group_by' | 'sort' | 'deduplicate'; input: string; ... }
    ai?: { type: AIOperationType; instruction: string; input?: string; output_schema?: any }
    deliver?: { plugin_key: string; action: string; config?: Record<string, any> }
    file_op?: { type: 'upload' | 'download' | 'generate'; ... }
  }
  choice?: { rules: ChoiceRule[]; default: string }
  loop?: { iterate_over: string; item_variable: string; body_start: string; collect_outputs?: boolean; collect_from?: string }
  parallel?: { branches: ParallelBranch[]; wait_strategy: 'all' | 'any' | 'n' }

  next?: string | string[]
  inputs?: InputBinding[]    // Variables this node reads
  outputs?: OutputBinding[]  // Variables this node writes
}
```

**AI operation types**: `summarize`, `extract`, `deterministic_extract`, `classify`, `sentiment`, `generate`, `decide`, `normalize`, `transform`, `validate`, `enrich`

### Condition Types

```typescript
// Simple condition
{ type: 'simple', variable: 'amount', operator: 'gt', value: 50 }

// Complex condition (AND/OR/NOT)
{ type: 'complex', operator: 'and', conditions: [condition1, condition2] }
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`, `ends_with`, `matches`, `exists`, `is_empty`

### Token Optimization

Only plugins listed in `services_involved` have their schemas injected into the LLM context. For a system with 20 plugins but only 2 needed, this saves ~14,400 tokens.

### Formalization Prompt Enforcement Protocols

The system prompt ([`formalization-system-v4.md`](../../lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md)) contains critical enforcement protocols:

- **Data Flow Reasoning Protocol**: Mandatory pre-flight validation before generating any node config
- **Transform on Non-Array prohibition**: Blocks `operation_type: "transform"` when input is not array type
- **Loop Collection enforcement**: Prevents transform nodes inside loops from referencing the loop's own output variable
- **Nested Loop Variable Scope**: Enforces correct field resolution (e.g., `{{current_email.message_id}}` not `{{current_attachment.message_id}}`)
- **Field Reference Validation**: Every `{{variable.field}}` must be verified against the source plugin schema

---

## Phase 4: Deterministic Compilation

**Class**: [`ExecutionGraphCompiler.ts`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)

**Purpose**: Compile the IR v4.0 execution graph into PILOT DSL workflow steps. **No LLM calls** — purely deterministic.

### Compilation Pipeline

```
1. Validate IR version is 4.0 and execution graph exists
2. Validate graph structure (cycles, orphans, missing nodes)
3. Initialize variable declarations from graph.variables
4. Topological sort to determine execution order
5. Traverse graph from start node, compile each node by type
5.5. Normalize data formats (auto-insert rows_to_objects for 2D arrays)
5.6. Renumber steps sequentially after normalization
6. Validate hard requirements enforcement in compiled workflow
```

### Node-to-Step Compilation

| IR Node Type | Compiled Step Type | Description |
|-------------|-------------------|-------------|
| `operation` (fetch) | `action` | Plugin API call with `plugin`, `operation`, `config` |
| `operation` (transform) | `transform` | Data transformation with `operation`, `input`, `config` |
| `operation` (ai, type != `deterministic_extract`) | `ai_processing` | AI operation with `prompt`, `config.ai_type` |
| `operation` (ai, type == `deterministic_extract`) | `deterministic_extraction` | File extraction (PDF parser + Textract + AI) |
| `operation` (deliver) | `action` | Delivery plugin call (same shape as fetch) |
| `operation` (file_op) | `action` | File operation (upload/download/generate) |
| `choice` | `conditional` | Branching with `condition`, `then[]`, `else[]` |
| `loop` | `scatter_gather` | Iteration with `scatter.input`, `scatter.steps[]`, `gather` |
| `parallel` | (expanded inline) | Parallel branches with `wait_strategy` |
| `end` | (no-op) | Marks graph termination |

### Condition Conversion (IR → DSL)

The compiler maps IR condition operators to PILOT DSL operators:

| IR Operator | DSL Operator |
|-------------|-------------|
| `eq` | `equals` |
| `ne` | `not_equals` |
| `gt` | `greater_than` |
| `lt` | `less_than` |
| `gte` | `greater_than_or_equal` |
| `lte` | `less_than_or_equal` |
| `contains` | `contains` |
| `is_empty` | `is_empty` |

Complex conditions: `{ type: 'complex', operator: 'and' }` → `{ conditionType: 'complex_and', conditions: [...] }`

### Transform Compilation

The compiler performs sophisticated analysis:
1. Detect unnecessary transforms (redundant given downstream nodes)
2. Find downstream delivery nodes to determine required format
3. Choose appropriate PILOT operation based on format needs
4. Map IR expressions to DSL config fields

Valid PILOT transform operations: `set`, `map`, `filter`, `reduce`, `sort`, `group`, `group_by`, `aggregate`, `deduplicate`, `flatten`, `join`, `pivot`, `split`, `expand`, `partition`, `rows_to_objects`, `map_headers`, `render_table`, `fetch_content`

### Loop Compilation

Loops compile to `scatter_gather` steps:

```typescript
{
  type: 'scatter_gather',
  scatter: {
    input: '{{variable.path}}',       // Resolved from node.inputs
    steps: [/* compiled body steps */],
    itemVariable: loop.item_variable,
    maxConcurrency: loop.concurrency
  },
  gather: {
    operation: loop.collect_outputs ? 'collect' : 'flatten',
    outputKey: loop.output_variable,
    from: loop.collect_from           // Optional: collect specific field
  },
  output_variable: loop.output_variable
}
```

---

## Phase 5: PILOT Translation

**Method**: `V6PipelineOrchestrator.translateToPilotFormat()` (private, lines ~637–793)

**Purpose**: Convert compiled DSL steps into production PILOT format — the final normalization before output.

### Field Mapping per Step Type

**Action steps**:
- `dslStep.operation` → `pilotStep.action`
- `dslStep.config` → `pilotStep.params`
- `dslStep.plugin` → `pilotStep.plugin`

**Transform steps**:
- `dslStep.operation` → `pilotStep.operation`
- Input normalized to top-level `pilotStep.input` (from `dslStep.input`, `dslStep.config.input`, or `dslStep.config.config.source`)
- Filter config: `dslStep.config.filters` → `pilotStep.config.condition`
- Map config: `dslStep.config.config.mapping` → `pilotStep.config.mapping`

**AI processing steps**:
- `dslStep.input`, `dslStep.prompt` → `pilotStep.input`, `pilotStep.prompt`
- Config: `ai_type`, `output_schema`, `temperature`

**Scatter-gather (loop) steps**:
- `dslStep.scatter.steps` → recursively translated via `translateStep()`
- `dslStep.gather` → preserved as-is

**Conditional steps**:
- `dslStep.condition` → `pilotStep.condition`
- `dslStep.then` or `dslStep.steps` → `pilotStep.then` (recursively translated)
- `dslStep.else` or `dslStep.else_steps` → `pilotStep.else` (recursively translated)

### Step ID Normalization

`step_1` → `step1` (underscores removed from step IDs)

### Step Name Generation

Priority: description (first segment before `:`, title-cased) → operation name (title-cased from snake_case) → step ID (title-cased)

---

## Validation Gates

**Class**: [`ValidationGates.ts`](../../lib/agentkit/v6/requirements/ValidationGates.ts) (918 lines)

### Gate 3 (Post-IR Formalization)

`validateIR()` checks:
1. Every grounded requirement maps to at least one IR node
2. Unit of work is not flattened (e.g., `attachment` processing isn't collapsed to email-level)
3. Sequential dependencies are explicit in the graph
4. Thresholds occur before side effects
5. **Plugin operation auto-fix**: `PluginResolver` validates every `plugin_key + action` pair against the real plugin registry. Invalid operations are auto-fixed using semantic inference.

### Gate 4 (Post-Compilation)

`validateCompilation()` checks:
1. Every `compiled` requirement maps to a DSL step
2. Thresholds have guard steps (filter/conditional/scatter_gather)
3. Routing rules have corresponding route/branch steps
4. Sequential dependencies enforced by step ordering
5. On pass, requirement status updated to `enforced`

### Gate 5 (Post-Translation — Final)

`validateFinal()` checks **intent satisfaction**:
1. All requirements are in `enforced` status (no `pending`, `mapped`, or `compiled` leftovers)
2. Side effect constraints have guards — recursively searches through nested `scatter_gather` and `conditional` steps
3. Sequential invariants enforced by step ordering
4. No parallel execution of dependent steps

If Gate 5 fails: *"Intent not satisfied: workflow could do the wrong thing"*

---

## Auto-Recovery

**Class**: [`AutoRecoveryHandler.ts`](../../lib/agentkit/v6/requirements/AutoRecoveryHandler.ts)

When Gate 3 fails, the auto-recovery handler attempts structural fixes before rejecting:

| Error Type | Fix Method | Description |
|------------|-----------|-------------|
| `nested_groups` | `flattenNestedGroups` | Move nested conditions up to parent level |
| `missing_field` | `addDefaultValue` | Set path to default value |
| `wrong_type` | `coerceType` | Coerce value to expected type (string, number, boolean, array, object) |
| `invalid_field` | `removeInvalidField` | Delete the invalid path |

**Unrecoverable** (no auto-fix): `requirement_missing`, `constraint_violated`, `data_flow_broken`, `plugin_missing`, `invalid_input`, `schema_violation`

After fixes, the IR is re-validated. If still failing, the pipeline returns an error.

---

## Runtime Execution Engine

After compilation produces a `WorkflowStep[]`, the runtime engine executes it against real plugins.

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **WorkflowPilot** | `lib/pilot/WorkflowPilot.ts` | Main orchestrator — parses workflow, builds execution plan, manages lifecycle |
| **StepExecutor** | `lib/pilot/StepExecutor.ts` | Routes to handler by step type, resolves variables, tracks metrics |
| **ConditionalEvaluator** | `lib/pilot/ConditionalEvaluator.ts` | Evaluates conditions for conditional and switch steps |
| **ExecutionContext** | `lib/pilot/ExecutionContext.ts` | Stores step outputs, resolves `{{variable}}` references, tracks tokens |
| **ParallelExecutor** | `lib/pilot/ParallelExecutor.ts` | Handles parallel/scatter-gather execution with concurrency limits |

### Execution Plan Building

WorkflowPilot builds the plan in 6 stages:
1. **Normalize**: Auto-generate IDs, convert V4 scatter-gather format
2. **Validate**: Check for cycles, missing dependencies, required fields
3. **Build dependency graph**: Adjacency map of step dependencies
4. **Topological sort**: Order steps using Kahn's algorithm
5. **Assign execution levels**: Level 0 = no dependencies, Level N = max(dependency levels) + 1
6. **Detect parallel groups**: Steps at same level that can run concurrently

### Execution Order

```
Level 0: [step1]                    ← execute sequentially
Level 1: [step2, step3]            ← may execute in parallel
Level 2: [step4]                    ← waits for Level 1 to finish
```

Steps that **can** run in parallel: `action`, `transform`
Steps that **cannot**: `conditional`, `switch`, `loop`, `scatter_gather`, `sub_workflow`, `human_approval`, `llm_decision`

### Step Types Supported at Runtime

| Step Type | Handler | Description |
|-----------|---------|-------------|
| `action` | Plugin executor (PluginExecuterV2) | Calls real plugin API |
| `transform` | Built-in transform handlers | map, filter, reduce, sort, group, aggregate, deduplicate, flatten |
| `ai_processing` | AgentKit / LLM | AI operations; auto-detects file inputs → redirects to deterministic extraction |
| `deterministic_extraction` | PDF parser + Textract + AI | Structured extraction from documents |
| `conditional` | ConditionalEvaluator | Evaluates condition, executes `then` or `else` branch |
| `scatter_gather` | ParallelExecutor | Fan-out over array, execute nested steps per item, gather results |
| `loop` | ParallelExecutor | Iterate over array with nested steps |
| `switch` | ConditionalEvaluator | Route based on discrete values (cases + default) |
| `delay` | setTimeout | Wait/sleep |
| `validation` | Schema validator | Validate data against rules |
| `sub_workflow` | Recursive WorkflowPilot | Execute nested workflow |
| `human_approval` | Pause execution | Wait for human approval |

### Variable Resolution

**ExecutionContext** resolves `{{variable}}` references at runtime:

| Prefix | Example | Resolves To |
|--------|---------|-------------|
| `step*` | `{{step1.data.emails}}` | Step output (auto-navigates into `.data`) |
| `input` / `inputs` | `{{input.recipient}}` | User-provided input value |
| `var` | `{{var.counter}}` | Runtime variable |
| `current` / `item` | `{{item.subject}}` | Current loop/scatter item |
| Custom | `{{current_email.id}}` | Custom scatter variable name |

**Resolution process**:
1. Extract variable path: `"{{step1.data.emails}}"` → `"step1.data.emails"`
2. Identify root: `step1` → step outputs, `input` → input values, `item` → loop context
3. Navigate path with smart field matching (case-insensitive, snake_case ↔ camelCase)
4. Return resolved value or throw `VariableResolutionError`

### output_variable System

Steps can register named outputs via the `output_variable` field:

```json
{
  "step_id": "step1",
  "type": "action",
  "plugin": "google-mail",
  "action": "search_emails",
  "output_variable": "emails_result"
}
```

After execution, the step's data is registered as `context.setVariable("emails_result", data)`. Downstream steps can reference it as `{{emails_result}}` or `{{emails_result.emails}}` instead of `{{step1.data.emails}}`.

This is particularly important for:
- **Scatter-gather**: Each iteration's output is registered by name
- **Conditional branches**: Branch results are registered for downstream access

### Conditional Evaluation

**ConditionalEvaluator** handles all condition evaluation:

**Supported formats**:
1. Simple: `{ field: "score", operator: ">", value: 70 }`
2. Complex AND: `{ conditionType: "complex_and", conditions: [...] }`
3. Complex OR: `{ conditionType: "complex_or", conditions: [...] }`
4. Complex NOT: `{ conditionType: "complex_not", condition: {...} }`
5. String expressions: `"step1.data.score > 70 && step2.success"`

**Operators**:

| Category | Operators |
|----------|-----------|
| Equality | `==`, `equals`, `eq`, `!=`, `not_equals`, `ne` |
| Numeric | `>`, `>=`, `<`, `<=`, `greater_than`, `less_than`, `gt`, `gte`, `lt`, `lte` |
| Collections | `contains`, `not_contains`, `in`, `not_in` |
| Existence | `exists`, `not_exists` |
| Emptiness | `is_empty`, `is_not_empty` |
| Pattern | `matches`, `matches_regex`, `starts_with`, `ends_with` |
| Date | `within_last_days`, `before`, `after` |

**Truthiness rules** (when evaluating resolved values):
- Strings: truthy if non-empty
- Numbers: truthy if non-zero
- Booleans: logical value
- null / undefined: **falsy**
- **Arrays: truthy if non-empty** (an empty array `[]` is still truthy in JS — this can cause unexpected branch selection)
- Objects: truthy if non-empty

**Variable resolution in conditions**: The evaluator auto-wraps field references in `{{}}` if needed, resolves through ExecutionContext, and supports dynamic item variable detection (e.g., `current_email.subject` → finds the `current_email` scatter variable).

---

## Data Flow: Compilation to Execution

This section traces how data flows from IR nodes through compilation to runtime execution.

### Example: Gmail Search → Filter → Send Email

**Phase 3 output (IR v4.0)**:
```
Node: fetch_emails (operation/fetch) → outputs: emails_result
Node: check_emails (choice) → rules: [{condition: emails_result.length > 0, next: filter_emails}, default: send_empty_digest]
Node: filter_emails (operation/transform) → inputs: emails_result, outputs: filtered_emails
Node: send_digest (operation/deliver) → inputs: filtered_emails
Node: send_empty_digest (operation/deliver) → inputs: (none)
```

**Phase 4 output (compiled DSL)**:
```
step_1: action (google-mail.search_emails) → output_variable: emails_result
step_2: conditional → condition: {variable: "emails_result", operator: "is_not_empty"}
  then: [step_3: transform (filter), step_4: action (send_email)]
  else: [step_5: action (send_email with "no results" body)]
```

**Phase 5 output (PILOT format)**:
```json
[
  { "id": "step1", "type": "action", "plugin": "google-mail", "action": "search_emails", "output_variable": "emails_result" },
  { "id": "step2", "type": "conditional", "condition": {...},
    "then": [{ "id": "step3", "type": "transform", ... }, { "id": "step4", "type": "action", ... }],
    "else": [{ "id": "step5", "type": "action", ... }]
  }
]
```

**Runtime execution**:
```
Level 0: step1 executes → calls Gmail API → stores result in context
         → registers output_variable "emails_result"
Level 1: step2 executes → ConditionalEvaluator resolves condition
         → if true: execute step3, step4 sequentially inside branch
         → if false: execute step5 inside branch
         → branch results registered via output_variable if specified
```

---

## Error Handling

### Phase-Specific Errors

| Phase | Error | Recovery |
|-------|-------|----------|
| P0 | LLM fails to extract requirements | Returns empty requirements, pipeline continues |
| P3 | LLM produces invalid IR | Error rethrown → `withProviderFallback()` retries with different provider |
| P3 | Gate 3 fails | `AutoRecoveryHandler` attempts structural fixes → re-validates |
| P4 | Compiler can't process graph | `DSL compilation failed` error |
| P4 | Gate 4 fails | `Compilation validation failed` error |
| P5 | Gate 5 fails | `Intent not satisfied: workflow could do the wrong thing` |

### Runtime Errors

| Error | Cause | Behavior |
|-------|-------|----------|
| `VariableResolutionError` | Referenced step hasn't executed or failed | Step fails, dependent steps skipped |
| Plugin auth failure | Missing/expired OAuth tokens | Step fails with auth error |
| API rate limit | Gmail/Sheets/etc. rate exceeded | Retry with backoff if retry policy configured |
| Condition evaluation error | Invalid field reference or operator | Conditional step fails |

### Error Propagation

1. Step failure → marks step as failed, stores error in context
2. Dependent steps → skipped if dependency failed
3. Workflow result → `success: false` if any critical step fails
4. Partial results → completed steps still available in output

---

## Performance

### Compilation Timing

| Phase | LLM Calls | Typical Duration |
|-------|-----------|-----------------|
| Phase 0 | 1 (gpt-4o-mini) | 10–15s |
| Phase 1 & 2 | 0 (skipped) | 0s |
| Phase 3 | 1 (claude) | 60–90s |
| Phase 4 | 0 | <100ms |
| Phase 5 | 0 | <10ms |

Total compilation: ~70–110s (dominated by Phase 3 LLM call)

### Execution Timing

Depends entirely on plugin API response times. Typical:
- Gmail search: 200–500ms
- Sheets read/write: 300–800ms
- AI processing: 2–10s per call
- Parallel groups: bounded by slowest step in group

---

*Next: [API Reference](./V6_API_REFERENCE.md)*
