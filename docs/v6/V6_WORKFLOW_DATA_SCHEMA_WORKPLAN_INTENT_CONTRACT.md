# V6 Workflow Data Schema — Intent Contract Pipeline Workplan

> **Status**: Planning
> **Date**: 2026-03-08
> **Branch**: `feature/v6-Intent-Contract`
> **Design doc**: [V6_WORKFLOW_DATA_SCHEMA_DESIGN.md](./V6_WORKFLOW_DATA_SCHEMA_DESIGN.md)
> **Related workplan**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md) (Architecture A — LLM→IR direct)

---

## Context

The `feature/v6-Intent-Contract` branch uses **Architecture B** — a 4-phase pipeline where only Phase 1 uses the LLM:

```
Phase 1: IntentContract Generation (LLM)     → plugin-agnostic plan
Phase 2: Capability Binding (Deterministic)   → maps domains/capabilities to plugin actions
Phase 3: Intent → IR Conversion (Deterministic) → converts BoundIntentContract to ExecutionGraph IR v4
Phase 4: IR → PILOT DSL Compilation (Deterministic) → compiles IR to executable workflow steps
```

The **data flow between steps is the weakest point**: steps produce named outputs (`RefName`) consumed by other steps, but there's no type contract on the data shape. This causes silent mismatches where a step references `{{raw_leads.values}}` but nobody verifies that `raw_leads` actually has a `values` field.

### Key Architectural Decisions

**1. Plugin-bound steps: LLM does NOT declare field-level schemas.** Phase 1's job is deciding *what* to do (which capabilities, in what order). For plugin-bound steps, field-level schemas come from plugin definitions — the highest-trust source.

**2. Unstructured steps: LLM MUST declare output schema.** For steps that don't bind to a plugin (shape-changing transforms like `map`/`group`/`merge`), only the LLM knows the intended output shape. The Phase 1 prompt requires `transform.output_schema` for these operations. Without it, the deterministic phases cannot know what the step produces and the pipeline flags a warning.

**3. `data_schema` is constructed deterministically in Phase 2** after binding succeeds, combining:
- Plugin `output_schema` for bound steps (source: `plugin`)
- LLM-declared `output_schema` for shape-changing transforms (source: `ai_declared`)
- LLM-declared `fields[]`/`outputs[]` for extract/generate steps (source: `ai_declared`)
- Derived schemas for shape-preserving transforms, loops, aggregates (source: `inferred`)

This gives us:
- Minimal prompt change (one additional rule for shape-changing transforms)
- Schemas from the highest-trust source available per step kind
- No `type: "any"` slots — every slot has a concrete schema or the pipeline flags a generation issue

### Schema Sources Available

Plugin definitions already contain full typed `output_schema` with nested properties:

```json
// google-sheets read_range output_schema
{
  "type": "object",
  "properties": {
    "range": { "type": "string" },
    "values": { "type": "array", "items": { "type": "array", "items": { "type": "string" } } },
    "row_count": { "type": "integer" },
    "column_count": { "type": "integer" }
  },
  "required": ["range", "values", "row_count"]
}
```

Plugin `parameters` (input schema) is equally rich — enabling cross-step validation (producer output matches consumer input).

---

## Implementation Phases

```
Phase 0: Phase 1 Prompt Update (LLM output_schema rule) ← no dependencies
Phase 1: Type Foundation + IntentContract Integration    ← no dependencies (parallel with Phase 0)
Phase 2: data_schema Construction (DataSchemaBuilder)    ← depends on Phase 1
Phase 3: Schema-Aware IR Conversion                      ← depends on Phase 2
Phase 4: Compiler Schema Validation (port from Arch A)   ← depends on Phase 3
Phase 5: Runtime Integration                             ← depends on Phase 4
Phase 6: Test Script & Validation                        ← depends on Phase 2+ (incremental)
```

### Implementation Order

Execute in this order. Mark each task as done before moving to the next.

```
Step 1: Phase 1 (types)          → foundation everything depends on
Step 2: Phase 0 (prompt)         → can validate later, but get the prompt rule in early
Step 3: Phase 2 (DataSchemaBuilder) → core new logic, biggest effort
Step 4: Phase 6.1 + 6.2          → validate Phase 2 output visually before continuing
Step 5: Phase 3 (IR conversion)  → carry + validate schema through IR
Step 6: Phase 6.3               → validate Phase 3 output
Step 7: Phase 4 (compiler)       → port schema validation from Arch A
Step 8: Phase 5 (runtime)        → connect to execution engine
Step 9: Phase 6.4               → final validation summary
```

