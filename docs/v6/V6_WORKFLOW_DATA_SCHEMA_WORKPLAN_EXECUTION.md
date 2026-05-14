# V6 Workflow Data Schema — Execution Simulator Workplan

> **Status**: Phase A ✅, A+ ✅, Pre-B ✅, Phase B ✅, Phase D ✅, Phase E ✅ — Live execution with real plugins (Google Sheets + Gmail). 7/7 steps passing end-to-end.
> **Date**: 2026-03-23
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplan**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md)

---

## Context

The V6 pipeline compiles user intent into executable PILOT DSL steps (Phase 4 output). Before these steps run against real APIs, we need a way to **validate that the compiled DSL is actually executable** — that variable references resolve, data flows between steps correctly, transforms produce expected shapes, and conditionals branch properly.

This workplan defines a **3-phase test strategy** that progressively increases execution fidelity:

```
Phase A: Lightweight DSL Simulator       → Validate DSL structure and data flow (no real deps)
Phase B: Real Context + Mocked Plugins   → Test actual Pilot variable resolution and step routing
Phase C: Full WorkflowPilot Integration  → Test complete 8-phase execution with plugin stubs
```

---

## Approach Options

### Option A — Lightweight DSL Simulator ✅ Selected

A standalone script that loads the compiled DSL output files, walks through steps sequentially, resolves variables, and uses **stub data generated from output_schema** for plugin actions. No Pilot engine dependencies.

**What it validates:**
- Variable resolution chain — every `{{X}}` resolves to real data
- Data flow between steps — step N output feeds step N+1 input correctly
- Config coverage — all `{{config.X}}` refs exist in workflowConfig
- Schema consistency — field names match across steps (catches O10-type issues at test time)
- Structural correctness — conditionals, scatter-gather, transforms wire up correctly
- Unresolved references — flags any `{{X}}` that cannot be resolved

**Pros:** Zero external dependencies, fast to build, directly validates pipeline output.
**Cons:** Doesn't test real Pilot code paths (variable resolution, step routing, parallel execution).

---

### Option B — Real ExecutionContext + Mocked Plugins (Next step after A)

Uses the real `ExecutionContext` class for variable resolution and the real `StepExecutor` for step type routing, but mocks `PluginExecuterV2.execute()` to return stub data instead of calling real APIs.

```typescript
// Mock the plugin layer
const mockPluginExecuter = {
  execute: async (userId, plugin, action, params) => {
    return { success: true, data: generateStubFromSchema(step.output_schema) }
  }
}

// Use real Pilot components
const context = new ExecutionContext(execId, fakeAgent, userId, sessionId, workflowConfig)
const stepExecutor = new StepExecutor(mockSupabase, mockStateManager)
```

**What it validates (beyond A):**
- Real `ExecutionContext.resolveAllVariables()` handles all reference patterns
- Real `StepExecutor` routes step types correctly
- Real `ConditionalEvaluator` evaluates conditions
- Real transform execution (filter, map, flatten, reduce)

**Pros:** Tests actual Pilot code paths for variable resolution and step routing.
**Cons:** Requires mocking Supabase client, StateManager, and PluginExecuterV2 singleton.

---

### Option C — Full WorkflowPilot Integration (Future)

Runs the complete `WorkflowPilot.execute()` with all 8 phases, mocking only the external boundaries (Supabase DB, plugin API calls).

**What it validates (beyond B):**
- Full 8-phase execution lifecycle
- WorkflowParser DAG construction and topological sort
- Pre-flight validation
- State persistence flow
- Error recovery and retry policies
- Parallel execution coordination

**Pros:** Complete integration test of the Pilot engine with compiled DSL.
**Cons:** Heavy setup, fragile to internal refactors, requires mocking DB layer. Better suited as a dedicated integration test suite than a pipeline validation script.

---

## Selected Approach: Phase A — Lightweight DSL Simulator

### Graduation Path

```
Phase A (now)  →  Phase B (after A is stable)  →  Phase C (integration test suite)
     │                    │                              │
     │                    │                              └─ Full WorkflowPilot.execute()
     │                    │                                 Mock: Supabase + Plugins
     │                    │
     │                    └─ Real ExecutionContext + StepExecutor
     │                       Mock: PluginExecuterV2 + Supabase
     │
     └─ Standalone simulator, no Pilot deps
        Mock: All execution via stub generators
```

Each phase inherits the previous phase's test cases. Phase A test scenarios become Phase B's regression suite.

---

## Phase A — Implementation Design

### Architecture

```
┌─────────────────────────────────────────────────────┐
│              test-dsl-execution-simulator.ts         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. FileLoader                                      │
│     ├── Load phase4-pilot-dsl-steps.json  (DSL)     │
│     ├── Load phase0-workflow-config.json  (config)  │
│     └── Load phase2-data-schema.json      (schema)  │
│                                                     │
│  2. StubDataGenerator                               │
│     ├── generateFromSchema(output_schema) → data    │
│     ├── String  → "mock_<field_name>"               │
│     ├── Number  → realistic value by field name     │
│     ├── Boolean → true                              │
│     ├── Array   → 2-3 items with schema applied     │
│     └── Object  → recursive generation              │
│                                                     │
│  3. VariableStore                                   │
│     ├── config: Record<string, any>  (from file)    │
│     ├── steps: Map<string, any>      (step outputs) │
│     ├── resolve(template: string) → value           │
│     └── resolveDeep(obj: any) → resolved obj        │
│                                                     │
│  4. DSLSimulator                                    │
│     ├── executeAction(step)        → stub data      │
│     ├── executeTransform(step)     → computed data   │
│     ├── executeConditional(step)   → branch result  │
│     ├── executeScatterGather(step) → collected data │
│     ├── executeAiProcessing(step)  → stub data      │
│     └── run(steps[]) → ExecutionReport              │
│                                                     │
│  5. Validator                                       │
│     ├── checkUnresolvedRefs()                       │
│     ├── checkFieldNameConsistency()                 │
│     ├── checkConfigCoverage()                       │
│     └── checkDataFlowChain()                        │
│                                                     │
│  6. ReportGenerator                                 │
│     └── Write execution-simulation-report.json      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Input Files

| File | Source | Purpose |
|------|--------|---------|
| `phase4-pilot-dsl-steps.json` | Pipeline Phase 4 output | The compiled DSL steps to simulate |
| `phase4-workflow-config.json` | Pipeline Phase 4 output (post-O7 merge) | **Runtime config** — IntentContract defaults (clean keys + LLM-translated values) merged with user overrides. This is what the Pilot engine receives at execution time. |
| `phase2-data-schema.json` | Pipeline Phase 2 output | Data schema for schema-aware validation |

> **Why `phase4-workflow-config.json` and not `phase0-workflow-config.json`?**
> `phase0` contains raw user inputs with EP-prefixed keys (e.g., `gmail__search__filter_criteria`). The Phase 1 LLM absorbs these, translates values to plugin-native syntax, composes related entries, and declares clean config keys in the IntentContract. The O7 merge then produces `phase4-workflow-config.json` with clean keys (e.g., `gmail_search_query`) that match the `{{config.X}}` references in the compiled DSL. This is the config the runtime engine uses.

### Components

#### 1. FileLoader

Loads the three input files from the output directory. Validates that all required files exist before proceeding.

#### 2. StubDataGenerator

Generates realistic mock data from a step's `output_schema`. This is the core of the simulation — it produces data that downstream steps can consume.

**Generation rules:**

| Schema Type | Strategy | Example |
|-------------|----------|---------|
| `string` | Field-name-aware generation | `"id"` → `"msg_001"`, `"email"` → `"user@example.com"`, `"date"` → `"2026-03-22T10:00:00Z"` |
| `number` | Field-name-aware generation | `"amount"` → `149.99`, `"size"` → `1024`, `"count"` → `3` |
| `boolean` | Default `true`, or context-aware | `"is_image"` → `false`, `"created"` → `true` |
| `array` | Generate 3 items using `items` schema | Recursive application of object schema |
| `object` | Recursive generation from `properties` | Walk each property, apply type rules |

**Field-name heuristics** (makes stubs realistic for downstream consumption):

| Field pattern | Generated value |
|---------------|-----------------|
| `*_id`, `*Id` | `"mock_<prefix>_001"` |
| `*_url`, `*_link`, `*Link` | `"https://example.com/mock/<field>"` |
| `*email*` | `"mock@example.com"` |
| `*date*`, `*_at` | `"2026-03-22T10:00:00Z"` |
| `*name*` | `"Mock <context>"` |
| `*amount*`, `*price*` | `149.99` |
| `*count*`, `*total*` | `3` |
| `*size*` | `1024` |
| `filename` | `"invoice_001.pdf"` |
| `mimeType`, `mime_type` | `"application/pdf"` |

#### 3. VariableStore

Manages the execution state — stores config values and step outputs, resolves `{{template}}` references.

**Resolution patterns:**

| Pattern | Resolution |
|---------|------------|
| `{{config.X}}` | Lookup in workflowConfig |
| `{{stepOutput}}` | Lookup in step output map by `output_variable` name |
| `{{stepOutput.field}}` | Nested field access on step output |
| `{{stepOutput.field.subfield}}` | Deep nested access |
| `{{item.field}}` | Current scatter-gather iteration item |
| Literal values (`true`, `50`, `"text"`) | Pass through unchanged |

**Deep resolution:** Recursively walks objects and arrays, resolving all `{{X}}` patterns found in string values. Handles nested objects like:
```json
{
  "recipients": { "to": ["{{config.user_email}}"] },
  "content": { "subject": "{{digest_content.subject}}" }
}
```

#### 4. DSLSimulator

The main execution engine. Walks steps in order, executing each based on its `type`.

**Step execution by type:**

| Step Type | Execution Strategy |
|-----------|-------------------|
| `action` | Resolve config params → log resolved params → generate stub data from `output_schema` → store in VariableStore |
| `transform` (`filter`) | Resolve input → apply condition to filter items → store filtered result |
| `transform` (`flatten`) | Resolve input → simulate flatten (pass through array items) → store result |
| `transform` (`map`) | Resolve input → pass through with output_schema shape → store result |
| `transform` (`reduce`) | Resolve input → simulate reduction (count → array length, sum → total) → store result |
| `conditional` | Resolve condition → evaluate (exists, gt, eq, etc.) → execute `steps` or `else_steps` branch |
| `scatter_gather` | Resolve scatter input → for each item, execute nested steps with `itemVariable` set → collect results |
| `ai_processing` | Resolve input → generate stub from config.output_schema → store result |

**Execution loop:**
```
for each step in dsl_steps:
  1. Log step start (step_id, type, description)
  2. Resolve all {{variables}} in step.config
  3. Execute based on step.type
  4. Store output in VariableStore under step.output_variable
  5. Log step complete (output variable name, data shape summary)
  6. Validate: check for unresolved {{refs}} in resolved config
```

**Scatter-gather execution:**
```
for each item in scatter.input:
  set itemVariable (e.g., "attachment") = current item
  for each nested step in scatter.steps:
    execute step with item in scope
    store output (scoped to this iteration)
  collect iteration result
