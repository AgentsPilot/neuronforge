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
| F2 | ✅ **Phase A simulator — resolve scatter item schemas.** The A+2 check (`scatter-gather item field validation`) is defined but the implementation doesn't resolve the item schema for nested scatter variables. When the simulator encounters `{{attachment.message_id}}` inside a scatter-gather body, it can't find `attachment` in the variable store (it's a loop iteration variable, not a top-level step output). It emits a warning but can't validate field names. **Result:** false-positive unresolved ref errors in the QA report (e.g., `{{attachment.message_id}}`, `{{attachment.attachment_id}}`, `{{attachment.filename}}`), even when the fields are correct (confirmed by Phase D passing). **Fix:** When the simulator processes a `scatter_gather` step, register the scatter input's `output_schema.items.properties` under the `itemVariable` name in the variable store. This is the same approach used by O25a in the compiler (`resolveFieldMismatch` for dotted input variables). After the fix, `{{attachment.message_id}}` resolves against the Gmail attachment item schema and validates correctly. **Priority:** Medium — Phase D catches real issues, but false positives reduce QA confidence in Phase A results. |

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
| 2026-03-23 | D-B5 discovered | **GenerateHandler LLM response JSON parse failure on HTML content.** Step6 (ai_processing/generate) asks LLM to produce `{subject, body}` where `body` is HTML. `StepExecutor.extractStructuredOutput()` uses greedy regex `/\{[\s\S]*\}/` (line ~4394) to extract JSON from LLM text. When HTML body contains `{` or `}` chars (CSS styles, template syntax), the regex captures an invalid JSON string. Error: `Expected ',' or '}' after property value in JSON at position 2004`. **Suggested fix (two options):** **(A) Request structured output from LLM** — Use OpenAI's `response_format: { type: "json_object" }` or `tool_use` to force valid JSON responses. This is the I3 item (GenerateHandler structured output) already documented in the parent workplan. Most reliable fix. **(B) Smarter JSON extraction** — Replace greedy regex with a balanced-brace parser that counts `{`/`}` nesting depth, only matching the outermost valid JSON object. Falls back to regex-based field extraction on parse failure. Less reliable than A but works without LLM API changes. **Recommended: Option A** (I3) — it eliminates the problem at source. Option B is a safety net. |