Key principle: **validate each phase's output before building on top of it.** Phase 6 tasks are interleaved to catch issues early.

---

## Phase 0: Phase 1 Prompt Update (LLM output_schema Rule)

**Goal:** Update the IntentContract generation prompt so the LLM declares `output_schema` on shape-changing transform steps. This is the only Phase 1 (LLM) change needed.

**Why:** Shape-changing transforms (`map`, `group`, `merge`, `reduce`, `select`) are unstructured operations — only the LLM knows the intended output shape. Without `output_schema`, the deterministic phases cannot build a concrete slot schema, and we'd fall back to `type: "any"` which defeats the purpose.

**What stays the same:** Plugin-bound steps (`data_source`, `artifact`, `deliver`, `notify`) get their schemas from plugin definitions in Phase 2. No LLM involvement needed for those.

| # | Task | File | Status |
|---|------|------|--------|
| 0.1 | Add prompt rule: "For shape-changing transforms (`map`, `group`, `merge`, `reduce`, `select`), you MUST include `transform.output_schema` describing the output structure with field names and types." Include one example showing correct usage. | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | Not started |
| 0.2 | Add prompt clarification: "Shape-preserving transforms (`filter`, `sort`, `dedupe`, `flatten`) do NOT need `output_schema` — the output has the same shape as the input." | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | Not started |
| 0.3 | Add prompt guidance: "If you need AI to reshape data (complex restructuring, conditional field mapping), use `extract` or `generate` instead of `transform` — those step kinds require explicit field declarations (`fields[]` / `outputs[]`) which serve the same purpose." | `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | Not started |

**Testing:**
- Manual test: run `test-complete-pipeline-with-vocabulary.ts` with a prompt that requires a `map` transform → verify LLM produces `output_schema`
- Manual test: run with a `filter` transform → verify LLM does NOT add unnecessary `output_schema`

---

## Phase 1: Type Foundation + IntentContract Integration

**Goal:** Create the `WorkflowDataSchema` types (if not already on this branch) and integrate them into the `BoundIntentContract` type so Phase 2 can produce them.

| # | Task | File | Status |
|---|------|------|--------|
| 1.1 | Create `SchemaField`, `DataSlot`, `WorkflowDataSchema` types (or port from Architecture A branch) | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` (new) | Not started |
| 1.2 | Add `data_schema?: WorkflowDataSchema` to `BoundIntentContract` type | `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts` | Not started |
| 1.3 | Add `data_schema?: WorkflowDataSchema` to `ExecutionGraph` IR type (if not already present on this branch) | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |
| 1.4 | Add utility: `convertActionOutputSchemaToSchemaField()` — converts plugin JSON Schema (`ActionOutputSchema`) to `SchemaField` format | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` | Not started |
| 1.5 | Add utility: `convertActionInputSchemaToSchemaField()` — converts plugin `parameters` JSON Schema to `SchemaField` format (for consumer-side validation) | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` | Not started |

**Testing:**
- TypeScript compiles with no errors
- Unit test: `convertActionOutputSchemaToSchemaField()` with a real plugin `output_schema` (e.g., `read_range`) produces correct `SchemaField` tree
- Unit test: nested properties, arrays with items, required fields all convert correctly

---

## Phase 2: data_schema Construction (DataSchemaBuilder)

**Goal:** After binding succeeds, build a complete `data_schema` from bound plugin output schemas + step structure. This is the core new logic, implemented as a separate `DataSchemaBuilder` class to keep `CapabilityBinderV2` focused on binding.

| # | Task | File | Status |
|---|------|------|--------|
| 2.1 | Create `DataSchemaBuilder` class with `build(boundSteps, pluginManager)` method — iterates all bound steps, creates a `DataSlot` for each step that has an `output: RefName` | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` (new) | Not started |
| 2.2 | Implement `inferSchemaForBoundStep()` — for steps bound to a plugin action, extract `output_schema` from the action definition via `PluginManagerV2`. Source: `plugin` | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.3 | Implement `inferSchemaForTransformStep()` — shape-preserving ops (`filter`, `sort`, `dedupe`, `flatten`): inherit input slot schema. Shape-changing ops (`map`, `group`, `merge`, `reduce`, `select`): use `transform.output_schema` (required by Phase 0 prompt rule). If `output_schema` is missing on a shape-changing op, log a pipeline warning. | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.4 | Implement `inferSchemaForExtractStep()` — uses the step's explicit `fields[]` declarations (name + type) to build schema. Source: `ai_declared` | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.5 | Implement `inferSchemaForGenerateStep()` — uses the step's explicit `outputs[]` declarations (name + type). Source: `ai_declared` | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.6 | Implement `inferSchemaForAggregateStep()` — each aggregate output produces a named slot (subset = same type as input, count = number, sum = number, etc.) | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.7 | Implement `inferSchemaForLoopStep()` — loop `item_ref` slot = input array's `items` schema (scope: `loop`); `collect_as` slot = array of inner step output | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.8 | Populate `consumed_by` — second pass over all steps, for each `inputs[]` RefName, add the step ID to the corresponding slot's `consumed_by` array | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |
| 2.9 | Wire into `CapabilityBinderV2.bind()` — after binding completes, call `DataSchemaBuilder.build()`, attach result to `BoundIntentContract.data_schema` | `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts` | Not started |
| 2.10 | Add `flattenSteps()` helper — recursively collects all steps including nested (loop body, decide branches, parallel branches) for schema traversal | `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | Not started |

