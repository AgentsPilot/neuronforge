# V6 Workflow Data Schema — Implementation Workplan

> **Status**: Planning (design validated via dry-run)
> **Date**: 2026-02-26
> **Design doc**: [V6_WORKFLOW_DATA_SCHEMA_DESIGN.md](./V6_WORKFLOW_DATA_SCHEMA_DESIGN.md)

---

## Implementation Phases

```
Phase 1: Type Foundation                    ← no dependencies
Phase 2: ExecutionContext Schema Validation  ← depends on Phase 1
Phase 3: Compiler Schema Validation         ← depends on Phase 1
Phase 4: LLM Prompt Update                  ← depends on Phase 1
Phase 5: Runtime Validation Integration     ← depends on Phases 2 + 3
Phase 6: Cleanup & Migration                ← depends on Phase 5
```

Phases 2, 3, and 4 can be worked on in parallel after Phase 1 is complete.

---

## Phase 1: Type Foundation

**Goal:** Define the core types and integrate them into the IR schema.

| # | Task | File | Status |
|---|---|---|---|
| 1.1 | Create `SchemaField`, `DataSlot`, `WorkflowDataSchema` types | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` (new) | Not started |
| 1.2 | Add `data_schema: WorkflowDataSchema` to `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |
| 1.3 | Deprecate `variables?: VariableDefinition[]` on `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |
| 1.4 | Update JSON Schema to include `data_schema` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict-v4.ts` | Not started |
| 1.5 | Export new types from IR types barrel | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |

**Testing:**
- TypeScript compiles with no errors
- Create test `WorkflowDataSchema` instances in a scratch file to verify types work
- Existing tests still pass (variables still present, just deprecated)

---

## Phase 2: ExecutionContext Schema Validation

**Goal:** Add schema registration and validation to the runtime context. Simplify variable resolution to slot-based lookup.

| # | Task | File | Status |
|---|---|---|---|
| 2.1 | Add `dataSchema` private field and `registerDataSchema()` method | `lib/pilot/ExecutionContext.ts` | Not started |
| 2.2 | Add `validateAgainstSchema()` method — validates data against a slot's schema | `lib/pilot/ExecutionContext.ts` | Not started |
| 2.3 | Add `validateValue()` private method — recursive type/field validation | `lib/pilot/ExecutionContext.ts` | Not started |
| 2.4 | Simplify `resolveSimpleVariable()` — unified slot lookup, remove prefix chain | `lib/pilot/ExecutionContext.ts` | Not started |
| 2.5 | Keep legacy `step*` fallback temporarily (marked `// LEGACY: remove in Phase 6`) | `lib/pilot/ExecutionContext.ts` | Not started |

**Testing:**
- Unit test `validateAgainstSchema` with: valid object, missing required field, wrong type, array with typed items, `oneOf` union
- Unit test `resolveSimpleVariable` with slot names (`{{raw_emails}}`, `{{raw_emails.total_found}}`)
- Unit test that legacy `{{step1.data.emails}}` still resolves (fallback path)
- Verify existing execution still works end-to-end

---

## Phase 3: Compiler Schema Validation

**Goal:** The compiler validates the data schema against plugin output schemas and attaches schema metadata to compiled steps.

| # | Task | File | Status |
|---|---|---|---|
| 3.1 | Add schema validation phase to `ExecutionGraphValidator` — validate all bindings reference declared slots, validate `produced_by` references existing nodes | `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` | Not started |
| 3.2 | Add `validateSchemaAgainstPlugins()` — cross-validate declared slot schemas against plugin `output_schema` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 3.3 | Update `compileOperationNode()` — attach `output_schema` from slot to compiled `WorkflowStep` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 3.4 | Update `compileTransformOperation()` — validate shape-preserving transforms (output type = input type) | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 3.5 | Update `compileLoopNode()` — validate item schema matches array items, gather output is array | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 3.6 | Update `compileChoiceNode()` — validate `oneOf` branch count matches rule count | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 3.7 | Add `output_schema` and `input_schema` fields to `WorkflowStep` type | `lib/pilot/types/pilot-dsl-types.ts` | Not started |
| 3.8 | **[CRITICAL]** Add AI output_schema depth enforcement — reject `array` without `items`, reject `object` without `properties` | `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` | Not started |
| 3.9 | Add cross-step type compatibility checks — verify AI output field types match downstream plugin input parameter types | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |

**Testing:**
- Unit test: compile IR with valid `data_schema`, verify `output_schema` on compiled steps
- Unit test: compile IR where declared slot field doesn't exist in plugin schema → compile error
- Unit test: shape-preserving transform with type mismatch → compile error
- Unit test: loop with wrong item schema → warning
- Unit test: AI step with `type: array` but no `items` → compile error (3.8)
- Unit test: AI output field type doesn't match downstream plugin param type → compile error (3.9)
- Integration test: full IR → DSL compilation with schemas

---

## Phase 4: LLM Prompt Update

**Goal:** The LLM declares `data_schema` as part of the IR output. Plugin schemas are injected in full JSON.

| # | Task | File | Status |
|---|---|---|---|
| 4.1 | Write new "Workflow Data Schema" section for the system prompt — declaration rules, slot structure, reference syntax. **CRITICAL: enforce full item-level depth for arrays and objects (see design doc Section 2)** | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Not started |
| 4.2 | Remove old "Variable System" section from system prompt | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Not started |
| 4.3 | Update Protocol 1 (Field Reference Validation) to check against `data_schema.slots` | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Not started |
| 4.4 | Update `buildAvailablePluginsSection()` to inject full `output_schema` JSON per action | `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Not started |
| 4.5 | Add post-LLM validation of `data_schema` structure in `formalize()` | `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Not started |
| 4.6 | Test with real LLM call — verify the model produces valid `data_schema` | Manual test | Not started |

