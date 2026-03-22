# V6 Workflow Data Schema — Execution Simulator Workplan

> **Status**: Phase A — ✅ Core simulation passed (28 steps, 0 errors). Extending scope with A+.
> **Date**: 2026-03-22
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

## Phase B — Design Notes (Future)

Replace DSLSimulator's custom execution with real Pilot components:

- `VariableStore` → `ExecutionContext` (real variable resolution)
- `DSLSimulator.executeAction()` → `StepExecutor.execute()` with mocked `PluginExecuterV2`
- `DSLSimulator.executeTransform()` → `StepExecutor.execute()` (real transform logic)
- `DSLSimulator.executeConditional()` → `ConditionalEvaluator` (real evaluation)

Keep: `StubDataGenerator`, `Validator`, `ReportGenerator` — these are reused.
Add: Supabase mock, StateManager mock, PluginExecuterV2 mock injection.

---

## Phase C — Design Notes (Future)

Full `WorkflowPilot.execute()` with:
- Mock Supabase client (in-memory state)
- Mock PluginExecuterV2 (stub data from output_schema)
- Real WorkflowParser, StepExecutor, ExecutionContext, ParallelExecutor, ConditionalEvaluator
- Validates the complete 8-phase lifecycle

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-22 | Initial design | Phase A-C strategy, Phase A implementation design |
| 2026-03-22 | Phase A complete | Core simulation passed (28 steps, 0 errors). Switched config input to `phase4-workflow-config.json` (post-O7 merge). |
| 2026-03-22 | A+ design | Added 7 extended validation checks (cross-step field tracing, scatter item validation, conditional field check, config type check, schema completeness, duplicate output vars, DAG visualization) |