**Schema inference per step kind:**

| Step kind | Schema source | Trust level | Notes |
|-----------|--------------|-------------|-------|
| `data_source` (bound) | Plugin `output_schema` | `plugin` | Full nested schema from plugin definition |
| `artifact` (bound) | Plugin `output_schema` | `plugin` | Usually returns created resource metadata |
| `deliver` (bound) | Plugin `output_schema` | `plugin` | Confirmation/result of delivery |
| `notify` (bound) | Plugin `output_schema` | `plugin` | Send confirmation (message_id, etc.) |
| `transform` (filter, sort, dedupe, flatten) | Derived from input slot | `inferred` | Shape-preserving: output = input schema |
| `transform` (map, group, merge, reduce, select) | Step's `transform.output_schema` | `ai_declared` | Shape-changing: LLM must declare output schema (Phase 0 prompt rule) |
| `extract` | Step's `fields[]` declarations | `ai_declared` | LLM already declared field names + types |
| `generate` | Step's `outputs[]` declarations | `ai_declared` | LLM already declared output names + types |
| `aggregate` | Step's `outputs[]` declarations | `inferred` | subset/count/sum produce known types |
| `loop` (item_ref) | Input array's `items` schema | `inferred` | Scope: `loop` (not global) |
| `loop` (collect_as) | Array of inner step output | `inferred` | Gather results from iterations |
| `decide` | No output (control flow) | N/A | |
| `parallel` | No direct output | N/A | Branch results accessed via inner step outputs |

**Testing:**
- Unit test: bind an IntentContract with a `data_source` step using `google-sheets.read_range` → slot schema matches plugin's `output_schema`
- Unit test: `transform` (filter) step → output schema = input schema
- Unit test: `extract` step with `fields: [{name: "amount", type: "number"}]` → slot has `{type: "object", properties: {amount: {type: "number"}}}`
- Unit test: `loop` step → `item_ref` slot has scope `loop`, schema = array items
- Unit test: `consumed_by` is correctly populated from step `inputs[]`
- Integration test: full bind of the leads-filter Enhanced Prompt → all slots populated

---

## Phase 3: Schema-Aware IR Conversion

**Goal:** `IntentToIRConverter` carries `data_schema` from `BoundIntentContract` to the `ExecutionGraph` IR, and uses it for variable reference validation.

| # | Task | File | Status |
|---|------|------|--------|
| 3.1 | Carry `data_schema` through to `execution_graph.data_schema` on the IR output | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | Not started |
| 3.2 | Replace or augment `variableMap: Map<string, string>` with slot-aware validation — when resolving `{{ref.field}}`, check that `ref` exists in `data_schema.slots` and `field` exists in the slot's schema properties | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | Not started |
| 3.3 | Validate cross-step compatibility — when a step's input parameter requires a specific type (from plugin `parameters` schema), check that the producing slot's schema is compatible | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | Not started |
| 3.4 | Add warnings (not errors) for unresolvable field references — downstream phases may still fix them, so don't block the pipeline | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | Not started |
| 3.5 | Update `consumed_by` tracking — as IR nodes reference variables, update the slot's `consumed_by` with the IR node ID (may differ from intent step ID) | `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | Not started |

**Testing:**
- Unit test: convert a BoundIntentContract with `data_schema` → IR has `execution_graph.data_schema` populated
- Unit test: reference `{{raw_leads.values}}` where slot `raw_leads` has `values` property → no warning
- Unit test: reference `{{raw_leads.nonexistent}}` → warning logged
- Unit test: step expects `spreadsheet_id: string` but upstream slot provides `number` → warning logged
- Integration test: full conversion of leads-filter workflow → IR with valid data_schema