store collected results as gather output
```

#### 5. Validator

Post-execution validation checks:

| Check | What it catches |
|-------|-----------------|
| **Unresolved refs** | Any `{{X}}` that remained as literal string after resolution — means a variable reference is broken |
| **Field name consistency** | Transform output field names vs upstream plugin output field names (O10-type issues) |
| **Config coverage** | Config keys declared in DSL vs keys present in workflowConfig — flags missing keys |
| **Data flow chain** | For each step, verify its input variable was produced by an earlier step — catches ordering issues |
| **Conditional reachability** | Verify both branches of conditionals are structurally valid |
| **Scatter-gather integrity** | Verify nested steps reference `itemVariable` correctly |

#### 6. ReportGenerator

Writes a structured JSON report:

```json
{
  "timestamp": "2026-03-22T...",
  "input_files": { "dsl": "...", "config": "...", "schema": "..." },
  "summary": {
    "total_steps": 16,
    "executed": 16,
    "skipped": 0,
    "warnings": 1,
    "errors": 0
  },
  "step_log": [
    {
      "step_id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "operation": "search_emails",
      "resolved_config": { "query": "subject:(Invoice...", "max_results": 50 },
      "output_variable": "matching_emails",
      "output_shape": { "type": "object", "keys": ["emails", "total_found", "search_query", "searched_at"] },
      "status": "ok"
    }
  ],
  "validation": {
    "unresolved_refs": [],
    "missing_config_keys": ["sheet_tab_name"],
    "field_mismatches": [],
    "data_flow_breaks": []
  },
  "variable_state": {
    "config": { "...all config keys..." },
    "step_outputs": { "matching_emails": "{object with 4 keys}", "..." }
  }
}
```

### Output Files

| File | Location | Purpose |
|------|----------|---------|
| `execution-simulation-report.json` | `output/vocabulary-pipeline/` | Full execution report with step log and validation |
| Console output | Terminal | Step-by-step execution log with pass/fail indicators |

### Script Location

```
scripts/test-dsl-execution-simulator/
├── index.ts                  # Entry point — loads files, wires components, runs simulation
├── file-loader.ts            # A1: Load and validate input files
├── stub-data-generator.ts    # A2: Schema-to-mock-data generator
├── variable-store.ts         # A3: Config + step output storage, {{template}} resolution
├── dsl-simulator.ts          # A4-A8: Step execution engine (action, transform, conditional, scatter-gather, ai)
├── validator.ts              # A9: Post-execution validation checks
└── report-generator.ts       # A10: JSON report + console output
```

Follows the same pattern as `scripts/test-complete-pipeline-with-vocabulary.ts` — run via `npx tsx scripts/test-dsl-execution-simulator/index.ts`.

### Implementation Tasks

| # | Task | Description |
|---|------|-------------|
| A1 | FileLoader | Load 3 input files, validate existence |
| A2 | StubDataGenerator | Schema-to-mock-data generator with field-name heuristics |
| A3 | VariableStore | Config + step output storage, `{{template}}` resolution, deep resolution |
| A4 | DSLSimulator — action steps | Resolve params, generate stub, store output |
| A5 | DSLSimulator — transform steps | filter, flatten, map, reduce execution |
| A6 | DSLSimulator — conditional steps | Condition evaluation, branch selection |
| A7 | DSLSimulator — scatter-gather | Fan-out with item scoping, nested step execution, result collection |
| A8 | DSLSimulator — ai_processing | Stub generation from output_schema |
| A9 | Validator | Post-execution checks (unresolved refs, config coverage, data flow, field consistency) |
| A10 | ReportGenerator | JSON report + console output |
| A11 | Integration | Wire all components, test with current pipeline output |

### Success Criteria

The simulator is complete when:

1. All 16 steps from the current DSL output execute without unresolved references
2. The validation report shows zero errors for config coverage and data flow
3. Scatter-gather correctly fans out and collects results
4. Conditional branches execute the correct path based on stub data
5. The execution report provides enough detail to identify any DSL compilation issue without reading the DSL file directly

### Phase A Results

> **Date**: 2026-03-22
> **Status**: ✅ Passed — 28 steps executed, 0 warnings, 0 errors, 6/6 validation checks passed

All `{{config.X}}` references resolved against `phase4-workflow-config.json` (post-O7 merge). Scatter-gather fanned out 3 iterations correctly. Conditional branched into `then` path. No unresolved references, no missing config keys, no data flow breaks.

---

## Phase A+ — Extended Validation Checks

Phase A validated that the DSL is structurally executable. Phase A+ adds **deeper static analysis** of the DSL structure, output schemas, and cross-step data contracts. These are all extensions to the existing `validator.ts` — no Pilot engine dependencies needed.

### A+ Checks

| # | Check | What it catches | Severity |
|---|-------|-----------------|----------|
| A+1 | **Cross-step field reference tracing** | For every `{{variable.field}}` reference in step configs, verify that `field` exists in the producing step's `output_schema.properties`. Today we only check that `variable` was produced — not that `field` is a valid property of that variable's output. Catches: referencing `{{attachment_content.content}}` when the schema only has `data` (O10b-type issues). | error |
| A+2 | **Scatter-gather item field validation** | Inside scatter-gather nested steps, verify that `{{itemVariable.field}}` references (e.g., `{{attachment.message_id}}`) exist in the scatter input's item schema. The scatter input is an array — check that `field` exists in `items.properties` of the upstream output_schema. Catches: referencing fields that don't exist on the iteration item. | error |
| A+3 | **Conditional condition field validation** | For each conditional step, verify that the condition's `field` reference points to a variable that has been produced before the conditional, and that the field type is compatible with the operator (e.g., `gt` requires numeric field). Catches: conditions referencing non-existent variables or type mismatches (comparing string with `>` operator). | error |
| A+4 | **Config value type checking** | For each `{{config.X}}` reference, trace it to the consuming plugin action's parameter schema and verify the config value's type matches. E.g., `config.amount_threshold` is `50` (number) and is used in a `gt` comparison — valid. But if it were `"50"` (string), flag a type mismatch. | warning |
| A+5 | **Output schema completeness** | Flag any action step that has an `output_variable` but no `output_schema`. Without an output_schema, downstream steps can't be validated and the stub generator can't produce data. | warning |
| A+6 | **Duplicate output variable detection** | Flag if two steps at the same scope level write to the same `output_variable`. Inside scatter-gather iterations this is expected (each iteration overwrites), but at top-level it indicates a compilation bug where one step's output silently overwrites another's. | error |
| A+7 | **Execution order visualization** | Print a step dependency DAG to the console showing which step depends on which. Format: `step1 → step2 → step3 → step4[scatter: step5→step6→step7→step8→step9→step10] → step11 → step12[cond: step13→step14] → step15 → step16`. Makes it easy to spot ordering issues at a glance. | info |

### A+ Implementation Tasks

| # | Task | File | Description |
|---|------|------|-------------|
| A+1 | Cross-step field tracing | `validator.ts` | Walk all `{{var.field}}` refs, look up `field` in producing step's output_schema properties |
| A+2 | Scatter item field check | `validator.ts` | Resolve scatter input's item schema, check nested step refs against it |
| A+3 | Conditional field check | `validator.ts` | Verify condition field references exist and types are compatible with operators |
| A+4 | Config type check | `validator.ts` | Trace `{{config.X}}` to consuming parameter schema, compare value types |
| A+5 | Schema completeness | `validator.ts` | Flag action steps with output_variable but no output_schema |
| A+6 | Duplicate output vars | `validator.ts` | Detect same-scope duplicate output_variable names |
| A+7 | DAG visualization | `report-generator.ts` | Print step dependency graph to console |

### A+ Success Criteria

1. All A+ checks pass on the current pipeline output with zero errors
2. A+1 would have caught the O10b issue (`attachment_content.content` vs `attachment_content.data`) if it had existed at test time
3. A+2 validates all scatter-gather item references against the actual item schema
4. A+7 produces a readable dependency graph in the console output

---

## Pre-B: DSL-to-Pilot Compatibility Fix ✅

> **Status:** ✅ Implemented and verified — 13/13 simulator checks pass with Pilot-compatible format.

Before Phase B can use real Pilot components, the compiled DSL must match the field names the Pilot engine expects. Analysis of `StepExecutor.ts` and `lib/pilot/types.ts` revealed **2 critical mismatches** and **1 medium issue** in the compiler output for action-type steps:

### Mismatches

| # | Field | DSL Outputs | Pilot Expects | Severity | Impact |
|---|-------|-------------|---------------|----------|--------|
| B0-1 | **Action name** | `operation: "search_emails"` | `action: "search_emails"` | 🔴 Critical | `StepExecutor.executeAction()` reads `step.action` (line 713). With `operation`, this is `undefined` → throws `"missing plugin or action"` error. |
| B0-2 | **Parameters** | `config: { query: "..." }` | `params: { query: "..." }` | 🔴 Critical | `StepExecutor` reads `(step as ActionStep).params` (line 152, 322). With `config`, params are `undefined` → plugin receives no parameters. |
| B0-3 | **Step identity** | `step_id` + `id` (both) | `id` only, `name` required | 🟡 Medium | `WorkflowStepBase` requires `id: string` and `name: string`. DSL outputs redundant `step_id` and missing `name`. |

> **Note:** Transform steps are NOT affected — they correctly use `operation` and `config` which matches the Pilot's `TransformStep` interface.

### Why This Happens

The `ExecutionGraphCompiler` was built to produce a human-readable DSL format. The Pilot engine's `ActionStep` interface uses different field names:

```typescript
// ActionStep (lib/pilot/types.ts)
interface ActionStep extends WorkflowStepBase {
  type: 'action'
  plugin: string
  action: string           // ← Pilot reads this
  params: Record<string, any>  // ← Pilot reads this
}
```

```typescript
// Compiler output (ExecutionGraphCompiler.ts, compileFetchOperation)
{
  step_id: stepId,
  type: 'action',
  plugin: fetch.plugin_key,
  operation: fetch.action,  // ← Compiler writes this
  config: { ... }           // ← Compiler writes this
}
```

### Fix — Implemented

**Approach:** Added a **Phase 5: `toPilotFormat()`** pass at the end of the `compile()` method in `ExecutionGraphCompiler.ts`. This converts field names at the output boundary, keeping all internal compiler logic (normalization, reconciliation, schema extraction) untouched — they still use `operation`/`config` internally.

The `toPilotFormat()` method:
1. **Renames `operation` → `action`** for `type: 'action'` steps only
2. **Renames `config` → `params`** for `type: 'action'` steps only
3. **Ensures `id`** is set (from `step_id` if needed)
4. **Adds `name`** field (uses `description` value)
5. **Recurses** into nested steps (scatter-gather, conditional branches)

Transform steps keep `operation` and `config` unchanged.

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` — `toPilotFormat()` method, called in `compile()` after Phase 4 optimization.

**Simulator:** Already handled both formats via `||` fallbacks (`step.operation || step.action`, `step.config || step.params`) — no changes needed.

### Implementation Tasks

| # | Task | Status | Description |
|---|------|--------|-------------|
| B0-1 | Rename `operation` → `action` in compiler | ✅ | `toPilotFormat()` converts action steps |
| B0-2 | Rename `config` → `params` in compiler | ✅ | Same method — action steps only |
| B0-3 | Fix step identity fields | ✅ | `id` ensured, `name` added from description |
| B0-4 | Update execution simulator | ✅ | Already handled both formats via fallbacks |
| B0-5 | Re-run pipeline + simulator | ✅ | 25 steps, 13/13 checks passed, 0 errors |

### Pre-B Results

> **Date**: 2026-03-22
> **Status**: ✅ Passed — pipeline re-run with new compiler, simulator verified 25 steps, 13/13 checks, 0 errors

Confirmed in compiled output:
- Action steps: `action: "search_emails"`, `params: { query: "..." }` ✅
- Transform steps: `operation: "flatten"`, `config: { ... }` ✅ (unchanged)
- All steps: `id: "step1"`, `name: "Search Gmail for..."` ✅

---

## Phase B — Real Pilot Engine Simulation

> **Prerequisite:** Pre-B compatibility fix ✅ complete.
> **Status:** ✅ Complete. B1-B9 implemented, B10 fixed. 8/8 steps pass through real Pilot engine.

### Goal

Run the compiled DSL through **real Pilot components** (`StepExecutor`, `ExecutionContext`, `ParallelExecutor`, `ConditionalEvaluator`) with mocked external boundaries (plugins, database). This validates that the DSL actually executes in the real engine — not just in our custom simulator.

### Approach: Direct StepExecutor (NOT WorkflowPilot)

`WorkflowPilot` has heavy DB dependencies (`loadConfig()`, `StateManager`, `ApprovalTracker`). Instead, we use `StepExecutor` directly with a minimal step-walker that replicates WorkflowPilot's iteration logic in ~30 lines.

### Real Components Used

| Component | Constructor | Role |
|-----------|-------------|------|
| `ExecutionContext` | `(executionId, agent, userId, sessionId, inputValues?)` | Real variable resolution, step output storage |
| `StepExecutor` | `(supabase, stateManager?, stepCache?)` | Real step type routing, transform execution |
| `ConditionalEvaluator` | `()` | Real condition evaluation (standalone, zero deps) |
| `ParallelExecutor` | `(stepExecutor, maxConcurrency?)` | Real scatter-gather fan-out |

### Mocks Required

| Mock | Why | Approach |
|------|-----|----------|
| **PluginExecuterV2** | Action steps call `PluginExecuterV2.getInstance().execute()` to run plugins | Monkey-patch `getInstance()` to return a mock that generates stub data from output schemas |
| **SupabaseClient** | StepExecutor constructor requires it (used in `transformParametersForPlugin`) | Minimal stub — returns `{ data: null, error: null }` for all queries |
| **AuditTrailService** | Singleton initialized in StepExecutor, attempts DB writes | Pre-initialize with `{ enabled: false }` |
| **runAgentKit** | Called for `ai_processing` and `llm_decision` steps | Mock to return stub data matching output_schema |

### What Doesn't Need Mocking

| Component | Why it works as-is |
|-----------|-------------------|
| `ConditionalEvaluator` | Standalone, zero dependencies |
| `DataOperations` | Standalone transform logic (filter, map, sort, group) |
| `StepCache` | In-memory, standalone — pass `new StepCache(false)` to disable |
| `transformParametersForPlugin` | Fails gracefully if PluginManagerV2 not found — returns params unchanged |
| `Logger (Pino)` | Works without config, writes to stdout |

### File Structure

```
scripts/test-dsl-pilot-simulator/
├── index.ts                    # Entry point — setup mocks, load DSL, run
├── pilot-runner.ts             # Mini step walker (iterates steps, calls StepExecutor)
├── stub-data-provider.ts       # Generates stub data per plugin/action (reuses Phase A generator)
├── report-generator.ts         # Execution report output
└── mocks/
    ├── mock-plugin-executer.ts # Patches PluginExecuterV2.getInstance()
    ├── mock-supabase.ts        # Minimal SupabaseClient stub
    └── mock-services.ts        # AuditTrailService + runAgentKit mocks
```

### Implementation Tasks

| # | Task | Description |
|---|------|-------------|
| B1 | Mock PluginExecuterV2 | Patch `getInstance()` to return mock with `execute()` returning stub data from output_schema |
| B2 | Mock SupabaseClient | Minimal stub satisfying constructor type |
| B3 | Mock services | AuditTrailService (disabled), runAgentKit (stub output) |
| B4 | Stub data provider | Reuse Phase A's `stub-data-generator.ts` — maps `(plugin, action, params)` → stub data |
| B5 | Pilot runner | Mini step walker: iterate steps, call `stepExecutor.execute()`, register `output_variable` in context |
| B6 | Entry point | Wire mocks → load DSL → create ExecutionContext with fake Agent → run → report |
| B7 | Handle scatter-gather | Wire `ParallelExecutor` into StepExecutor, verify fan-out works |
| B8 | Handle ai_processing | Mock `runAgentKit` to return structured stub data |
| B9 | Report + validation | Reuse Phase A's report generator, compare real execution output vs Phase A simulation |

### Implementation Order

```
B1-B3 (mocks)  →  B4 (stub data)  →  B5 (pilot runner)  →  B6 (entry point)
                                                             →  B7 (scatter-gather)
                                                             →  B8 (ai processing)
                                                             →  B9 (report)
```

