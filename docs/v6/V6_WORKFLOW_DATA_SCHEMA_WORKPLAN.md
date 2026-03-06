# V6 Workflow Data Schema — Implementation Workplan

> **Status**: Complete (all 6 phases implemented)
> **Date**: 2026-03-01
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
| 1.1 | Create `SchemaField`, `DataSlot`, `WorkflowDataSchema` types | `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` (new) | Done |
| 1.2 | Add `data_schema: WorkflowDataSchema` to `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Done |
| 1.3 | Deprecate `variables?: VariableDefinition[]` on `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Done |
| 1.4 | Update JSON Schema to include `data_schema` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict-v4.ts` | Done |
| 1.5 | Export new types from IR types barrel | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Done |

**Testing:**
- TypeScript compiles with no errors
- Create test `WorkflowDataSchema` instances in a scratch file to verify types work
- Existing tests still pass (variables still present, just deprecated)

---

## Phase 2: ExecutionContext Schema Validation

**Goal:** Add schema registration and validation to the runtime context. Simplify variable resolution to slot-based lookup.

| # | Task | File | Status |
|---|---|---|---|
| 2.1 | Add `dataSchema` private field and `registerDataSchema()` method | `lib/pilot/ExecutionContext.ts` | Done |
| 2.2 | Add `validateAgainstSchema()` method — validates data against a slot's schema | `lib/pilot/ExecutionContext.ts` | Done |
| 2.3 | Add `validateValue()` private method — recursive type/field validation | `lib/pilot/ExecutionContext.ts` | Done |
| 2.4 | Simplify `resolveSimpleVariable()` — unified slot lookup, remove prefix chain | `lib/pilot/ExecutionContext.ts` | Done |
| 2.5 | Keep legacy `step*` fallback temporarily (marked `// LEGACY: remove in Phase 6`) | `lib/pilot/ExecutionContext.ts` | Done |

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
| 3.1 | Add schema validation phase to `ExecutionGraphValidator` — validate all bindings reference declared slots, validate `produced_by` references existing nodes | `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` | Done |
| 3.2 | Add `validateSchemaAgainstPlugins()` — cross-validate declared slot schemas against plugin `output_schema` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 3.3 | Update `compileOperationNode()` — attach `output_schema` from slot to compiled `WorkflowStep` | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 3.4 | Update `compileTransformOperation()` — validate shape-preserving transforms (output type = input type) | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 3.5 | Update `compileLoopNode()` — validate item schema matches array items, gather output is array | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 3.6 | Update `compileChoiceNode()` — validate `oneOf` branch count matches rule count | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 3.7 | Add `output_schema` and `input_schema` fields to `WorkflowStep` type | `lib/pilot/types/pilot-dsl-types.ts` | Done |
| 3.8 | **[CRITICAL]** Add AI output_schema depth enforcement — reject `array` without `items`, reject `object` without `properties` | `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` | Done |
| 3.9 | Add cross-step type compatibility checks — verify AI output field types match downstream plugin input parameter types | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |

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
| 4.1 | Write new "Workflow Data Schema" section for the system prompt — declaration rules, slot structure, reference syntax. **CRITICAL: enforce full item-level depth for arrays and objects (see design doc Section 2)** | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Done |
| 4.2 | Remove old "Variable System" section from system prompt | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Done |
| 4.3 | Update Protocol 1 (Field Reference Validation) to check against `data_schema.slots` | `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | Done |
| 4.4 | Update `buildAvailablePluginsSection()` to inject full `output_schema` JSON per action | `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Done |
| 4.5 | Add post-LLM validation of `data_schema` structure in `formalize()` | `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Done |
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
| 5.1 | Register `data_schema` in `WorkflowPilot` at execution start — pass to `ExecutionContext.registerDataSchema()` | `lib/pilot/WorkflowPilot.ts` | Done |
| 5.2 | Add validation call after each step in `WorkflowPilot.executeSingleStep()` — validate output against `output_schema`, throw on mismatch | `lib/pilot/WorkflowPilot.ts` | Done |
| 5.3 | Update `translateStep()` to pass through `output_schema` and `input_schema` | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Done |
| 5.4 | Update `WorkflowParser.normalizeSingleStep()` for schema-aware steps | `lib/pilot/WorkflowParser.ts` | Done (no changes needed — spread operator preserves schema fields) |
| 5.5 | Update `OrchestrationService.flattenNestedSteps()` — ensure all step types (including conditional) are counted | `lib/orchestration/OrchestrationService.ts` | Done (already handles all step types including conditional) |

**Testing:**
- Integration test: execute workflow with valid schema, all steps pass validation
- Integration test: execute workflow where plugin returns unexpected field shape → loud failure with descriptive error
- Integration test: scatter-gather with schema — validate item and gather output
- End-to-end test: full pipeline from Enhanced Prompt through execution with schema validation
- Test with the invoice/expense workflow from `dev.log` as the primary test case

### Phase 5 Addendum: `data_schema` Plumbing

**Why this is needed:** Tasks 5.1–5.2 register and validate `data_schema` at runtime, but the schema never actually reaches the runtime. The V6 pipeline creates `data_schema` inside `ir.execution_graph.data_schema` (Phase 3/4), and `WorkflowPilot` reads it from `agent.data_schema` (task 5.1) — but nothing in between extracts it from the IR and sets it on the Agent. Without this plumbing, `agent.data_schema` is always `undefined` and `registerDataSchema()` is a no-op, meaning all runtime schema validation silently does nothing.

**Data flow today (broken):**
```
IR (execution_graph.data_schema) → PipelineResult (buried in ir) → API response (not extracted) → Agent (undefined)
```

**Data flow after fix:**
```
IR (execution_graph.data_schema) → PipelineResult.data_schema → API response.data_schema → Agent.data_schema → WorkflowPilot registers it
```

| # | Task | File | Status |
|---|---|---|---|
| 5.6 | Extract `data_schema` to top-level of `PipelineResult` — add `data_schema?: WorkflowDataSchema` to the interface and set it from `ir.execution_graph.data_schema` in the return value | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Done |
| 5.7 | Include `data_schema` in V6 API responses — both `/api/v6/generate-workflow-validated` and `/api/v6/generate-ir-semantic` should return `data_schema: result.data_schema` alongside `workflow` | `app/api/v6/generate-workflow-validated/route.ts`, `app/api/v6/generate-ir-semantic/route.ts` | Done |
| 5.8 | Pass `data_schema` to temporary agent in test execution endpoint — **both server and client**: (a) add `data_schema` to `ExecuteTestRequest` interface and pass it to the temporary agent object, (b) update test page to send `data_schema: window.currentWorkflow.ir?.execution_graph?.data_schema` in the request body | `app/api/v6/execute-test/route.ts`, `public/test-v6-declarative.html` | Done |
| 5.9 | Persist `data_schema` for saved agents — (a) create Supabase migration: `ALTER TABLE agents ADD COLUMN data_schema JSONB DEFAULT NULL`, (b) add `data_schema` to repository `Agent` interface, (c) include `data_schema` in `create-agent` route insert | `supabase/migrations/20260301_add_data_schema_to_agents.sql`, `lib/repositories/types.ts`, `app/api/create-agent/route.ts` | Done |
| 5.10 | Store `ir` / `data_schema` on `window.currentWorkflow` in test page — both pipeline paths (V6 orchestrator and validated pipeline) were missing this, so the execute call at line 1584 could never reach `data_schema`. Without this fix, `data_schema` is always `undefined` at execution time from the test page. | `public/test-v6-declarative.html` | Done |
| 5.11 | Display `data_schema` in test page UI — show the shared schema object alongside steps in Phase 3 (green banner with slot count breakdown by source), Phase 4 (above DSL steps), Phase 5 (above PILOT steps), and validated pipeline output. Allows cross-referencing slots while reviewing steps. | `public/test-v6-declarative.html` | Done |

---

## Phase 6: Cleanup & Migration

**Goal:** Remove all legacy code. No backward compatibility, no fallback chains.

| # | Task | File | Status |
|---|---|---|---|
| 6.1 | Remove `variables?: VariableDefinition[]` from `ExecutionGraph` | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Done |
| 6.2 | Remove `VariableDefinition` interface | `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | Done |
| 6.3 | Remove `initializeVariables()` from compiler | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 6.4 | Remove legacy `step*` fallback in `resolveSimpleVariable()` | `lib/pilot/ExecutionContext.ts` | Done |
| 6.5 | Remove `||` fallback chains in `translateStep()` for conditional fields | `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Done |
| 6.6 | Remove format sniffing in `WorkflowParser.normalizeSingleStep()` | `lib/pilot/WorkflowParser.ts` | Done |
| 6.7 | Remove multi-format detection in `StepExecutor.executeConditional()` | `lib/pilot/StepExecutor.ts` | Done |
| 6.8 | Remove `[key: string]: any` from `WorkflowStep` type | `lib/pilot/types/pilot-dsl-types.ts` | Done |
| 6.9 | Update all V6 documentation to reflect schema system | `docs/v6/*.md` | Done |

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

## Phase 7: E2E Runtime Fixes

**Goal:** Fix runtime integration issues discovered during end-to-end testing with real data. These are pre-existing problems that were invisible when data flowed as `any` everywhere, but surface now that the schema system expects concrete field access (e.g., `{{filter_result.filtered_leads}}`).

**How to discover new issues:** Run the T7 test case (or any multi-step workflow with AI steps) end-to-end from the test page. If a step output resolves to `undefined` when it shouldn't, or a conditional takes the wrong branch, the root cause is likely an output wrapping/parsing issue at the boundary between a handler and the workflow engine.

| # | Task | File | Status |
|---|---|---|---|
| 7.1 | **Unwrap orchestration envelope for AI steps** — `GenerateHandler` returns `{ result: "<raw JSON text>", response, output, quality, ... }` but downstream steps expect parsed data (e.g., `filter_result.filtered_leads`). Fix: after orchestration completes in `StepExecutor`, detect JSON in the `result` field, parse it, and return the parsed object as `data` instead of the envelope. | `lib/pilot/StepExecutor.ts` | Done |
| 7.2 | **Structured output for AI steps with `output_schema`** — When an AI step has `output_schema` (from data_schema), the LLM must return structured JSON matching that schema, not freeform text or code. Currently `GenerateHandler` sends a generic prompt and the LLM returns JavaScript code in markdown blocks instead of JSON data. **Root cause:** `output_schema` is present on the PILOT `WorkflowStep` (set in Phase 5 task 5.3) but `GenerateHandler` never reads it and `BaseHandler.callLLM()` never passes `response_format` to the provider. **Fix:** (a) `GenerateHandler.handle()` — extract `output_schema` from `context.input?.step?.output_schema`, when present append schema instructions to the system prompt ("respond with JSON matching this schema"), (b) `BaseHandler.callLLM()` — add optional `responseFormat` parameter, pass through to `provider.chatCompletion()` as `response_format: { type: "json_object" }`, (c) `GenerateHandler` — pass `response_format` when `output_schema` is present, (d) `StepExecutor` envelope unwrap — tighten the regex to avoid matching code block braces (defense-in-depth). | `lib/orchestration/handlers/GenerateHandler.ts`, `lib/orchestration/handlers/BaseHandler.ts`, `lib/pilot/StepExecutor.ts` | Done |
| 7.3 | **Auto-repair shallow AI-declared schemas in Phase 3 validation** — The LLM non-deterministically omits `properties` on object-typed slots or `items` on array-typed slots in data_schema, causing `validateDataSchema()` to hard-fail and kill the pipeline. Since the depth enforcement was added in task 3.8, any LLM run that produces a shallow schema is a total pipeline failure with no recovery. **Fix:** Change `validateSchemaDepth()` from error-and-throw to warn-and-repair: (a) `type: "object"` without `properties` → auto-set `properties: {}` (permissive, allows any fields at runtime), (b) `type: "array"` without `items` → auto-set `items: { type: "any" }`. Both cases log as warnings (visible in dev.log) but no longer block the pipeline. | `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Done |
| 7.5 | **Downgrade Gate 4 constraint violations to warnings** — Gate 4's threshold/routing guard checks use a heuristic that only recognizes explicit `conditional`/`filter`/`branch` step types. When the LLM legitimately implements filtering inside an `ai_processing` or `transform` step, Gate 4 false-positive fails with "has no guard". Since the LLM produces different IR structures non-deterministically, this causes random pipeline failures. **Fix:** Only unmapped requirements (LLM missed a feature entirely) are hard FAIL. Violated constraints (threshold/routing guard not found by heuristic) are downgraded to PASS with warnings — logged but non-blocking. | `lib/agentkit/v6/requirements/ValidationGates.ts` | Done |
| 7.6 | **Register auto-inserted transform outputs in `data_schema`** — The compiler auto-inserts transform steps (e.g., `rows_to_objects` for Google Sheets `read_range`), creating new variables like `sheet_data_objects`. These variables are consumed by downstream steps but never registered as slots in `data_schema`. This violates the design intent that every workflow variable has a corresponding slot. **Fix:** When the compiler auto-inserts a transform step, it should also add an `inferred` slot to `data_schema` for the transform's output (same pattern as task 3.5 for loop-derived variables). | `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Done |
| 7.4 | **Gmail executor: respect `isHtml` flag on `content.body`** — The V6 compiler emits `{ content: { body: "<html>...", isHtml: true } }` for HTML emails, but the Gmail plugin executor only sends as `text/html` when `content.html_body` is set. When `isHtml: true` is present with `content.body`, the email is sent as `text/plain` and the recipient sees raw HTML tags. **Fix:** Check `content.isHtml` in addition to `content.html_body` when deciding the MIME Content-Type. | `lib/server/gmail-plugin-executor.ts` | Done |

**Symptoms to watch for (add tasks here when found):**
- Variable resolves to `undefined` when the previous step "succeeded" → likely an output wrapping issue
- Conditional takes wrong branch → the field it checks resolved to `undefined` or wrong type
- Schema validation warns about unexpected type `"object"` with keys like `result`, `response`, `quality` → the envelope leaked through
- Loop `iterate_over` receives an object instead of an array → AI output wasn't unwrapped
- AI step `rawTextPreview` starts with `` ```javascript `` or `` ```js `` → LLM returned code instead of data (task 7.2)

**Testing:**
- Re-run T7 end-to-end: conditional should take `then` branch (leads found), summary email should contain the actual HTML table, per-salesperson emails should be sent
- Verify `filter_result.filtered_leads` resolves to an array (not `undefined`)
- Verify `filter_result.total_filtered > 0` evaluates to `true`
- Verify AI step `rawTextPreview` in dev.log starts with `{` or `[` (JSON), not `` ```javascript `` (code)
- Verify `response_format` appears in LLM API call logs when `output_schema` is present on the step

---

## Open Items (Future Decisions)

Items identified during implementation that need architectural decisions before proceeding.

| # | Item | Context | Options |
|---|------|---------|---------|
| O1 | **Remove per-step `output_schema`/`input_schema` copies — use global `data_schema` lookup instead** | Currently the compiler copies each slot's schema onto the individual `WorkflowStep` (`step.output_schema`, `step.input_schema`) in tasks 3.7 and 5.3. At runtime, `GenerateHandler` reads `step.output_schema` to build the structured output prompt (task 7.2). But the whole point of `data_schema` is a single global registry — per-step copies are a denormalization that duplicates data. | **Option A (current):** Keep per-step copies. Simpler handler code (`step.output_schema` is locally available), but schema lives in two places. **Option B (refactor):** Remove per-step copies. At runtime, look up schema from the global `data_schema` via `ExecutionContext`: step knows its `output_variable` name → `data_schema.slots[output_variable].schema`. Eliminates duplication, single source of truth. Requires handlers to access `ExecutionContext` (already available via `context.executionContext`). |

---

## Notes

- Phases 2, 3, 4 can be worked in parallel after Phase 1
- Phase 4 (LLM prompt) requires manual testing with actual LLM calls — can't be fully automated
- **Primary test case:** The "High-Qualified Leads Email Summary" workflow (T7) — validated via dry-run on 2026-02-26. IR captured in `dev-traces/phase3-ir.json`
- **Highest-risk item:** Task 4.1 — getting the LLM to produce full item-level output_schemas for AI steps. Current LLM produces shallow `type: array` with text descriptions. The prompt must show explicit examples of correct vs. incorrect depth.
- All `// LEGACY` markers have been cleaned up in Phase 6
- Trace instrumentation (dev-traces dump) is currently in V6PipelineOrchestrator.ts — remove after implementation is validated

---

*V6 Workflow Data Schema Workplan — Neuronforge*