---

## Phase 4: Compiler Schema Validation (Port from Architecture A)

**Goal:** Port the compiler-side schema validation from the Architecture A branch. Most of this code already exists on `feature/v6-workflow-generation-pipeline`.

| # | Task | File | Status |
|---|------|------|--------|
| 4.1 | Port `validateSchemaAgainstPlugins()` — cross-validate declared slot schemas against plugin `output_schema` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.2 | Port `output_schema` / `input_schema` attachment to compiled `WorkflowStep` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.3 | Port shape-preserving transform validation (output type = input type) | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.4 | Port loop validation (item schema matches array items, gather output is array) | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.5 | Port auto-inserted transform slot registration (Task 7.6 from Arch A) — when compiler auto-inserts `rows_to_objects`, register inferred slot in `data_schema` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.6 | Port AI output_schema depth enforcement — reject `array` without `items`, `object` without `properties` (with auto-repair fallback from Task 7.3) | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 4.7 | Port cross-step type compatibility checks — verify output field types match downstream input parameter types | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |

**Testing:**
- Unit test: compile IR with valid `data_schema` → compiled steps have `output_schema`
- Unit test: slot field doesn't exist in plugin schema → compile warning
- Unit test: auto-inserted `rows_to_objects` → new slot registered in `data_schema`
- Integration test: full IR → PILOT compilation with schema validation
- Integration test: leads-filter workflow compiles with all slots validated

---

## Phase 5: Runtime Integration

**Goal:** Connect `data_schema` to the execution engine for runtime validation. Port relevant parts from Architecture A.

| # | Task | File | Status |
|---|------|------|--------|
| 5.1 | Ensure `data_schema` flows from compiled output to runtime — extract from IR and attach to agent/workflow | TBD (depends on how this branch handles agent storage) | Not started |
| 5.2 | Port `ExecutionContext.registerDataSchema()` and `validateAgainstSchema()` (if not already on this branch) | `lib/pilot/ExecutionContext.ts` | Not started |
| 5.3 | Port `WorkflowPilot` post-step validation — validate output against slot's `output_schema` after each step executes | `lib/pilot/WorkflowPilot.ts` | Not started |
| 5.4 | Port structured output for AI steps — `GenerateHandler` uses `output_schema` to request JSON from LLM | `lib/orchestration/handlers/GenerateHandler.ts` | Not started |

**Testing:**
- Integration test: execute workflow with valid schema, all steps pass validation
- Integration test: plugin returns unexpected field shape → loud failure with descriptive error
- End-to-end test: full pipeline from Enhanced Prompt through execution with schema validation

---

## Test Cases (Cross-Phase)

| # | Scenario | Phases Tested |
|---|----------|---------------|
| T1 | Google Sheets read → filter leads → send email summary | Phases 1-5: plugin schema → transform derivation → notify |
| T2 | Gmail search → loop emails → extract attachments → upload to Drive | Phases 1-5: loop item schema, nested binding, cross-plugin data flow |
| T3 | Google Sheets read → conditional (empty check) → send "found" or "none found" email | Phases 1-5: conditional branch schemas, both paths validated |
| T4 | Multi-plugin: Gmail + Drive + Sheets + AI extraction | Phases 1-5: cross-plugin compatibility, AI-declared schemas |
| T5 | `transform` (filter) step — verify output schema = input schema | Phase 2: schema derivation for shape-preserving transforms |
| T6 | `extract` step with declared fields — verify slot matches field declarations | Phase 2: AI-declared schema construction |
| T7 | Reference `{{slot.nonexistent_field}}` — verify warning in Phase 3 | Phase 3: field reference validation |

**Primary test case:** The "High-Qualified Leads Email Summary" workflow (leads-filter Enhanced Prompt in `scripts/test-intent-contract-generation-enhanced-prompt.json`).

---

## Phase 6: Test Script & Validation

**Goal:** Update the existing test script to log and validate `data_schema` output at each phase, enabling visual verification during development.

| # | Task | File | Status |
|---|------|------|--------|
| 6.1 | After Phase 2 (binding), log `data_schema` slot count, slot names, and source breakdown (plugin/ai_declared/inferred) | `scripts/test-complete-pipeline-with-vocabulary.ts` | Not started |
| 6.2 | Save `data_schema` as a separate output file (`output/vocabulary-pipeline/data-schema.json`) | `scripts/test-complete-pipeline-with-vocabulary.ts` | Not started |
| 6.3 | After Phase 3 (IR conversion), verify `data_schema` is present on the IR and log any field reference warnings | `scripts/test-complete-pipeline-with-vocabulary.ts` | Not started |
| 6.4 | Add a validation summary at the end: list each slot with its source, produced_by, consumed_by, and top-level fields | `scripts/test-complete-pipeline-with-vocabulary.ts` | Not started |