Mocks must be set up **before** any Pilot imports to prevent singleton initialization with real dependencies.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `PluginExecuterV2` private constructor — can't instantiate mock directly | High | Patch `getInstance()` static method before any StepExecutor call |
| `transformParametersForPlugin` dynamically imports PluginManagerV2 | Low | Fails gracefully, returns params unchanged |
| `runAgentKit` import chain pulls in OpenAI/Anthropic SDKs | Medium | Mock before import, or use dynamic import pattern |
| Module-level singleton initialization races | Medium | Set up all mocks in a preload step before importing Pilot modules |
| StepExecutor private methods can't be overridden | Low | Mock at dependency boundary (PluginExecuterV2), not at method level |

### Success Criteria

1. All DSL steps execute through real `StepExecutor.execute()` without errors
2. Real `ExecutionContext.resolveVariable()` resolves all `{{step.field}}` references
3. Real `DataOperations` processes filter/flatten/map transforms
4. Real `ConditionalEvaluator` evaluates conditions against actual context state
5. Real `ParallelExecutor.executeScatterGather()` fans out and gathers correctly
6. Zero database or network calls during entire simulation
7. Results match Phase A simulation (same step count, same variable outputs)

### Phase B Results

> **Date**: 2026-03-22
> **Status**: ✅ 8/8 top-level steps executed, 0 failures. B10 discovered and fixed.

**Phase B Run 1 (before B10 fix):**
- 8/8 steps reported as passed, but step15 (`send_email`) silently failed with `VariableResolutionError: Unknown variable reference root: config`
- Revealed that `{{config.X}}` is not a supported variable root in ExecutionContext
- Led to B10 fix: compiler rewrites `{{config.X}}` → `{{input.X}}`

**Phase B Run 2 (after B10 fix):**
- 8/8 steps executed successfully through real Pilot engine
- `{{input.recipient_email}}` resolved correctly via real `ExecutionContext`
- All config references (`gmail_search_query`, `base_folder_id`, `spreadsheet_id`, `sheet_tab_name`, `amount_threshold`, `recipient_email`) resolved from `inputValues`

**What Phase B validated:**
- Real `StepExecutor` routes all step types correctly (action, transform, conditional, ai_processing)
- Real `ExecutionContext` resolves `{{input.X}}` and `{{step.field}}` references
- Real transform execution (flatten, filter with conditions like `item.mimeType`, `item.amount > 50`)
- Real `ConditionalEvaluator` evaluates `high_value_items exists` against context state
- Mocked `PluginExecuterV2` returns stub data for action steps
- AI step (step14) executed through real `runAgentKit` → real OpenAI call (1030 tokens, gpt-4o)

**Known minor issues (non-blocking):**
- `whatsapp-business-plugin-v2.json` has a pre-existing JSON syntax error (line 31)
- `ExecutionOutputCache` fails on `sim-exec-001` (not a real UUID) — expected with mock agent
- Token counter concatenates instead of summing (`400[object Object]400`) — display bug in runner
- `runAgentKit` mock didn't load (module path issue) — step14 used real LLM instead of stub
- Scatter-gather steps ran flat (counted as 1 top-level step, not fanning out per item) — `ParallelExecutor` integration needs refinement for Phase C

---

### B10: Config Variable Root Not Supported at Runtime

**Discovered by:** Phase B simulation — `step15` (`send_email`) threw `VariableResolutionError: Unknown variable reference root: config` when resolving `{{config.recipient_email}}`.

**Root cause:** The compiler outputs `{{config.X}}` references for all config values, but the real `ExecutionContext.resolveSimpleVariable()` does not recognize `config` as a variable root.

**Supported variable roots** (from `ExecutionContext.ts` lines 439-534):

| Root | Pattern | Source |
|------|---------|--------|
| `input` / `inputs` | `{{input.X}}` | User input values (from `inputValues` constructor param) |
| `step<N>` | `{{step1.data.field}}` | Step outputs |
| `var` | `{{var.X}}` | Runtime variables via `setVariable()` |
| `current` / `item` | `{{current.X}}` | Loop iteration items |
| `loop` | `{{loop.X}}` | Loop variables |
| ~~`config`~~ | ~~`{{config.X}}`~~ | **NOT SUPPORTED** |

**How production agents handle config today:**
1. Config values are stored in `agent_configurations.input_values` (database)
2. At runtime, `run-agent/route.ts` fetches them and passes as `inputValues` to `ExecutionContext`
3. Steps access them via `{{input.X}}` — not `{{config.X}}`

**The disconnect:** The V6 compiler outputs `{{config.X}}` (an aspirational pattern), but the runtime expects `{{input.X}}` (the existing production pattern).

### Fix Options

| Option | Approach | Scope | Verdict |
|--------|----------|-------|---------|
| **A: Compiler rewrites `{{config.X}}` → `{{input.X}}`** | Add a rewrite step in `toPilotFormat()` — scan all string values in compiled steps and replace `{{config.` with `{{input.`. Aligns with production pattern. No Pilot engine changes. | Small — extends existing `toPilotFormat()` | **Selected** |
| **B: Add `config` root to ExecutionContext** | Register `config` as a new variable root in `resolveSimpleVariable()`. Pass config values separately to ExecutionContext. | Larger — modifies Pilot engine, requires updating WorkflowPilot to pass config | Rejected — unnecessary engine change when Option A achieves the same result |

### Why Option A

1. **Aligns with production** — existing agents use `{{input.X}}`. No new pattern to support.
2. **Contained change** — extends `toPilotFormat()` which we already control. No Pilot engine modifications.
3. **Backward compatible** — if existing agents already use `{{input.X}}`, this just makes V6-compiled agents consistent.
4. **Runtime behavior** — at execution time, `run-agent/route.ts` loads config into `inputValues`, so `{{input.X}}` resolves correctly.