**Testing:**
- Snapshot test: verify LLM prompt includes full plugin output schemas
- Manual test: run `IRFormalizer.formalize()` with a test Enhanced Prompt, verify `data_schema` in output
- Verify LLM-produced `data_schema` passes Phase 3 validator
- Test with multiple prompts (simple action, conditional, scatter-gather, AI extraction)

---

## Phase 5: Runtime Validation Integration

**Goal:** Connect the schema to the execution engine. Steps are validated after execution.

| # | Task | File | Status |
|---|---|---|---|
| 5.1 | Register `data_schema` in `WorkflowPilot` at execution start — pass to `ExecutionContext.registerDataSchema()` | `lib/pilot/WorkflowPilot.ts` | Not started |
| 5.2 | Add validation call after each step in `WorkflowPilot.executeSingleStep()` — validate output against `output_schema`, throw on mismatch | `lib/pilot/WorkflowPilot.ts` | Not started |
| 5.3 | Update `translateStep()` to pass through `output_schema` and `input_schema` | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Not started |
| 5.4 | Update `WorkflowParser.normalizeSingleStep()` for schema-aware steps | `lib/pilot/WorkflowParser.ts` | Not started |
| 5.5 | Update `OrchestrationService.flattenNestedSteps()` — ensure all step types (including conditional) are counted | `lib/orchestration/OrchestrationService.ts` | Not started |

**Testing:**
- Integration test: execute workflow with valid schema, all steps pass validation
- Integration test: execute workflow where plugin returns unexpected field shape → loud failure with descriptive error
- Integration test: scatter-gather with schema — validate item and gather output
- End-to-end test: full pipeline from Enhanced Prompt through execution with schema validation
- Test with the invoice/expense workflow from `dev.log` as the primary test case

---

## Phase 6: Cleanup & Migration

**Goal:** Remove all legacy code. No backward compatibility, no fallback chains.

| # | Task | File | Status |
|---|---|---|---|
| 6.1 | Remove `variables?: VariableDefinition[]` from `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |
| 6.2 | Remove `VariableDefinition` interface | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Not started |
| 6.3 | Remove `initializeVariables()` from compiler | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Not started |
| 6.4 | Remove legacy `step*` fallback in `resolveSimpleVariable()` | `lib/pilot/ExecutionContext.ts` | Not started |
| 6.5 | Remove `||` fallback chains in `translateStep()` for conditional fields | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Not started |
| 6.6 | Remove format sniffing in `WorkflowParser.normalizeSingleStep()` | `lib/pilot/WorkflowParser.ts` | Not started |
| 6.7 | Remove multi-format detection in `StepExecutor.executeConditional()` | `lib/pilot/StepExecutor.ts` | Not started |
| 6.8 | Remove `[key: string]: any` from `WorkflowStep` type | `lib/pilot/types/pilot-dsl-types.ts` | Not started |
| 6.9 | Update all V6 documentation to reflect schema system | `docs/v6/*.md` | Not started |

**Testing:**
- Full test suite passes with no legacy code
- End-to-end test: pipeline produces valid results with schema-only system
- Verify no `||` fallback chains remain in the codebase for step field access
- Manual test with test page (`/test-v6-declarative.html`)

---

## Test Cases (Cross-Phase)

These end-to-end test scenarios should work after Phase 5 is complete:

| # | Scenario | What it tests |
|---|---|---|
| T1 | Gmail search → filter → send email | Basic action → transform → action flow with schema |
| T2 | Gmail search → conditional (empty check) → send digest OR process emails | Conditional branches with `oneOf` schema |
| T3 | Gmail search → loop over emails → extract PDF → store in Drive → append to Sheets | Scatter-gather with nested actions, item scope, gather |
| T4 | Gmail search → AI extraction → conditional (amount > 50) → Sheets append | AI step with declared output schema + conditional |
| T5 | Plugin returns unexpected field name | Schema validation catches mismatch, loud failure |
| T6 | AI extraction returns wrong type | Schema validation catches type error |
| T7 | **[DRY-RUN VALIDATED]** Google Sheets read → AI filter (Stage=4) → conditional (empty check) → AI HTML table → AI group by Sales Person → send summary email → loop send per-sales-person emails | Full chain: plugin→AI→choice→AI→AI→plugin→loop→plugin. Validates all schema source categories, loop item derivation, cross-step type checks. IR available in `dev-traces/phase3-ir.json` |

---

## Notes

- Phases 2, 3, 4 can be worked in parallel after Phase 1
- Phase 4 (LLM prompt) requires manual testing with actual LLM calls — can't be fully automated
- **Primary test case:** The "High-Qualified Leads Email Summary" workflow (T7) — validated via dry-run on 2026-02-26. IR captured in `dev-traces/phase3-ir.json`
- **Highest-risk item:** Task 4.1 — getting the LLM to produce full item-level output_schemas for AI steps. Current LLM produces shallow `type: array` with text descriptions. The prompt must show explicit examples of correct vs. incorrect depth.
- Keep the `// LEGACY` markers during development so cleanup in Phase 6 is a simple search
- Trace instrumentation (dev-traces dump) is currently in V6PipelineOrchestrator.ts — remove after implementation is validated

---

*V6 Workflow Data Schema Workplan — Neuronforge*