**Testing:**
- Run the full pipeline with the leads-filter Enhanced Prompt → verify `data-schema.json` is saved with all expected slots
- Verify no `type: "any"` slots appear in the output

---

## Differences from Architecture A Workplan

| Aspect | Architecture A | Architecture B (this workplan) |
|--------|---------------|-------------------------------|
| **Who declares data_schema?** | LLM (Phase 3 / IRFormalizer) | Deterministic (Phase 2 / DataSchemaBuilder) |
| **Schema source for bound steps** | LLM declares, compiler validates against plugin | Plugin `output_schema` directly (no LLM involvement) |
| **Schema source for AI steps** | LLM declares in IR | Derived from IntentContract's `extract.fields[]` / `generate.outputs[]` |
| **Schema source for transforms** | LLM declares in IR | Shape-preserving: inherited. Shape-changing: LLM declares `transform.output_schema` |
| **Prompt changes needed?** | Yes (extensive — Phase 4 in Arch A workplan) | Minimal — one rule for shape-changing transforms (Phase 0) |
| **Trust level for bound steps** | Mixed (`ai_declared` then upgraded to `plugin`) | `plugin` from the start |
| **LLM non-determinism risk** | High — LLM may omit `properties`/`items` | None for bound steps, minimal for transforms (structured field, not freeform IR) |

---

## Resolved Decisions

| # | Decision | Resolution |
|---|----------|------------|
| Q1 | Where does `buildDataSchema()` live? | **Separate `DataSchemaBuilder` class** in `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts`. Keeps `CapabilityBinderV2` focused on binding (~560 lines already). |
| Q2 | How to handle unbound steps with `output` RefName? | **No `type: "any"` allowed.** Every step kind has a concrete schema source: plugin-bound → `output_schema`, transform → inherited or `transform.output_schema`, extract → `fields[]`, generate → `outputs[]`, aggregate → typed outputs. If a shape-changing transform is missing `output_schema`, log a pipeline warning — fix at Phase 1 (prompt). |
| Q3 | Should Phase 3 update `consumed_by`? | **Phase 2's pass is sufficient** for now. Can refine later if IR node IDs diverge significantly from intent step IDs. |
| Q4 | Per-step schema copies vs global lookup? | **Per-step copies (denormalized)** for now. Simpler for handlers, matches Architecture A. Can refactor to global lookup later. |

---

## Open Items (Future)

| # | Item | Context |
|---|------|---------|
| O1 | **Shallow plugin `output_schema`** — some plugin actions may have incomplete schemas (e.g., `extracted_fields: { type: "object" }` without nested properties). The `DataSchemaBuilder` should handle this gracefully (use what's available, don't fail), but these schemas should be enriched in the plugin definitions over time. | Plugin definition quality |
| O2 | **Refactor per-step copies to global lookup** — currently `output_schema`/`input_schema` are copied onto each `WorkflowStep` (denormalized). Could refactor to single `data_schema` lookup via `ExecutionContext` at runtime. See Open Item O1 in Architecture A workplan. | Architecture consistency |

---

## Notes

- The Intent Contract pipeline is built but **NOT wired into `V6PipelineOrchestrator`** — tested via standalone scripts (`test-complete-pipeline-with-vocabulary.ts`)
- Plugin definitions already have full `output_schema` (`ActionOutputSchema` type in `plugin-types.ts`) — no plugin definition changes needed
- `PluginManagerV2.getPluginDefinition()` provides access to action definitions including `output_schema` — already used during binding
- The `IntentContractV1` type already has `output?: RefName` and `inputs?: RefName[]` on every step — these are the symbolic data flow edges that `data_schema` adds type contracts to
- AI steps (`extract`, `generate`) already declare their output fields in the IntentContract — these become `ai_declared` slots without any LLM prompt changes
- `TransformStep` already has an optional `output_schema?: JsonObject` field — Phase 0 just makes it required for shape-changing operations
- Config values (`resolved_user_inputs`) are static parameters orthogonal to `data_schema` — they fill plugin action input params at compile time, they don't flow as dynamic data between steps

---

*V6 Workflow Data Schema (Intent Contract Pipeline) — Neuronforge*