### Implementation

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` — extend `toPilotFormat()`.

Add a `rewriteConfigRefs()` helper that recursively walks all string values in compiled steps and replaces `{{config.` with `{{input.`:

```typescript
// In toPilotFormat(), after action field renames:
converted = this.rewriteConfigRefs(converted)
```

```typescript
private rewriteConfigRefs(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\{\{config\./g, '{{input.')
  }
  if (Array.isArray(obj)) {
    return obj.map(item => this.rewriteConfigRefs(item))
  }
  if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.rewriteConfigRefs(value)
    }
    return result
  }
  return obj
}
```

**Validation:** Re-run Phase B simulator — `{{input.recipient_email}}` should resolve from `inputValues` without error.

| # | Task | Status | Description |
|---|------|--------|-------------|
| B10-1 | Add `rewriteConfigRefs()` to `toPilotFormat()` | ✅ | Replace `{{config.` → `{{input.` in all compiled step values |
| B10-2 | Re-run pipeline | ✅ | Regenerated DSL — all 8 config refs now use `{{input.X}}` |
| B10-3 | Re-run Phase A simulator | ✅ | 13/13 checks pass (VariableStore updated to handle both `config`/`input`/`inputs` roots) |
| B10-4 | Re-run Phase B simulator | ✅ | 8/8 steps pass — `{{input.X}}` resolves through real ExecutionContext |

---

## Phase D — Full WorkflowPilot with Mocked Plugins

> **Prerequisite:** Phase B ✅ complete.
> **Status:** Design complete, implementation pending.

### Goal

Run the compiled DSL through the **real WorkflowPilot** with all 8 execution phases, real DB persistence (execution records, step logs), real WorkflowParser (DAG construction), and real ParallelExecutor — but with **mocked plugin API responses**. This validates the full orchestration lifecycle without needing real OAuth tokens or test data.

### What's New vs Phase B

| Aspect | Phase B | Phase D |
|--------|---------|---------|
| Step orchestration | Custom step walker (~30 lines) | Real WorkflowPilot (8 phases) |
| Step parsing | None — steps fed directly | Real WorkflowParser (DAG, topological sort, parallel detection) |
| State persistence | None | Mock Supabase — StateManager calls succeed silently |
| Scatter-gather | ParallelExecutor returned empty | Real ParallelExecutor with proper data flow |
| Error recovery | None | Real ErrorRecovery (retry policies, circuit breaker) |
| Agent record | Fake in-memory object | In-memory object passed directly to `execute()` |
| Input values | Passed directly to constructor | Passed directly as `inputValues` parameter |
| Database | None | **Mock Supabase** — all DB calls return empty/null, no real connection |
| Plugins | Mocked PluginExecuterV2 | **Still mocked** — stub data from output schemas |
| LLM calls | runAgentKit partially mocked | **Still mocked** — stub AI responses |

### Fully Self-Contained (Zero External Dependencies)

Phase D mocks **everything external** — no DB, no OAuth, no API calls:

1. **No real Supabase** — mock client returns empty results for all queries. StateManager writes succeed silently. PilotConfigService falls back to defaults.
2. **No agent saved to DB** — in-memory agent object passed directly to `WorkflowPilot.execute()`
3. **No input_values in DB** — passed directly as `inputValues` parameter
4. **No OAuth tokens** — mocked PluginExecuterV2 returns stub data
5. **No LLM calls** — mocked runAgentKit returns stub AI responses
6. **Repeatable** — same stub data every run, deterministic results
7. **Safe** — no accidental emails, uploads, or sheet modifications
8. **Fast** — no API/DB latency

### Execution Flow

```
1. Set up mocks (PluginExecuterV2, AuditTrailService, runAgentKit, Supabase)
2. Load compiled DSL (phase4-pilot-dsl-steps.json)
3. Load merged config (phase4-workflow-config.json)
4. Build in-memory agent object with pilot_steps + workflow_steps
5. Create WorkflowPilot(mockSupabase) with options override
6. Call pilot.execute(agent, userId, userInput, workflowConfig)
7. WorkflowPilot runs all 8 phases:
   Phase 0: Config load (falls back to defaults — mock DB returns empty)
   Phase 1: WorkflowParser builds DAG
   Phase 2: Pre-flight validation
   Phase 3: ExecutionContext initialization
   Phase 4: Memory injection (gracefully handles no history)
   Phase 5: Step execution (real routing, mocked plugins)
   Phase 6: State persistence (mock DB — writes silently succeed/fail)
   Phase 7: Error handling
   Phase 8: Summary + cleanup
8. Report results
```

### Script Design

**File:** `scripts/test-workflowpilot-execution.ts`

```
scripts/test-workflowpilot-execution.ts
  1. Load env vars (via env-preload)
  2. Set up mocks (reuse Phase B: mock-plugin-executer, mock-supabase, mock-services)
  3. Load phase4-pilot-dsl-steps.json + phase4-workflow-config.json
  4. Build in-memory agent object (no DB save)
  5. Create WorkflowPilot(mockSupabase) with options
  6. Call pilot.execute(agent, userId, userInput, workflowConfig)
  7. Report: steps completed, failures, execution time
```

Run: `npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts`

### Implementation Tasks

| # | Task | Description |
|---|------|-------------|
| D1 | Create script | `scripts/test-workflowpilot-execution.ts` |
| D2 | Reuse Phase B mocks | Import mock-plugin-executer, mock-supabase, mock-services |
| D3 | In-memory agent | Build agent object with pilot_steps + workflow_steps (no DB) |
| D4 | WorkflowPilot execution | Create `WorkflowPilot(mockSupabase)`, call `execute()` |
| D5 | Report | Console report + JSON report file |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| `loadConfig()` DB query fails | `PilotConfigService` falls back to defaults on error |
| `StateManager` writes fail | Mock Supabase returns `{ data: null, error: null }` — no crash |
| `MemoryInjector` fails on no history | Handles gracefully — proceeds without memory context |
| Mock Supabase doesn't match expected response shape | May need to extend mock for specific query patterns if WorkflowPilot crashes |

### Success Criteria

1. WorkflowPilot completes all 8 phases without unhandled errors
2. WorkflowParser builds correct DAG from compiled DSL
3. Scatter-gather fans out with mocked plugin data (the Phase B gap)
4. Conditional branching executes correct path
5. All `{{input.X}}` references resolve correctly through real ExecutionContext
6. Step emitter fires `onStepStarted` / `onStepCompleted` for each step
7. Execution result returns `success: true` with correct step counts

### Phase D Results

> **Date**: 2026-03-23 (final successful run after O13, D-B2, D-B3 fixes)
> **Status**: ✅ Passed — 8/8 top-level steps, 9 scatter iterations × 6 nested steps, `success: true`. All blockers resolved.

**Full execution summary:**
- WorkflowPilot completed all 8 phases ✅
- WorkflowParser built correct DAG (8 top-level steps including scatter_gather + conditional) ✅
- Pre-flight validation passed ✅
- All `{{input.X}}` references resolved correctly (B10 fix) ✅
- Flatten produced 9 items from 3 emails × 3 attachments (O13 fix: `config.field: "attachments"`) ✅
- Scatter-gather fanned out 9 iterations, each executing 6 nested steps (steps 5-10) ✅
- AI steps (step10 × 9 + step16 × 1) all mocked — zero real OpenAI calls (D-B2 fix) ✅
- Conditional (step12) evaluated `true`, entered `then` branch ✅
- Sheets steps (step13-15) executed inside conditional ✅
- Send email (step17) executed with mocked plugin ✅
- StateManager created execution records ✅
- ExecutionOutputCache cached step outputs ✅
- Step emitter fired for all top-level steps ✅
- Result: `success: true`, `stepsCompleted: 8`, `stepsFailed: 0`, `totalTokens: 20300` (all mock) ✅

**Issue D-B1 ✅ FIXED: Scatter-gather gets 0 items**

Scatter-gather (step4) originally completed with 0 items — nested steps never executed. Root cause: flatten transform produced `custom_code` (natural language) instead of structured extraction config.

**Fix (O13):** Added `deriveFlattenField()` to compiler. Compares upstream schema (`data_schema.slots`) with flatten's `output_schema` to find the nested array field. Emits `config.field: "attachments"`. Runtime's `transformFlatten` already supported `config.field`.

**Result after fix:** Flatten produced 9 items (3 emails × 3 attachments). Scatter-gather fanned out 9 iterations × 4 nested steps = 36 executions. Full data flow working.

**Issue D-B3 ✅ FIXED: Multi-source merge fails inside scatter-gather**

Step 9 (`transform/map`) inside scatter-gather merges 4 variables into one record. Runtime fails: `"Map operation requires array input"` because `extracted_fields` is a single object, not an array.

**Fix (O14):** Compiler detects single-object `map` inside scatter-gather with multiple injected variables and compiles as `operation: "set"` with explicit field mapping. Implemented in `buildMergeFieldMapping()`. Note: on re-run, the LLM chose `ai_processing` for the merge step instead of `map`, so O14 wasn't triggered — but the fix is in place for future runs where the LLM chooses `map`.

---

**Issue D-B2 ✅ FIXED: `runAgentKit` mock didn't load**

The mock patches the module export, but ES module exports are immutable — StepExecutor holds a direct reference from its top-level import. Step14 made a real OpenAI call (1,040 tokens, gpt-4o).

**Fix:** Replaced `patchRunAgentKit()` with `patchStepExecutorLLM()` — patches `StepExecutor.prototype.executeLLMDecision` after import. Works because prototype methods are mutable even on ES module classes. Verified: `🤖 [MOCK] AI step step10: executeLLMDecision → stub output` — 9 iterations + 1 digest step, zero real OpenAI calls.

**File:** `scripts/test-dsl-pilot-simulator/mocks/mock-services.ts`

---

**Issue D-B6 ✅ FIXED: Mock LLM returns object instead of array for classify steps**

**Scenario:** Gmail Urgency Flagging Agent — step2 is `ai_processing` with `ai_type: "classify"`. Input is `inbox_emails.emails` (an array of emails). Step3 is a `transform/filter` that expects `classified_emails` to be an array.

**Root cause:** The mock LLM in `patchStepExecutorLLM()` calls `generateFromSchema(outputSchema)` for all AI steps. The classify step's `output_schema` uses IntentContract format (`{ fields: [...] }`) not JSON Schema (`{ type: "array", items: {...} }`). The stub generator doesn't understand this format, defaults to `type: "object"`, finds no `properties`, and returns `{}` (empty object). Step3's filter then fails with: `"Filter operation requires array input, but received object"`.

**Fix (O28):** Added classify-aware logic to the mock LLM in `mock-services.ts`. When `ai_type === 'classify'`:
1. Resolves the input array from `params.input` or `context.variables` (handling dotted refs like `inbox_emails.emails`)
2. Returns the input array with the classification field appended to each item, alternating between the configured labels
3. Falls through to the generic stub generator for non-classify AI steps

**File:** `scripts/test-dsl-pilot-simulator/mocks/mock-services.ts`

**Result:** Phase D passes — 6/6 steps, 0 failures. Classify mock produces 3 items with `urgency_classification` field, filter correctly selects urgent items, scatter-gather iterates over them.

---

**Issue D-B7 ✅ FIXED: Structured config reference objects not resolved to template strings**

**Scenario:** Gmail Urgency Flagging Agent — step1 `search_emails` has `max_results: { kind: "config", key: "max_emails_to_scan" }` in the compiled DSL. Phase E fails: `"Parameter max_results should be number, got object"`.

**Root cause:** The IR converter sometimes emits structured config reference objects instead of `"{{config.X}}"` template strings. The compiler's Phase 5 `rewriteConfigRefs()` only rewrites string templates, not structured objects.

**Fix (O29):** Added detection of `{ kind: "config", key: "X" }` objects inside `rewriteConfigRefs()`. When found, replaces the entire object with `"{{input.X}}"` template string. Recursive — handles nested objects.

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

---

**Issue D-B8 ✅ FIXED: ai_processing/classify step fails in live execution (two sub-issues)**

**Scenario:** Gmail Urgency Flagging Agent — step2 (`ai_processing/classify`) should classify 50 inbox emails as urgent/not_urgent. Phase D passes (mock handles classify specially via O28), but Phase E fails at step3: `"Filter operation requires array input, but received object"`.

**Sub-issue 1: Bare `input` string not wrapped in `{{ }}`**

Step2's DSL has `input: "inbox_emails.emails"` — a bare string without `{{ }}` wrapping. At runtime:
1. `StepExecutor` line 175 copies `step.input` into `stepParams.input` as-is
2. `resolveAllVariables()` checks for `{{ }}` pattern (line 296), finds none, passes the literal string through
3. The LLM receives `"inbox_emails.emails"` as text, not the actual email array
4. LLM responds: *"I don't yet have the actual inbox_emails.emails payload to process"*

**Why the compiler doesn't catch it:** Phase 4.5 Fix 6 (`wrapBareVariableRefs`) only runs for `type: 'action'` steps. `ai_processing` steps are skipped. The `fixAIStepInputs` (Fix 5) checks for missing prompt variables but does not wrap bare `input` strings.

**Fix (O30):** In the compiler's Phase 5 `toPilotFormat()`, wrap bare `step.input` and `step.config.input` strings in `{{ }}` for `ai_processing` and `llm_decision` step types. Converts `"inbox_emails.emails"` → `"{{inbox_emails.emails}}"`.

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Sub-issue 2 ✅ FIXED: LLM returns text wrapper instead of structured classified array**

The production LLM path returns the response wrapped in `{ result, response, output, generated, quality, tokensGenerated }` — a text alias object from `executeLLMDecision()`. The downstream filter step receives this object instead of a classified email array.

**Fix:** Added `executeClassifyStep()` method to `StepExecutor`. When `ai_type === 'classify'`:
1. Resolves the input array from params or context variables
2. Truncates items to key text fields (subject, snippet, from, etc.) to stay within token limits
3. Builds a classify-specific prompt that includes the data and requests JSON array output with `_index` tracking
4. Parses the LLM response as JSON array
5. Merges classifications back into original input items (preserving all original fields)
6. Returns the classified array directly (no alias wrapper)

Called from `executeLLMDecision()` before the generic LLM path. Falls through to generic path if input can't be resolved as an array.

**File:** `lib/pilot/StepExecutor.ts`

---

**Issue D-B9 ✅ FIXED: Compiler binds modify_email params to wrong schema (send_email template)**

**Scenario:** Gmail Urgency Flagging Agent — step6 (`google-mail/modify_email`) inside scatter-gather should mark each urgent email as important and apply the "AgentsPilot" tracking label. Phase E: step6 fails 15 times with `"message_id is a required parameter"`.

**What the DSL contains:**
```json
{
  "params": {
    "content": {
      "subject": "urgent_email.message_id",
      "body": "mark_important_and_label"
    }
  }
}
```

**What it should contain:**
```json
{
  "params": {
    "message_id": "{{urgent_email.id}}",
    "mark_important": true,
    "add_labels": ["{{input.tracking_label_name}}"]
  }
}
```

**Root cause:** The compiler's CapabilityBinder or IR-to-DSL converter (`ExecutionGraphCompiler.buildParamsFromSchema()`) selected the `send_email` parameter schema (`content.subject`, `content.body`) instead of the `modify_email` schema (`message_id`, `mark_important`, `add_labels`). Both actions belong to the `google-mail` plugin, and the binder appears to have picked the wrong one — likely because `modify_email` is new and the IntentContract or IR may not have generated the correct capability binding for it.

**Cascade effect (3 downstream failures from this one bug):**
1. **Emails not marked important** — `modify_email` never executes successfully (wrong params)
2. **Tracking labels not applied** — same cause
3. **Empty summary email** — scatter-gather collects 15 error objects instead of modified email data → step7 (map) extracts nothing from errors → step8 (LLM) generates an empty HTML table → step9 sends the empty summary

**Investigation needed:**
- Check the IntentContract (`phase1-intent-contract.json`) — does it correctly bind the "mark important + apply label" action to `google-mail/modify_email`?
- Check the IR (`phase3-ir.json` or equivalent) — does the IR converter produce the correct operation and parameter mapping?
- Check `ExecutionGraphCompiler.buildParamsFromSchema()` — does it look up the correct action schema when building params for nested scatter-gather steps?

**Root cause found:** `IntentToIRConverter.convertNotify()` always maps `notify.content` (subject/body — the `send_email` schema) to params. It ignores `notify.options` which contains the correct action-specific params. The IntentContract LLM correctly placed `message_id`, `mark_important`, `add_labels` in `notify.options`, but the converter never reads that field.

**Fix:** Added `isSendAction` check in `convertNotify()`. For `send_email`/`send_message`, behavior unchanged (uses `notify.content` + `notify.recipients`). For all other actions (e.g., `modify_email`), iterates `notify.options` and resolves each value ref as params.

**File:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

**Result after fix:**
```json
step6 params: {
  "message_id": "{{urgent_email.message_id}}",
  "mark_important": true,
  "add_labels": ["{{input.tracking_label_name}}"]
}
```
Phase A: 13/13, Phase D: PASSED.

---

## Phase E — Live Execution with Real Plugins

> **Prerequisite:** Phase D ✅ validates full WorkflowPilot lifecycle.
> **Status:** Design complete, implementation pending.

### Goal

Execute the compiled DSL as a **real agent** with real plugin API calls (Gmail, Drive, Sheets), real LLM calls, and real Supabase persistence. No mocks. This is the final validation that the V6 pipeline produces a production-ready agent.

### Script Design

**File:** `scripts/test-live-agent-execution.ts`

**Input arguments:**
```
npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
  --agent-id <UUID> \
  --dsl <path-to-phase4-pilot-dsl-steps.json> \
  --config <path-to-phase4-workflow-config.json>
```

Defaults:
- `--dsl` → `output/vocabulary-pipeline/phase4-pilot-dsl-steps.json`
- `--config` → `output/vocabulary-pipeline/phase4-workflow-config.json`
- `--agent-id` → required, no default

**Environment:**
- `TEST_USER_ID` from `.env.local` — the user whose plugin connections are used

### Execution Flow

```
1. Parse CLI arguments (agent-id, dsl path, config path)
2. Load DSL + config from files
3. Validate DSL structure (non-empty array, steps have required fields)
4. Connect to real Supabase
5. Validate agent exists in DB (agents table, matching agent-id + user-id)
   → Fail if not found
6. Extract plugin keys from DSL steps
7. Validate plugin connections:
   a. Call PluginManagerV2.getExecutablePlugins(userId)
      (this refreshes expired tokens automatically)
   b. For each plugin in DSL, verify it's in the executable set
   c. Report: ✅ connected / ❌ missing for each plugin
   → Fail if any required plugin is not executable
8. Update agent in DB:
   a. Set pilot_steps = DSL
   b. Set workflow_steps = DSL (backward compat)
   c. Set plugins_required = extracted plugin keys
   d. Set updated_at = now
9. Save input_values to agent_configurations
10. Create real WorkflowPilot(supabase) — NO mocks
11. Call pilot.execute(agent, userId, userInput, inputValues)
    with stepEmitter for live console logging
12. Report results:
    a. Console: step-by-step log with inputs/outputs per step
    b. JSON file: structured execution report with full step data
13. Verify execution record in agent_executions table
```

### Pre-Flight Validation Detail

**Step 3 — DSL validation:**
- File exists and is valid JSON
- Array with at least 1 step
- Each step has `id` or `step_id`, `type`, `name` or `description`
- Action steps have `plugin`, `action`, `params`

**Step 5 — Agent validation:**
```sql
SELECT id, agent_name, status FROM agents
WHERE id = :agent_id AND user_id = :user_id AND status != 'deleted'
```
Fail with clear error if not found.

**Step 7 — Plugin connection validation:**
Uses `PluginManagerV2.getExecutablePlugins(userId)` which:
1. Gets all active connections (including expired)
2. For each: checks if token needs refresh (5-minute buffer)
3. Refreshes expired/near-expiry tokens via `UserPluginConnections.refreshToken()`
4. Returns only plugins with valid, ready-to-use tokens

Report format:
```
🔌 Plugin Connections:
   ✅ google-mail — token valid (expires in 47 min)
   ✅ google-drive — token refreshed
   ✅ google-sheets — token valid (expires in 47 min)
   ✅ document-extractor — system plugin (no token needed)
   ❌ slack — NOT CONNECTED (required by step12)
```

### Output Report

**Console output** — live step-by-step execution with inputs and outputs:
```
▶️  step1 [google-mail/search_emails]:
   Input: { query: "subject:(Invoice OR Bill)...", max_results: 50 }
   ✅ Output: { emails: 3 items, total_found: 3 }
   Duration: 1.2s

▶️  step2 [transform/flatten]:
   Input: matching_emails (object, 5 keys)
   ✅ Output: array[9] (9 attachments extracted)
   Duration: 0.01s
...
```

**JSON report** — `output/vocabulary-pipeline/live-execution-report.json`:
```json
{
  "timestamp": "...",
  "phase": "E",
  "agent_id": "...",
  "execution_id": "...",
  "user_id": "...",
  "summary": {
    "success": true,
    "steps_completed": 8,
    "steps_failed": 0,
    "execution_time_ms": 15000,
    "total_tokens": 1200
  },
  "step_details": [
    {
      "step_id": "step1",
      "type": "action",
      "plugin": "google-mail",
      "action": "search_emails",
      "resolved_input": { "query": "...", "max_results": 50 },
      "output_preview": { "emails": "3 items", "total_found": 3 },
      "output_full": { ... },
      "status": "ok",
      "duration_ms": 1200,
      "tokens_used": 0
    }
  ],
  "plugin_connections": {
    "google-mail": { "status": "valid", "refreshed": false },
    "google-drive": { "status": "valid", "refreshed": true }
  }
}
```

### Implementation Tasks

| # | Task | Description |
|---|------|-------------|
| E1 | CLI argument parsing | Parse `--agent-id`, `--dsl`, `--config` with defaults |
| E2 | DSL validation | Validate structure, required fields per step type |
| E3 | Agent validation | Verify agent exists in DB for given user |
| E4 | Plugin validation + refresh | `getExecutablePlugins()` for all DSL-required plugins, report status |
| E5 | Agent update | Save `pilot_steps` + `workflow_steps` + `plugins_required` to agent |
| E6 | Save input_values | Write config to `agent_configurations` |
| E7 | Execute | `WorkflowPilot.execute()` with real Supabase, stepEmitter for live logging |
| E8 | Step detail capture | Capture resolved inputs + outputs per step for report |
| E9 | Report generation | Console output (live) + JSON file (structured) |
| E10 | DB verification | Check `agent_executions` for completion record |

### Future Enhancement

| # | Description |
|---|-------------|
| F1 | **API-triggered execution** — Instead of calling `WorkflowPilot.execute()` directly, trigger via `POST /api/run-agent { agent_id, execution_type: "test", input_variables }`. Simulates real user trigger through the full API stack (auth, rate limits, audit trail). |
| F3 | **IntentContract: reject `unknown` plugin bindings instead of silently passing them through.** When the LLM cannot map a user-requested action to an available plugin capability, it currently emits `plugin: "unknown", action: "unknown"`. This compiles into the DSL and passes Phase A/D (mocked), but crashes Phase E pre-flight with `"NOT CONNECTED or token refresh failed"` for the non-existent `unknown` plugin. **Problem:** The failure surfaces too late — after compilation, static validation, and mock execution all pass. The user gets a false green signal. **Required mechanism:** (1) The IntentContract generation LLM must be instructed to **never** emit `unknown` as a plugin name. If a requested action cannot be fulfilled by any available plugin, the LLM should instead return a structured `unfulfillable_actions` list alongside the intent contract, describing what's missing and why. (2) The pipeline should detect `unfulfillable_actions` after Phase 1 and surface them to the user as a clear gap report (e.g., "This workflow requires 'mark email as important' but no Gmail action supports this. Add the capability or adjust the workflow."). (3) Phase A should also flag any step with `plugin: "unknown"` as an error (not just a warning). **Benefit:** Catch plugin gaps at intent time, not at live execution time. Users get actionable feedback before any compilation happens. **Requirement doc:** `docs/requirements/gmail-modify-email-action-2026-03-29.md` documents the first instance of this gap (Gmail `modify_email`). |
| F4 | **Email content UX: add greetings and context to generated emails.** Currently, `ai_processing/generate` steps that produce email content (e.g., per-salesperson leads summary) output raw HTML tables with no greeting, introduction, or closing. The recipient gets an email that is just a data table with no "Hi [Name]", no explanation of what the table is, and no sign-off. **Required:** When the pipeline generates email body content, the LLM prompt should instruct the model to wrap the data table in a professional email format: (1) Greeting line using the recipient name if available. (2) One-sentence context line explaining what the table contains and why they're receiving it. (3) The data table. (4) A brief closing/sign-off. This applies to both the user summary email and per-salesperson emails. **Implementation options:** (A) Enhance the IntentContract's `generate` step instructions to always include email formatting guidance. (B) Add a post-processing step in `executeLLMDecision` that wraps bare HTML tables in email chrome when the downstream step is `send_email`. (C) Add email formatting instructions in the compiler when it detects a generate→send_email data flow. **Priority:** Medium — functional but impacts user experience. Observed in the "Leads per-salesperson" and "Gmail Urgency Flagging" scenarios. |
| F5 | ✅ **Phase A: Plugin param schema validation.** Phase A currently checks that variable references resolve and data flows connect, but does NOT validate that action step params match the plugin's JSON schema. When step6 sends `{ content: { subject: "..." } }` to `modify_email` (which requires `message_id`), Phase A passes because it only checks that `{{variables}}` resolve, not that the resolved params match the target action's `parameters.required` list. **Fix:** When Phase A encounters an action step with `plugin` + `action`, load the plugin definition JSON, extract `actions[action].parameters`, and validate: (1) all `required` params are present in the step's params; (2) param types match (string vs array vs boolean). Flag missing required params as **errors** (not warnings). **Impact:** Would have caught D-B9 (wrong param schema) and D-B10 (missing `message_id`) at static validation time instead of Phase E. **Priority:** High — single highest-value improvement. **Files:** `scripts/test-dsl-execution-simulator/index.ts`, plugin definition JSONs (read-only). |
| F6 | ✅ **Phase D: Stricter mock plugin param validation.** The mock plugin executor in Phase D accepts any params and returns stub data. It should validate params against the plugin JSON schema before returning stubs. If `modify_email` receives `{ content: { subject: "..." } }` instead of `{ message_id: "..." }`, Phase D should fail with a clear error. **Fix:** In `mock-plugin-executer.ts`, load the plugin definition for the target action. Before generating stub output, validate that `parameters.required` fields are present in the incoming params. Return a failed result (not throw) with a descriptive error message. **Impact:** Would have caught D-B9 and D-B10 in Phase D instead of Phase E. Complements F5 (Phase A catches at compile time, Phase D catches at runtime with resolved values). **Priority:** High. **Files:** `scripts/test-dsl-pilot-simulator/mocks/mock-plugin-executer.ts`, plugin definition JSONs (read-only). |
| F7 | **Phase D+: Real LLM with mocked plugins.** Add an optional mode to Phase D that uses real LLM calls (OpenAI/Anthropic) but keeps plugins mocked. This catches LLM behavior issues — memory context interference, wrong output format, classification errors — without needing real plugin connections or API credentials. **Implementation:** Add a `--real-llm` flag to `test-workflowpilot-execution.ts`. When set, skip `patchStepExecutorLLM()` but keep `patchPluginExecuter()`. The classify step (O28 mock) would be skipped, letting the real LLM classify. The generate steps would use real LLM with I3 extraction. **Impact:** Would have caught D-B8 sub-issue 2 (LLM returns text wrapper), D-B13 (memory dump in scatter), and the empty email body issue before Phase E. **Cost:** ~5K-15K tokens per run ($0.05-0.15). **Priority:** Medium — high value but has token cost. **Files:** `scripts/test-workflowpilot-execution.ts`, `scripts/test-dsl-pilot-simulator/mocks/mock-services.ts`. |
| F2 | ✅ **Phase A simulator — resolve scatter item schemas.** The A+2 check (`scatter-gather item field validation`) is defined but the implementation doesn't resolve the item schema for nested scatter variables. When the simulator encounters `{{attachment.message_id}}` inside a scatter-gather body, it can't find `attachment` in the variable store (it's a loop iteration variable, not a top-level step output). It emits a warning but can't validate field names. **Result:** false-positive unresolved ref errors in the QA report (e.g., `{{attachment.message_id}}`, `{{attachment.attachment_id}}`, `{{attachment.filename}}`), even when the fields are correct (confirmed by Phase D passing). **Fix:** When the simulator processes a `scatter_gather` step, register the scatter input's `output_schema.items.properties` under the `itemVariable` name in the variable store. This is the same approach used by O25a in the compiler (`resolveFieldMismatch` for dotted input variables). After the fix, `{{attachment.message_id}}` resolves against the Gmail attachment item schema and validates correctly. **Priority:** Medium — Phase D catches real issues, but false positives reduce QA confidence in Phase A results. |
| F8 | **Replace silent `computed` ValueRef fallback with loud failure.** [IntentToIRConverter.ts:1378-1386](lib/agentkit/v6/compiler/IntentToIRConverter.ts#L1378-L1386) — when an unrecognized `computed.op` arrives, the fallback path returns only the first `config` arg and silently discards the rest. This is a canonical P3 (DESIGN_REBASE.md §P3) silent-wrong-output pattern and is exactly how D-B24 (Contract End-Date Summary `"query": "Contracts"` → Drive `Invalid Value`) reached Phase E unnoticed. **Fix options:** (A) Throw with the unknown op and arg list — safest, forces early failure. (B) Add `ctx.errors.push(...)` so the compiler aborts instead of only warning. (C) Return a structured "unresolved computed" marker so downstream consumers can detect and fail loudly. **Recommended:** A. Removing the fallback has a small risk of breaking scenarios that currently rely on the silent behavior — do a grep for all `kind: "computed"` usages in regression scenarios before removing, same audit shape as the D-B14 bailout removal. **Priority:** High — same class as the D-B22/D-B23/D-B24 stubs that masked real errors all day. **Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`. |
| F9 | **Close the open-ended `computed.op` vocabulary in the IntentContract prompt.** [intent-system-prompt-v2.ts:130](lib/agentkit/v6/intent/intent-system-prompt-v2.ts#L130) advertises `{ kind: "computed", op: "concat"\|"format"\|etc, args: ValueRef[] }` to the LLM. The `\|etc` is an open door — the LLM can legitimately emit any op it imagines, and the converter will silently hit the F8 fallback. D-B24 proves this is not a theoretical concern. **Fix options:** (A) Enumerate the full supported op set in the prompt (currently just `concat` and `format` — formally identical semantics, so maybe just call it `concat`). (B) Keep the vocabulary open but ensure the converter handles every op the prompt implies, and reject unknowns loudly (F8). (C) Define an op registry in code that both the prompt generator and the converter read from, so they can never drift apart. **Recommended:** C for long-term, (A) as a tactical fix. **Priority:** Medium — prompt-vs-code drift is a root cause of the D-B24 class of bug. **Files:** `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`, `lib/agentkit/v6/compiler/IntentToIRConverter.ts`. |
| F10 | **Phase A/D: enum conformance validation for plugin parameters.** Currently Phase A's param validator (F5) checks that required params are present and types roughly match, but does NOT validate that values conform to declared `enum` constraints. When a plugin parameter defines `items.enum: ["document","spreadsheet","pdf",...]`, the validator should reject any value outside that set. D-B26 is the motivating case: IC LLM emitted `file_types: ["application/vnd.google-apps.document"]` (raw MIME type), which is not in the enum — passed Phase A silently, then the plugin executor silently dropped the MIME filter. **Fix:** In Phase A's check-14 (plugin param schema validation) and Phase D's mock plugin param validation (F6), when a parameter has `items.enum` (array params) or `enum` (scalar params), validate each compiled value is a member. Flag violations as errors, not warnings. Generic — works for all plugins, not just Drive. **Priority:** High — single check catches an entire class of "LLM emits value outside declared enum" bugs across all plugins and scenarios. Would have caught D-B26 at static validation time. **Files:** `scripts/test-dsl-execution-simulator/validator.ts`, `scripts/test-dsl-pilot-simulator/mocks/mock-plugin-executer.ts`, plugin definition JSONs (read-only). |
| F12 | **Compile deterministic logic to `transform` pipelines instead of `ai_processing/generate`.** When the IntentContract describes a step with deterministic semantics — date arithmetic + range filtering, numeric comparisons, group-by, sort — it currently often compiles to `ai_processing/generate` with a natural-language prompt. The LLM then performs the logic with stochastic accuracy and can produce wrong results even on correct input data (D-B27: contract-enddate-summary step7 excluded a contract that was clearly within the 30-day window). **Required:** (1) Extend the `transform` op vocabulary with `computed_field` (or extend `map` mode 4) to support date-difference expressions and other simple arithmetic. (2) IntentContract or IR converter detects "deterministic-looking" generate steps (compute + filter, compute + sort) and rewrites them as `transform` chains: `transform/map` (add `days_remaining` field) → `transform/filter` (`days_remaining >= 0 AND days_remaining <= 30`) → `transform/sort` (`days_remaining ASC`). (3) Schema-driven detection: when the prompt contains arithmetic verbs ("compute", "calculate", "days between", "subtract") + filter conditions + a structured output_schema with numeric/date fields, prefer the deterministic path. **Impact:** Eliminates an entire class of "the LLM did the math wrong" failures. Reduces LLM token cost for these steps (date arithmetic is free in code, ~hundreds of tokens via LLM). **Risk:** Conservative detection — when in doubt, fall through to `ai_processing/generate` so we don't break expressive prompts. **Priority:** High — affects any scenario with date-based filtering, expiration windows, threshold detection, or numeric comparisons. **Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`, `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`, `lib/pilot/StepExecutor.ts` (transform op handlers). |
| F13 | **Plugin executors: classify HTTP errors into the standard retryable error codes.** WorkflowPilot's default retry policy at runtime declares `retryableErrors: ["TIMEOUT","NETWORK_ERROR","RATE_LIMIT","SERVICE_UNAVAILABLE"]` — but plugin executors throw all HTTP failures as generic `Error("...API error: <status> - <body>")` strings (e.g., `google-sheets-plugin-executor.ts` throws `Error("Sheets API error: 503 - ...")` at HTTP 503, `Error("Sheets API error: 429 - ...")` at rate limit). The retry policy never matches these as retryable, so transient outages cause non-retryable Phase E failures (`Calibration stop: Non-retryable execution error`) when a single retry would have succeeded. **Encountered:** expense-invoice-email-scanner Phase E step10 (`google-sheets/get_or_create_sheet_tab`) failed with `Sheets API error: 503 - "The service is currently unavailable"` — pure Google-side transient outage, no retry attempted, scenario marked failed. **Required:** Each plugin executor (or a shared base class like `GoogleBasePluginExecutor`) should map HTTP response codes to the standard retryable error codes before throwing: HTTP 429 → `RATE_LIMIT` error class, HTTP 503/502/504 → `SERVICE_UNAVAILABLE`, network/socket errors → `NETWORK_ERROR`, AbortError/timeout → `TIMEOUT`. Throw a typed error (e.g., `RetryableHttpError` extending `Error` with `code` field) that the WorkflowPilot retry policy recognizes. **Implementation options:** (A) Centralize in `GoogleBasePluginExecutor` — wrap fetch responses, throw typed errors based on status. Covers all 4 Google plugins (gmail/drive/docs/sheets) in one change. (B) Plugin-by-plugin migration — slower but lower risk. (C) WorkflowPilot retry policy uses regex matching on error messages (e.g. `/^.*: 5\d{2} -/`) — quick & dirty, works without executor changes but fragile. **Recommended:** A. **Priority:** Medium — affects every Phase E run during Google service hiccups. Single change unlocks resilience for all Google plugin scenarios. **Risk:** Existing scenarios that depend on errors being non-retryable (e.g., 4xx auth failures) need explicit non-retryable classification: HTTP 400/401/403/404 → throw as-is (non-retryable); only 429/5xx and network errors map to retryable codes. **Files:** `lib/server/google-base-plugin-executor.ts`, `lib/pilot/types.ts` (RetryableHttpError type), all `lib/server/google-*-plugin-executor.ts` (cleanup if base-class change covers them). |
| F11 | **Plugin enhancement: `.docx` text extraction in `read_file_content`.** Currently `read_file_content` exports text from native Google Workspace files (Docs/Sheets/Slides) via the Drive Export API, and reads plain text files via `alt=media`. For `.docx` (Word), `.xlsx` (Excel), `.pptx` (PowerPoint), `alt=media` returns raw binary (ZIP-compressed XML) which the LLM correctly identifies as unparseable (WP-13 guard working). The contract-enddate-summary scenario's test data is `.docx` files — even with D-B26's MIME filter fix, `.docx` mimeType `application/vnd.openxmlformats-officedocument.wordprocessingml.document` won't match the `application/vnd.google-apps.document` filter, so `.docx` files are correctly excluded. However, for scenarios where users store Word docs in Drive (common in enterprise), supporting `.docx` text extraction would widen the platform's reach. **Implementation options:** (A) Server-side parser library (e.g., `mammoth` npm for .docx → text/HTML). (B) Google Drive conversion API — upload .docx, auto-convert to Google Doc, export as text (two API calls, slower). (C) Separate `document-extractor` plugin route for Office formats. **Recommended:** (A) for .docx specifically, with a `convertToText(mimeType, buffer)` dispatcher in the executor that routes by MIME type. **Priority:** Low — pipeline works correctly with native Google Docs. Enhancement for enterprise Drive folders with mixed Office formats. **Files:** `lib/server/google-drive-plugin-executor.ts`. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-22 | Initial design | Phase A-C strategy, Phase A implementation design |
| 2026-03-22 | Phase A complete | Core simulation passed (28 steps, 0 errors). Switched config input to `phase4-workflow-config.json` (post-O7 merge). |
| 2026-03-22 | A+ design & implementation | Added 7 extended validation checks — all 13/13 checks pass |
| 2026-03-22 | Pre-B analysis | Identified 2 critical + 1 medium DSL-to-Pilot field mismatches (operation→action, config→params, step_id→id+name) |
| 2026-03-22 | Pre-B implemented | Added `toPilotFormat()` Phase 5 pass in compiler. Pipeline re-run + simulator verified: 25 steps, 13/13 checks, 0 errors. |
| 2026-03-22 | Phase B design | Full implementation plan: real StepExecutor + mocked plugins, 9 tasks (B1-B9), risk assessment, file structure |
| 2026-03-22 | Phase B implemented | B1-B9 complete. 8/8 steps executed. Discovered B10: `{{config.X}}` not supported at runtime — ExecutionContext only supports `{{input.X}}`. |
| 2026-03-22 | B10 documented | Config variable root issue documented with Option A fix (compiler rewrites `{{config.` → `{{input.`). |
| 2026-03-22 | B10 implemented | Added `rewriteConfigRefs()` to `toPilotFormat()`. Updated Phase A VariableStore to handle `input`/`inputs` roots. Pipeline re-run confirmed all refs now `{{input.X}}`. Phase B re-run: 8/8 steps pass. |
| 2026-03-22 | Phase D redesigned | Full WorkflowPilot + fully mocked (no DB, no plugins, no LLM). In-memory agent, mock Supabase. Phase E for real plugin execution. 5 tasks (D1-D5). |
| 2026-03-22 | Phase D executed | ✅ 8/8 steps, success: true. D-B1: scatter-gather 0 items (flatten produces unstructured output → O13). D-B2: runAgentKit mock didn't load (ES module immutability). |
| 2026-03-22 | O13 implemented | Added `deriveFlattenField()` to compiler. Flatten now emits `config.field: "attachments"`. Phase D re-run: 9 items flattened, scatter-gather 36 nested executions, full data flow. |
| 2026-03-23 | D-B3 documented | Multi-source merge inside scatter-gather fails — `map` on single object. Fix: O14 (compiler builds explicit field mapping as `set` operation). |
| 2026-03-23 | O14 implemented | Added `buildMergeFieldMapping()` to compiler. Detects multi-source map inside scatter-gather → converts to `set` with field mapping. |
| 2026-03-23 | D-B2 fixed | Replaced `patchRunAgentKit()` with `patchStepExecutorLLM()` — prototype patch works for ES module classes. |
| 2026-03-23 | Phase D final run | ✅ All blockers resolved. 8/8 steps, 9 scatter iterations × 6 nested steps, zero real API calls. Full data flow working. |
| 2026-03-23 | Phase E design | Live execution plan: CLI script with agent-id + DSL + config args. Pre-flight: DSL validation, agent exists, plugin connections + token refresh. Real WorkflowPilot, real plugins. 10 tasks (E1-E10) + F1 future (API trigger). |
| 2026-03-23 | O15 implemented | Compiler `updateVariableReferences()` didn't replace bare strings (no `{{ }}`). At Phase 3.5 time, `step.input` is bare (`raw_leads` not `{{raw_leads}}`). Fix: added exact-match bare string replacement. |
| 2026-03-23 | Phase E first run | Leads workflow: step1 failed — `"Leads Tab"` range with space not quoted. Manual fix to `"Leads"`. |
| 2026-03-23 | Phase E second run | ✅ Steps 1-5 pass with real data. Read 6 rows from Sheets, rows_to_objects produced 5 leads, filter found 3 with Stage=4, count=3, conditional entered `then` branch. **But step6/step7 (AI + send email) never executed.** |
| 2026-03-23 | D-B4 discovered + fixed | **Conditional `then` branch not executing nested steps.** Three layered issues: (1) `WorkflowPilot.executeSingleStep()` handles conditionals directly — evaluates condition then returns without executing nested branch steps. Fix: added branch step iteration after condition evaluation. (2) Nested steps are raw `WorkflowStep` objects but `executeSingleStep()` expects `ExecutionStep` wrapper (`{stepId, stepDefinition, ...}`). Fix: wrap each branch step before calling. (3) Nested steps may have `step_id` but not `id`/`name`. Fix: normalize before execution. `StepExecutor.executeConditional()` also updated with matching field names + comment noting it's only used by test scripts (not production WorkflowPilot path). **Files:** `lib/pilot/WorkflowPilot.ts`, `lib/pilot/StepExecutor.ts`. |
| 2026-03-23 | D-B4 verified + D-B5 root cause found | D-B4 fix confirmed — conditional branch steps now execute. D-B5 actual root cause: test script `test-live-agent-execution.ts` line 328 truncates JSON output then calls `JSON.parse()` on the truncated string. NOT a production StepExecutor issue. Fix: return truncated string as-is, don't re-parse. |
| 2026-03-23 | I3 implemented | **Structured output extraction in StepExecutor.executeLLMDecision().** When step has `output_schema` with properties: (1) appends JSON response instruction to LLM prompt, (2) extracts structured JSON from response via `extractBalancedJSON()` balanced-brace parser, (3) returns parsed fields as step data (e.g., `{subject, body}`) instead of alias wrapper. Enables downstream steps to reference `{{variable.subject}}`, `{{variable.body}}`. Also added `extractBalancedJSON()` to `parseLLMExtractionResponse()` for general safety. Same fix applied in `GenerateHandler` for orchestration path. **Files:** `lib/pilot/StepExecutor.ts`, `lib/orchestration/handlers/GenerateHandler.ts`. |
| 2026-03-23 | **Phase E fully passing** | ✅ **7/7 steps with real data.** Read 6 rows from Google Sheets → rows_to_objects (5 leads) → filter Stage=4 (3 leads) → count (3) → conditional then branch → LLM generates HTML table with `{subject, body}` structured output (I3) → Gmail sends email with HTML table to 3 recipients. 2512 tokens, 45s execution. Full end-to-end from natural language prompt to live agent execution. |
| 2026-03-24 | **Second workflow validated (Customer Complaint Logger)** | ✅ **9/9 steps with real data.** `get_or_create_sheet_tab` (UrgentEmails) → `read_range` (existing rows for dedup) → `rows_to_objects` → `search_emails` (Gmail complaint keywords) → `filter` (unwrap emails) → `filter` (dedup) → scatter-gather (2 complaints) → `set` (prepare row data) → `append_rows` (write to sheet). Three fixes needed: O15 extension (unwrap bare strings), O21 (computed/concat in IR converter), O14 extension (map→set fallback for array outputs). Also: `get_or_create_sheet_tab` executor implemented, `PluginManagerV2.validateRules` null guard added. |
| 2026-03-29 | D-B7 discovered + fixed | **Structured config reference objects not resolved to template strings.** Phase E step1 failed: `"Parameter max_results should be number, got object"`. The DSL contained `max_results: { kind: "config", key: "max_emails_to_scan" }` — a structured config reference object from the IR converter. The compiler's Phase 5 `toPilotFormat()` only rewrites string templates (`{{config.X}}` → `{{input.X}}`), not structured objects. Fix (O29): added `resolveStructuredConfigRefs()` to Phase 5 — recursively walks step params, detects `{ kind: "config", key: "X" }` objects, and replaces them with `"{{input.X}}"` template strings. **File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`. |
| 2026-03-29 | D-B8 discovered + fixed | **ai_processing/classify fails in Phase E (2 sub-issues).** Sub-issue 1 fix (O30): compiler Phase 5 wraps bare `input` strings in `{{ }}` for ai_processing/llm_decision steps. Sub-issue 2 fix: added `executeClassifyStep()` to StepExecutor — builds data-inclusive prompt, requests JSON array, parses and merges classifications back into original items. Phase A: 13/13, Phase D: PASSED. |
| 2026-03-29 | Phase E third run (Gmail Urgency) | **Partial success: 8/8 top-level steps pass, but step6 (modify_email inside scatter-gather) failed 15 times.** Steps 1-4 work correctly: 50 emails searched, LLM classified all 50 (D-B8 fix working), 15 filtered as urgent. Step5 scatter-gather iterated 15 times but step6 failed each time. Steps 7-9 still completed: summary generated and email sent, but summary table was empty. See D-B9. |
| 2026-03-29 | D-B10 discovered + fixed | **Field name mismatch: `message_id` vs `id` in scatter-gather.** IntentContract refs `urgent_email.message_id` but `search_emails` output schema has `id`. Resolved to `undefined` → `modify_email` failed with "message_id is a required parameter". Fix: (1) compiler Phase 5 rewrites `.message_id}}` → `.id}}` in params; (2) executor accepts both `message_id` and `id`. |
| 2026-04-20 | D-B28: D-B19 partial fix — `deliver.mapping` column-header values silently dropped, required `values` array missing | **Phase A `expense-invoice-email-scanner` step14 (`google-sheets/append_rows`) failed validation: `Required parameter "values" missing`.** The IntentContract correctly declared a 7-column mapping for the spreadsheet append: `mapping: [{from:{ref:"sheets_qualifying_rows", field:"type"}, to:"Type"}, {from:..., field:"vendor", to:"Vendor / merchant"}, ...7 columns total]`. Each `to` is a spreadsheet column header (humanized, with spaces and slashes); the `values` array — the actual plugin-required param — is meant to be **composed** from the input array using the mapping. Compiled DSL emitted only `params: {spreadsheet_id, range}` — no `values`. Root cause: `convertDeliver` at [IntentToIRConverter.ts:840-855](lib/agentkit/v6/compiler/IntentToIRConverter.ts#L840-L855) — D-B19 fix unconditionally treats every `mapping[].to` as a top-level plugin parameter name (`genericParams[m.to] = ...`). For COLUMN_HEADER mappings (`Type`, `Vendor / merchant`, etc.), this populates `genericParams["Type"]`, `genericParams["Vendor / merchant"]` which are not in the action's `parameters.properties` — `mapParamsToSchema` silently drops them, no `values` is built. Same class as D-B25/WP-14: a fix that was correct for its narrow trigger case (complaint-email-logger's `to: "spreadsheet_id"/"range"/"values"` style) but didn't generalize. **Audit (10 scenarios):** 3 use PARAM_NAME-only mappings (complaint-email-logger, gmail-urgency-flagging, po-monitor-supplier-confirmation), 1 uses COLUMN_HEADER-only (expense-invoice-email-scanner), 6 have no `deliver.mapping`. No mixed cases today. **Detection criterion (binary, schema-driven):** look up each `mapping[].to` in the bound action's `parameters.properties` — if all match → PARAM_NAME mode (existing D-B19), if none match → COLUMN_HEADER mode (new), if mixed → warn loudly + default to PARAM_NAME for backward compat. **Fix implemented (2026-04-20):** in `convertDeliver`, when COLUMN_HEADER mode is detected, synthesize a precursor `transform/map` node with `field_mapping = {Type: "type", "Vendor / merchant": "vendor", ...}` (header → source field, IC mapping order preserved by JS object insertion). The synthesized node's output (`<step.id>_rows`) is referenced by the deliver step's `params.values = "{{<step.id>_rows}}"`. The runtime's existing `transformMap` Mode 0 (WP-4 field_mapping) projects each input item to a header-keyed object; the `google-sheets/append_rows` executor's existing array-of-objects mode at [google-sheets-plugin-executor.ts:196-200](lib/server/google-sheets-plugin-executor.ts#L196-L200) detects array-of-objects and converts to 2D rows using `Object.keys(values[0])` for column order. End-to-end zero new runtime code — only a compiler-level synthesis that composes existing capabilities. Also: changed `convertDeliver` return type from `string` to `string[]` (matching `convertAggregate` pattern), updated dispatch site at line 284 to pass through the array directly. **Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`. **Cross-refs:** D-B19 (original fix, now Partial), F10 (Phase A enum/required-param validation already caught this — proves F5/F10 value). |
| 2026-04-19 | D-B27: `ai_processing/generate` step7 produces wrong date-filter result (LLM reasoning error) | **Phase E `contract-enddate-summary` final run with native Google Docs as test data — pipeline fully verified, but step7 LLM filtered out a contract that should have been included.** After D-B26 fix + native Google Doc conversion: step1 found `contracts` folder ✅, step2 returned 3 native Google Docs ✅, step3 keyword filter kept all 3 ✅, step4 scatter ran 3 iterations × 2 nested steps ✅, step5 read real text content ✅, step6 (ai_processing/generate, extract-like) extracted 3 valid records: `[{end_date: "2026-04-25", counterparty: "Delta Enterprises"}, {end_date: "2023-12-15", counterparty: "Alpha Tech"}, {end_date: "2026-06-01", counterparty: "Beta Solutions"}]` ✅, gather collected the 3 records cleanly (D-B25 multi-step extract guard working) ✅. **Then step7 (`ai_processing/generate` with prompt: "compute days_remaining = end_date - today, filter to expiring_soon = 0-30 days inclusive") received the 3 records and emitted `{contracts: [], has_expiring: false, total_expiring: 0, total_missing: 0}`.** Today is 2026-04-19. C1004 ends 2026-04-25 = 6 days remaining → should match the 0-30 day window. C1001 (-856 days, past) and C1002 (43 days) correctly excluded. **The LLM made an arithmetic error and excluded C1004.** Not a pipeline bug — input data is correct, prompt is unambiguous, schema validates the output as well-formed. This is the inherent risk of routing deterministic logic (date arithmetic + range filter) through `ai_processing/generate` instead of a deterministic `transform/filter`. **Stochastic — a re-run may produce a different (possibly correct) result.** **Structural follow-up:** F12 — when the IntentContract describes a step as "compute X from Y, filter to range Z" with arithmetic semantics, the IR should compile to a deterministic transform pipeline (computed field + filter operator) rather than handing the whole thing to an LLM. The `transform` op vocabulary already supports `filter` with comparison operators; we'd need to add a `computed_field` or `set` operation that evaluates date-difference expressions deterministically. **Workaround for now:** Re-run Phase E (stochastic LLM may get it right). For production agents using this pattern, prefer explicit transforms over `ai_processing/generate` for date/numeric filters. **Status:** Pipeline verified. LLM-quality issue documented; deterministic-transform fix tracked as F12. |
| 2026-04-14 | D-B26: Plugin `file_types` enum vocabulary mismatch — MIME filter silently dropped | **Phase E `contract-enddate-summary` step2 (`google-drive.list_files`) returned all files in the Contracts folder instead of only Google Docs.** IntentContract correctly emitted `file_types: ["application/vnd.google-apps.document"]` (the raw Drive MIME type). Plugin definition [google-drive-plugin-v2.json:97-113](lib/plugins/definitions/google-drive-plugin-v2.json#L97-L113) declares `file_types` as an enum of **friendly names** (`"document"`, `"spreadsheet"`, `"pdf"`, etc.). Plugin executor's `fileTypesToMimeTypes()` at [google-drive-plugin-executor.ts:835-849](lib/server/google-drive-plugin-executor.ts#L835-L849) maps friendly names to MIME types via a fixed lookup. When it receives the raw MIME string `"application/vnd.google-apps.document"`, it doesn't match any key in `mimeTypeMap`, gets `.filter()`-ed out silently, returns `[]` → the MIME query condition is skipped entirely → Drive query becomes `'{folder_id}' in parents and trashed = false` → **all files returned** including `.docx` Word files. The `.docx` files then passed through step3 AI keyword filter (matched by title), were fetched as binary by step5 (`read_file_content` returns ZIP bytes for non-Google-Workspace files), and step6 LLM correctly reported "binary, could not parse" (WP-13 guard working — no hallucination). Result: email sent with "0 contracts expiring, 4 with missing end dates". **Three-layer permanent fix strategy:** (1) Plugin executor: accept both friendly names AND raw MIME types (additive, not heuristic — Drive API speaks MIME natively). Log a warning when raw MIME is received so upstream fix priority is visible. (2) Phase A/D validator: add enum conformance check (F10). (3) Phase 1 prompt: enforce enum value matching (Direction #1 territory). **Fix implemented (2026-04-14):** extended `fileTypesToMimeTypes()` to recognize raw MIME type strings — if the value is already a valid `application/` MIME type, pass it through directly instead of looking it up in the friendly-name map. Warns when raw MIME is used so the upstream gap (IC LLM emitting raw MIMEs instead of enum values) remains visible. **Additional test data requirement:** the user's Drive `Contracts` folder contains `.docx` Word files (not native Google Docs). Even with the MIME filter working correctly, `mimeType = 'application/vnd.google-apps.document'` won't match `.docx` files. Need to add native Google Docs to the test folder for end-to-end content extraction validation. **Files:** `lib/server/google-drive-plugin-executor.ts`. See F10 (enum validation), F11 (.docx extraction support). |
| 2026-04-14 | D-B25: Scatter-gather multi-nested-step branch bypasses WP-14 `isExtractLike` guard → 1M-token failure | **Phase E step7 crashes with Anthropic 400 `"prompt is too long: 1,004,169 tokens > 1,000,000 maximum"`.** Contract End-Date Summary scenario — after D-B22/D-B23/D-B24 fixes unblocked Phase E past step1, execution reached step4 scatter-gather (over 4 candidate contract docs) and step7 (`ai_processing/generate` to compute days remaining). Each scatter iteration has two nested steps: step5 (`google-drive.read_file_content`, produces `doc_content` with full document text ~165KB) and step6 (`ai_processing/generate`, extract-like 5-field output_schema, produces `extracted_contract_info` ~200B). Scatter `gather: {operation: "collect"}`. WP-14's extract-like guard ([ParallelExecutor.ts:425-437](lib/pilot/ParallelExecutor.ts#L425-L437)) correctly identifies step6 as extract-like and would return only its clean output — **but that check only runs in the single-nested-step branch** (`stepResultKeys.length === 1` at [line 403](lib/pilot/ParallelExecutor.ts#L403)). Two nested steps flow into the **multi-step branch at [line 470](lib/pilot/ParallelExecutor.ts#L470)** which unconditionally spreads `{ ...item, ...step5.output, ...step6.output }` per iteration, preserving `doc_content.content` (~165KB per doc). 4 docs × ~165KB → ~660KB raw → ~1M tokens fed to step7 → Anthropic 400 → non-retryable `Calibration stop`. Total run: 1,014,629 tokens across 135s before failure. Classification: **WP-14 partial fix** — original WP-14 narrative uses singular "the nested step", reflecting the AliExpress single-step scatter body the fix was motivated by. The multi-step case was never in scope. WP-14 is now `⚠️ Partial fix` with a new "Known gap" subsection describing this path. Also confirms the [PD-1 gap](docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md#pd-1-realistic-plugin-mock-payloads-high-value) — Phase D stub payloads (~20 bytes per field) kept this bug invisible in mocks; only realistic Phase E document bodies exposed it. Investigation confirmed not a regression of today's D-B14 fix (which was about `ai_processing` source unwrap in the compiler, different layer). **Fix implemented (2026-04-14):** extended the `isExtractLike` detection to the multi-step branch of `processScatterItem()` at [ParallelExecutor.ts:476-508](lib/pilot/ParallelExecutor.ts#L476-L508). Factored the detection into a local helper `isStepExtractLike(stepId)` shared by both the single-step and multi-step branches. In the multi-step branch, it applies the check to the **last** nested step: if extract-like, the merged result is that step's output only (intermediate steps and original iteration item discarded); otherwise, the existing spread-merge is preserved for multi-classify bodies and other non-extract use cases. For contract-enddate-summary: scatter iteration now yields just step6's ~200B `extracted_contract_info` per doc, so `contract_extraction_results` = 4 × 200B ≈ 800B → step7 receives a ~1KB prompt instead of ~1M tokens. **Stronger long-term fix (deferred as follow-up):** compiler emits explicit `gather.output_source: "<last_step_output_variable>"` as a schema-declared contract; runtime respects it deterministically with heuristic fallback (DESIGN_REBASE §P3 direction). **Files:** `lib/pilot/ParallelExecutor.ts`. See `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` WP-14 "Known gap — multi-nested-step scatter body" for the structural analysis. |
| 2026-04-14 | D-B24: `computed` ValueRef `op: "format"` silently discards literal args | **Phase E step1 `google-drive.search_files` fails with `"Invalid Value"`.** The Contract End-Date Summary IntentContract correctly emits a structured query to build Drive query syntax: `{kind:"computed", op:"format", args:[{kind:"literal", value:"name = '"}, {kind:"config", key:"drive_folder_name"}, {kind:"literal", value:"' and mimeType = 'application/vnd.google-apps.folder'"}]}` — should compile to `"name = 'Contracts' and mimeType = 'application/vnd.google-apps.folder'"`. Compiler output at [phase4-pilot-dsl-steps.json](tests/v6-regression/scenarios/contract-enddate-summary/output/phase4-pilot-dsl-steps.json) showed just `"query": "Contracts"` — both literal args silently dropped. Root cause: [IntentToIRConverter.ts:1366](lib/agentkit/v6/compiler/IntentToIRConverter.ts#L1366) `resolveValueRef` computed handler (marked O21) only recognizes `op === 'concat'`. When `op === 'format'`, it falls through to a "best-effort" fallback that returns only the first `config` arg — silently discarding the two literals. The IntentContract prompt at [intent-system-prompt-v2.ts:130](lib/agentkit/v6/intent/intent-system-prompt-v2.ts#L130) explicitly advertises `op: "concat"\|"format"\|etc` to the LLM, so the LLM is correctly emitting a documented op that the converter doesn't actually handle — prompt-vs-converter mismatch, not an LLM bug. This class of silent data corruption is a canonical P3 heuristic-soup failure (DESIGN_REBASE.md §P3) — downstream producing wrong output with no visible error. The `\|etc` in the prompt is also concerning: it implies other unrecognized ops would hit the same fallback. Fix: added `format` as an alias for `concat` in the computed handler — they have identical semantics (sequential arg join, no positional specifiers). Left the existing silent fallback alone for this pass to limit blast radius; follow-up should either remove the fallback or make it fail loud. **Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`. Note: does NOT invalidate the D-B22/D-B23 Phase E run that surfaced this — those fixes were still required to unmask the actual error. |
| 2026-04-14 | D-B23: `CheckpointManager` stub missing runtime methods | **Phase E crashes in WorkflowPilot failure cleanup with `TypeError: failCpManager.clear is not a function`.** Same class as D-B22 (stub completeness gap), different stub. `lib/pilot/shadow/CheckpointManager.ts` is a `TODO` stub that only implements `createCheckpoint`/`restoreCheckpoint`/`listCheckpoints` (none of which are called), but `WorkflowPilot.ts` actually calls three **other** methods at runtime via `(this as any)._checkpointManager` escape hatches that bypass type-checking: `clear()` ([line 781](lib/pilot/WorkflowPilot.ts#L781), failure cleanup), `createStepCheckpoint(context, stepId)` ([line 1380](lib/pilot/WorkflowPilot.ts#L1380), on each successful step — also called by [ResumeOrchestrator.ts:149](lib/pilot/shadow/ResumeOrchestrator.ts#L149)), and `createBatchCheckpoint(context, batchStepIds)` ([line 1688](lib/pilot/WorkflowPilot.ts#L1688), each batch completion). Why Phase D didn't hit this: Phase D's ShadowAgent init failed non-blockingly → `_checkpointManager = null` → every call site guarded by `if (checkpointManager)` skipped. Phase E has a real Supabase DB so ShadowAgent initialized successfully → `_checkpointManager` became a real stub instance → the first failure detonated `clear()`. The secondary TypeError overwrote the real root cause in the Phase E report (`error: "failCpManager.clear is not a function"` masked the actual `google-drive.search_files` `"Invalid Value"` failure from step1). Also: constructor is called as `new CheckpointManager(executionId)` but the stub had no explicit constructor — JS silently ignored the arg. Fix: added explicit constructor `(executionId?: string)`, plus no-op `clear()`, `createStepCheckpoint(_context, _stepId)`, `createBatchCheckpoint(_context, _batchStepIds)`. All safe — checkpoint storage is for resume flows, which aren't needed for Phase E validation; the calling code already guards on null and handles failures as non-critical. Not a pipeline/compiler issue — pure stub-completeness gap. **Files:** `lib/pilot/shadow/CheckpointManager.ts`. |
| 2026-04-14 | D-B22: `ExecutionOutputCache` stub missing runtime methods | **Phase D process crashes with `TypeError` after all steps complete.** `WorkflowPilot.ts:533` calls `executionOutputCache.clearExecution(executionId)` during post-execution cleanup (marked "non-critical" in the surrounding code), but `lib/pilot/ExecutionOutputCache.ts` is a `TODO` stub that never implemented `clearExecution`. The synchronous `TypeError` inside a dynamic-import `.then()` callback becomes an unhandled promise rejection → Node 22 kills the process before the Phase D report can be written, leaving stale logs on disk. Why not caught earlier: dynamic imports defer module resolution to runtime so TypeScript didn't type-check the property access; the Apr 12 stub-patch commit (`2f8d982`) only added methods flagged by static-import call sites (`setStepOutput`, named singleton export); earlier Phase D runs were short-circuited by the D-B14 scatter crash at step4, never reaching the line 533 cleanup path. Audit of all 4 runtime call sites revealed a second latent bomb: `StateManager.ts:803` calls `getAllOutputs(executionId)` — also missing. Only fires on resume flows (gated by `!isFreshRestart && completedSteps.length > 0`), which is why Phase D hasn't hit it yet, but Phase E resumes would crash. Fix: added no-op async `clearExecution(_executionId): Promise<void>` (clears in-memory cache) and `getAllOutputs(_executionId): Promise<Map<string, {data, metadata}>>` (returns empty Map so StateManager's `cachedOutputs.size > 0` check short-circuits into its cache-miss branch). Both safe — cache is in-memory per-process and both call sites already handle empty/failure cases. Not a pipeline/compiler issue — pure stub-completeness gap. **Files:** `lib/pilot/ExecutionOutputCache.ts`. |
| 2026-04-14 | D-B14 regression fixed | **`unwrapObjectToArray` bailout for `ai_processing` sources removed.** Contract End-Date Summary Phase D failed at `step4` with `INVALID_SCATTER_INPUT` — scatter input `{{candidate_docs}}` resolved to `{filtered_docs: []}` instead of an array. `step3` is an `ai_processing/generate` with `output_schema: {type:"object", properties:{filtered_docs: array}}` — the exact D-B14 trigger shape. Root cause: [ExecutionGraphCompiler.ts:2803-2805](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L2803-L2805) had an early-return that skipped `ai_processing` upstream steps with the rationale *"AI processing output shape is determined by callLLMDirect at runtime, not by bound plugin schema"*. This contradicted the D-B14 changelog claim that the fix covers `action/ai_processing` sources, and is now incorrect: post-Direction #2, `AIOutputValidator` + I3 extraction contractually force `ai_processing` outputs to match the declared `output_schema` (hard-fail via `SchemaViolationError` on mismatch). The compile-time unwrap is safe. Fix: removed the three-line bailout so `ai_processing` sources fall through to the generic schema-based unwrap. Audited all 9 other scenarios beforehand — none depend on the bailout (no scatter/transform consumes a bare `{{var}}` whose source is an `ai_processing` step with single-array-field object schema). **Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`. |
| 2026-03-29 | D-B13 discovered + fixed | **ai_processing/generate inside scatter-gather returns memory dump instead of content.** Three-layer fix: (1) Skip orchestration for `ai_processing/generate` — orchestrator misclassified as `extract` intent, routed to `ExtractHandler` with wrong prompt. (2) `_skipMemory` flag — `runAgentKit` skips memory injection for `ai_processing` steps. (3) System prompt override — step prompt replaces full agent prompt. Safety net: I3 detects memory dump objects. Phase E: 3/3 per-salesperson HTML emails generated correctly. |
| 2026-03-29 | F6 implemented | **Phase D: mock plugin param validation.** `mockPluginExecute()` now loads plugin definitions, validates required params present before returning stubs. Returns `{ success: false }` with descriptive error on missing required params. Complements F5 — Phase A catches at compile time, Phase D catches with resolved runtime values. |
| 2026-04-10 | D-B21: Plugin executor `ReferenceError: error is not defined` | Pre-existing bug in plugin executors. `catch` blocks reference undefined `error` variable (likely should be `err` or the caught parameter). Affects: `google-drive-plugin-executor.ts` (`search_files` confirmed — `error is not defined` crashes the action), `google-docs-plugin-executor.ts` (lines 72, 347 — same pattern). Step1 of contract-enddate-summary fails at runtime with `"google-drive search_files failed: error is not defined"`. The actual Drive API error is swallowed. Not a pipeline/compiler issue — pure plugin executor code bug. Fix: audit all plugin executors for `catch` blocks that reference `error` instead of the caught variable. **✅ Resolved (verified 2026-04-14):** Both files audited — all `catch` blocks in `google-drive-plugin-executor.ts` (lines 395, 639, 966, 1023) properly declare the caught variable; `searchFiles()` throws via the captured `errorData` at line 169 (not `error`). `google-docs-plugin-executor.ts` lines 72 and 347 also use `errorData`. Empirically confirmed by Phase E run today: step1 `google-drive.search_files` surfaced the real Drive API error `"Invalid Value"` cleanly (no `"error is not defined"` masking). The underlying D-B24 query-composition bug was then diagnosable because this error was no longer swallowed. |
| 2026-04-10 | Phase A gap: array index syntax | Phase A simulator and cross-step field validator don't support `[0]` array index access in variable references (e.g., `{{results.files[0].id}}`). Reports false-positive unresolved_ref and cross_step_field_ref errors. Scenario: contract-enddate-summary. The reference is correct — runtime resolveAllVariables handles it. Phase A limitation only. |
| 2026-04-10 | Phase D gap: mock LLM vs ai_processing output shape | Phase D mock (`patchStepExecutorLLM`) returns `generateFromSchema(outputSchema)` which produces an object for `type:"object"` schemas. When an `ai_processing` step is expected to return an array (e.g., filtering docs → array of candidates), the mock returns an object → downstream scatter-gather fails. Same class as D-B6 (classify mock). Needs mock-level awareness of AI step semantics. Scenario: contract-enddate-summary step3→step4. |
| 2026-04-09 | D-B20 root cause found + partial fix | **`notify` steps unbound due to Phase 2b input-type validation.** Gmail Urgency Flagging scenario: `notify` step binds correctly to `google-mail/send_email` (exact_match), but `validateInputTypeCompatibility` (Phase 2b) rejects the binding because notify steps have structured `notify.content`/`notify.recipients` inputs that don't match the `InputTypeChecker`'s expected input-type format. All candidates rejected → step marked `unbound` → compiles as `unknown`. **Partial fix applied:** Skip Phase 2b validation for `notify` kind steps (`step.kind !== 'notify'`). **Future fix (D-B20):** Also consider using `getAvailablePlugins()` instead of `getExecutablePlugins()` for binding — decouples binding from OAuth status. **Files:** `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts`. |
| 2026-04-09 | D-B19 discovered + fixed | **`deliver.mapping` nests params in `fields` instead of top-level.** Complaint-email-logger scenario: IC used `deliver.mapping: [{from: {kind:"config", key:"spreadsheet_id"}, to: "spreadsheet_id"}, ...]` — a new IC format. `convertDeliver()` put all mappings into `genericParams.fields = {...}` (nested object). `mapParamsToSchema` then copied `fields` as-is, never hoisting `spreadsheet_id`/`range`/`values` to top-level params. Result: `append_rows` got `spreadsheet_id` → wrong data (resolved to step6 output via `genericParams.data` fallback), `values` → bare string (no `{{ }}`). Root cause: `mapping[].to` values are top-level param names, not nested field names. Fix: resolve each mapping entry directly to `genericParams[m.to]` instead of nesting in `fields`. Also use `resolveValueRef` for all `from` types to get proper template wrapping. |
| 2026-04-09 | D-B18b: `custom` and `dedupe` transform ops | **Audit of transform ops in IC prompt vs runtime.** `custom` removed from prompt — same WP-4 pattern as `select` (LLM emits prose `custom_code` that runtime can't execute). `dedupe` kept in prompt with new runtime handler added (filter for uniqueness by field or full-object hash). Compiler alias added for `custom` → `map` (safety net for old ICs). |
| 2026-04-09 | D-B18 discovered + fixed | **`select` transform not supported at runtime — removed from IntentContract schema.** Complaint-email-logger scenario: LLM generated `transform/select` with `custom_code: "Select the fifth column..."`. Runtime doesn't implement `select` → `Unknown transform operation`. Root cause: `select` is a redundant op — it's just `map` that keeps fewer fields. WP-4 already solved this with structured `mapping: [{to, from}]`. Fix: removed `select` from valid transform ops in IntentContract prompt. LLM now uses `map` with structured mapping instead. Zero runtime changes — aligns with existing WP-4 infrastructure. |
| 2026-04-08 | D-B17 documented (partial fix) | **ai_processing steps ignore orchestration routing decision.** Orchestration initializes and routes ALL steps (IntentClassifier + RoutingService — costs tokens), selecting e.g. `gpt-5.2` for balanced tier. But `callLLMDirect` (WP-3) skips orchestration at execution time. Partial fix: changed `callLLMDirect` default from `gpt-4o` to `gpt-5.4-mini`, added `getMaxOutputTokens()` for model-appropriate token limits. Full fix deferred: `callLLMDirect` should read the routing decision from orchestrator metadata, or orchestration should skip classifying/routing `ai_processing` steps. |
| 2026-04-03 | D-B16 discovered + fixed | **Loop.over as ValueRef object crashes compiler.** `convertLoop()` called `resolveRefName()` on `step.loop.over` which was `{kind:"config", key:"summary_recipients"}` (object, not string). Downstream `.split()` call crashed. Fix: check type, resolve ValueRef via `resolveValueRef()` when it's an object. Also added guard in compiler validation (line 6789) to skip non-string `iterate_over`. Scenario: po-monitor-supplier-confirmation. |
| 2026-04-03 | D-B15 discovered + fixed | **Scatter-gather gather removed when no output_variable.** `fixScatterGatherOutput()` removed the `gather` object entirely when `operation=flatten` and no `output_variable`. This broke the scatter-gather at runtime (`missing gather.operation`). Fix: default to `{operation: "collect"}` instead of removing gather. Scenario: orders-po-extractor-xlsx. |
| 2026-04-03 | D-B14 discovered + fixed | **Object-to-array input unwrap for scatter and transform steps.** Contract End-Date Summary scenario: (1) scatter input `{{candidate_docs}}` got object `{files:[...]}` from `search_files` — needed `{{candidate_docs.files}}`. (2) filter input `{{contracts_with_days}}` got object `{contracts_array:[...]}` from `ai_processing` — needed `{{contracts_with_days.contracts_array}}`. Fix: compiler Phase 5 auto-unwraps object-to-array references for scatter and transform inputs when source step (action/ai_processing) has output_schema type:"object" with a single array field. Skips transform sources (they already produce arrays). Also: `field_mapping` Mode 0 now handles single object input inside scatter-gather. |
| 2026-03-29 | F5 implemented | **Phase A: plugin param schema validation (check 14).** New A+8 check loads plugin definition JSONs, validates required params present and no unknown params for every action step. Would have caught D-B9 (missing `message_id`, unknown `content`) and D-B10 at static validation time. Phase A now runs 14/14 checks. |
| 2026-03-29 | D-B12 discovered + fixed | **Group transform: wrong key + wrong return type.** (1) `config.rules.group_by` not checked — `groupKey` was undefined, produced `[object Object]` keys. Fix: check `config.rules.group_by` and `config.group_by`. (2) Returns `{grouped, groups, keys, count}` object but scatter-gather needs array. Fix: when `output_schema` defines a typed array, map `{key, items}` to schema field names (e.g., `{salesperson, leads}`) and return array directly. |
| 2026-03-29 | D-B11 discovered + fixed | **Two Phase E cosmetic issues.** (1) Email subject garbled: em-dash `—` encoded as `Ã¢Â€Â"` — `buildEmailMessage()` didn't MIME-encode non-ASCII subject chars. Fix: detect non-ASCII, encode as `=?UTF-8?B?...?=`. (2) Summary table empty: step7 `transform/map` with `custom_code` (natural language) doesn't execute at runtime. Fix: added Mode 4 to `transformMap()` — when `custom_code` + `output_schema` present, auto-maps fields by name matching with known aliases (e.g., `from`→`sender`, `date`→`received_date`). |
| 2026-03-29 | D-B10b discovered + fixed | **Label 409 conflict: "Label name exists or conflicts".** `createLabel()` threw on 409 when label "AgentsPilot" already existed but wasn't found in initial GET /labels (possible nested label naming or timing). Fix: handle 409 by re-fetching labels and resolving the existing label ID. Also added debug logging for label resolution diagnostics. |
| 2026-03-29 | D-B9 discovered + fixed | **Compiler binds modify_email params to send_email schema.** `IntentToIRConverter.convertNotify()` always used `notify.content` (send_email schema), ignoring `notify.options` (action-specific params). Fix: added `isSendAction` check — non-send actions use `notify.options` as params. Step6 now correctly gets `message_id`, `mark_important`, `add_labels`. |
| 2026-03-29 | Phase E blocked — unknown plugin gap | **Gmail Urgency Flagging Agent:** Phase A (13/13) and Phase D (6/6) passed, but Phase E pre-flight failed — steps 5 & 6 compiled as `plugin: "unknown"` (mark important + apply label). Gmail plugin lacks `modify_email` action. Requirement created: `docs/requirements/gmail-modify-email-action-2026-03-29.md`. Added F3 future item: IntentContract LLM must reject unknown plugins and surface unfulfillable actions. |
| 2026-03-27 | D-B6 discovered + fixed | **Mock LLM returns object instead of array for classify steps.** Gmail Urgency Flagging scenario: step2 (`ai_processing/classify`) output was `{}` instead of array — step3 filter crashed. Fix (O28): classify-aware mock resolves input array, appends classification field to each item. Phase D: 6/6 steps pass. |
| 2026-03-23 | D-B5 discovered | **GenerateHandler LLM response JSON parse failure on HTML content.** Step6 (ai_processing/generate) asks LLM to produce `{subject, body}` where `body` is HTML. `StepExecutor.extractStructuredOutput()` uses greedy regex `/\{[\s\S]*\}/` (line ~4394) to extract JSON from LLM text. When HTML body contains `{` or `}` chars (CSS styles, template syntax), the regex captures an invalid JSON string. Error: `Expected ',' or '}' after property value in JSON at position 2004`. **Suggested fix (two options):** **(A) Request structured output from LLM** — Use OpenAI's `response_format: { type: "json_object" }` or `tool_use` to force valid JSON responses. This is the I3 item (GenerateHandler structured output) already documented in the parent workplan. Most reliable fix. **(B) Smarter JSON extraction** — Replace greedy regex with a balanced-brace parser that counts `{`/`}` nesting depth, only matching the outermost valid JSON object. Falls back to regex-based field extraction on parse failure. Less reliable than A but works without LLM API changes. **Recommended: Option A** (I3) — it eliminates the problem at source. Option B is a safety net. |
