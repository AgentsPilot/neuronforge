---
name: v6-pipeline
description: Loads the architecture + constraint context for the V6 agent-generation pipeline — Phase 0 (vocabulary) → Phase 1 (IntentContract) → Phase 2 (capability binding + data_schema) → Phase 3 (IR conversion) → Phase 4 (DSL compilation) — and the runtime that executes the resulting DSL (lib/pilot/). Use whenever the user asks to add, change, debug, or extend ANYTHING in the V6 pipeline: the IntentContract grammar, the Phase 1 system prompt (intent-system-prompt-v2.ts), the capability binder, the data_schema builder, the IR converter, the execution graph compiler, the DSL runtime (StepExecutor, ParallelExecutor, StructuralRepairEngine, DataPreprocessor), plugin definitions consumed by the pipeline, regression scenarios under tests/v6-regression/, or the diagnostics persisted on agents.agent_config.ai_context. The V2 thread-based agent-creation flow upstream (/v2/agents/new) is OUT OF SCOPE here — that's the agent-creation-flow skill. Cycle-specific workplans live in docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_*.md; the current weak-point catalog is V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md.
---

# v6-pipeline

Load this context **before** writing or changing code that touches the V6 semantic agent-generation pipeline OR the runtime that executes its output. It's the durable source of truth for what the pipeline does today, where each phase lives, and what must not be broken — independent of which weak-point fix introduced each piece.

> **First read**: [`docs/v6/V6_DOCS_INDEX.md`](../../../docs/v6/V6_DOCS_INDEX.md) — the canonical reading-order index. It points to the ~10 Tier-1 docs (Overview, Design Principles, the rebase design doc, the active WEAK_POINTS catalog, the active workplans, ARCHITECTURE, and the QA testing manual). **This skill assumes you've read at least V6_OVERVIEW.md + V6_DESIGN_PRINCIPLES.md** (or are about to).

> The user creates V6 agents via the V2 UI at **`/v2/agents/new`**. That UI ends at the Approve button — beyond that, V6 takes over via **`POST /api/v6/generate-ir-intent-contract`** which runs all 5 pipeline phases in one call and returns the compiled DSL plus the Phase 1 / Phase 2 artifacts. The DSL is then persisted by `/api/create-agent` and executed at run-time by `/api/run-agent` through `lib/pilot/WorkflowPilot.ts`.

---

## 1. The pipeline at a glance

```
Enhanced Prompt (from V2 UI agent-creation flow)
   ↓
Phase 0 — VOCABULARY                    (deterministic; ~150 ms)
   ↓                                     PluginVocabularyExtractor builds the action catalog
   ↓                                     summarizeOutputSchema renders each action's I/O for the LLM prompt
   ↓
Phase 1 — INTENT CONTRACT               (one LLM call; 8–20 s)
   ↓                                     intent-system-prompt-v2.ts (~2100 lines) drives Phase 1
   ↓                                     LLM authors the IntentContract — capabilities, payloads, refs, loops
   ↓                                     Zod-validated; raw output now also persisted on agent_config (WP-55)
   ↓
Phase 2 — CAPABILITY BINDING +          (deterministic; ~200 ms)
          DATA SCHEMA                    CapabilityBinderV2 binds IntentContract steps to plugin actions
   ↓                                     DataSchemaBuilder builds slot schemas from plugin output_schemas
   ↓                                     InputTypeChecker validates from_type → to_type compatibility
   ↓                                     data_schema is now also persisted on agent_config (WP-55)
   ↓
Phase 3 — IR CONVERSION                 (deterministic; ~50 ms)
   ↓                                     IntentToIRConverter turns bound IntentContract into ExecutionGraph IR
   ↓                                     `notify` / `data_source` / `loop` / `decide` / `transform` / ... step
   ↓                                     kinds each get a private converter method
   ↓
Phase 4 — DSL COMPILATION               (deterministic; ~100 ms)
   ↓                                     ExecutionGraphCompiler walks the IR and emits DSL `workflow_steps`
   ↓                                     O10/O20 field-reference reconciliation against data_schema slots
   ↓                                     attachSlotSchemas attaches output_schema to each compiled step
   ↓
DSL = the compiled pilot_steps stored on agents.pilot_steps + agents.workflow_steps
   ↓
RUNTIME (lib/pilot/, executed by /api/run-agent and /api/run-agent-stream):
  StateManager → WorkflowPilot (orchestrates execution)
  StructuralRepairEngine (pre-flight validation, can mutate DSL — careful!)
  StepExecutor (executes each step type; routes ai_processing through DataPreprocessor)
  ParallelExecutor (handles scatter_gather, loop, parallel)
  ExecutionContext (variable resolution, {{var.field}} templating)
```

**Phase 1 is where most production failures originate** — the LLM is the only non-deterministic phase. Most fixes in WP-39..55 trace to either Phase 1 emitting something the downstream phases can't safely handle, or runtime safety nets compensating after the fact. Bias new investigations toward **inspecting the IntentContract first** (now persisted on `agent_config.ai_context.intent_contract` per WP-55).

---

## 2. Source-of-truth files

### Pipeline code

| File | Phase | What |
|---|---|---|
| `lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts` | 0 | Builds the plugin/action catalog shown to the LLM. |
| `lib/agentkit/v6/vocabulary/outputSchemaSummarizer.ts` | 0 | Renders each action's output_schema into the compact `Returns: { ... }` lines in the prompt. Depth-capped, named-type extraction. **Straight key copy — does not mutate plugin field names.** |
| `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` | 1 | The ~2100-line Phase 1 system prompt. Defines the IntentContract grammar (steps, payload, refs, loops, transforms) and the EP-FIDELITY rules (§ 5.5, added in WP-53). |
| `lib/agentkit/v6/intent/intent-user-prompt.ts` | 1 | Builds the user message that frames the EP for the LLM. |
| `lib/agentkit/v6/intent/generate-intent.ts` | 1 | Phase 1 generator. Calls LLM, parses JSON, validates with Zod, logs the full IntentContract via Pino at `[IntentGen] ✅`. |
| `lib/agentkit/v6/intent/intent-validator.ts` + `intent-repair.ts` | 1 | Zod validator + repair pass (e.g. fill missing `id` fields). |
| `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts` | 2 | Binds IntentContract steps to plugin actions. WP-2 field reconciliation lives here. |
| `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` | 2 | Builds `data_schema.slots[var].schema` from plugin definitions. Loop item-ref slots, aggregate subset items, transform shape preservation (WP-17, WP-18). |
| `lib/agentkit/v6/capability-binding/InputTypeChecker.ts` | 2 | Validates from_type → to_type compatibility (WP-12). |
| `lib/agentkit/v6/compiler/IntentToIRConverter.ts` | 3 | Converts bound IntentContract → ExecutionGraph IR. Step-kind-specific converter methods (convertNotify, convertDataSource, convertLoop, etc.). |
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | 4 | Compiles IR → DSL. Field reconciliation (O10/O20), schema attachment, structural repair. ~6800 lines. |
| `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` | shared | Converts plugin JSON Schema → `SchemaField` for data_schema. **Straight key copy** — line 152. |
| `lib/plugins/definitions/*.json` | source of truth | Plugin manifests. `output_schema` (items.properties), `parameters.properties`, `x-variable-mapping`, `x-semantic-type` annotations. These are AUTHORITATIVE — when prompts/code/binder disagree with a plugin def, the plugin def wins. |
| `lib/server/*-plugin-executor.ts` | runtime | Per-plugin executors. Receive resolved params, call the external API, return raw response. |

### Runtime code

| File | What |
|---|---|
| `lib/pilot/WorkflowPilot.ts` | Top-level orchestrator. Loads DSL, manages execution lifecycle, emits SSE events. |
| `lib/pilot/StepExecutor.ts` | Executes each step. Routes `ai_processing` through `DataPreprocessor` → WP-13 empty-input guard → LLM. ~2000 lines. |
| `lib/pilot/ParallelExecutor.ts` | Scatter-gather + loop + parallel-branch execution. Honours `scatter.continueOnError` (WP-54). |
| `lib/pilot/ExecutionContext.ts` | `{{var.field}}` template resolution. The runtime authority on which fields resolve to what. |
| `lib/pilot/shadow/StructuralRepairEngine.ts` | Pre-flight DSL validation. Detects broken refs, missing `output_variable`, etc. Builtins set must include `input` / `config` (WP-52). Can auto-fix some classes; fuzzy-match path is risky (WP-40 family). |
| `lib/orchestration/preprocessing/DataPreprocessor.ts` | Routes input by shape heuristic before AI steps. **Lossy** — `EventPreprocessor` etc. drop items failing type-specific validators (WP-50, WP-51). |
| `lib/agentkit/v6/api-routes` (via `app/api/v6/`) | HTTP entry points. Primary: `/api/v6/generate-ir-intent-contract` (Pipeline A). |
| `app/api/create-agent/route.ts` | Persists the agent row. Accepts `agent_config` JSONB via `z.record(z.unknown()).nullish()` — extended in WP-48, now also carries `intent_contract` + `data_schema` via WP-55. |
| `app/api/run-agent/route.ts` + `/run-agent-stream/route.ts` | Run-time entry. Calls `WorkflowPilot.execute()`. |

### Test infrastructure

| File | What |
|---|---|
| `tests/v6-regression/scenarios/<slug>/` | Each regression scenario folder: `scenario.json` + canonical phase snapshots (enhanced-prompt, intent-contract, phase2-data-schema, phase4-pilot-dsl-steps, phase4-workflow-config). `output/` is gitignored. |
| `scripts/test-complete-pipeline-with-vocabulary.ts` | Runs Phases 0–4 against an EP file. Writes all intermediate phase outputs to `--output-dir`. **Use this to re-capture Phase 1 LLM output for a failing agent.** |
| `scripts/test-dsl-execution-simulator/` | Phase A static validator (~14 checks per scenario). |
| `scripts/test-workflowpilot-execution.ts` | Phase D mock-execution simulator. |
| `scripts/test-live-agent-execution.ts` | Phase E live runner against real plugins. |
| `tests/v6-regression/run-regression.ts` | Runs Phase A + D across all scenarios. |
| `scripts/dump-agent.ts <agent_id>` | Pulls an agent row to `c:/tmp/agent-<prefix>.json` for inspection. |
| `scripts/build-scenario-from-agent.ts <agent_id> <slug>` | Generates the canonical scenario seed files from a saved agent. |

### Docs

**Durable / load-bearing:**

| File | What |
|---|---|
| `docs/v6/V6_DOCS_INDEX.md` | Reading-order index. Tier 1 / Tier 2 / archived. **The first doc to read.** |
| `docs/v6/V6_OVERVIEW.md` | High-level introduction to the 5-phase pipeline. |
| `docs/v6/V6_DESIGN_PRINCIPLES.md` | **12 prescriptive principles + 7 anti-patterns + decision checklist** — synthesized from 38+ weak points. Read before writing new V6 code; cite when reviewing. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` | The canonical current design doc (April 2026, ~100 KB). Supersedes the archived V6_WORKFLOW_DATA_SCHEMA_DESIGN.md. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` | **The active catalog of weak points (WP-1 .. WP-55)**. The MOST-UPDATED V6 doc. Skim the summary table + Change History first, then dive into specific WPs. |
| `docs/v6/V6_OPEN_ITEMS.md` | Consolidated backlog (open WPs, open workplan tasks, untested scenario logic, doc debt). Pointer index — never write full detail here. |
| `docs/v6/V6_ARCHITECTURE.md` | Deep dive into each of the 5 phases (data flow, error handling). |
| `docs/v6/V6_DEVELOPER_GUIDE.md` | Integration / extension / debugging recipes — including the WP-55 "Diagnosing a Production Agent's Phase 1 Emission" SQL pattern. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` | The QA testing manual. Step-by-step Phase 0–4 → A → D → E procedure for any scenario. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md` | Regression test infrastructure design (`scenario.json` schema, `run-regression.ts` orchestrator, EP Key Hints pre-flight). |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md` | Active workplan for IntentContract grammar / binder / IR converter / compiler tasks. |
| `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` | Active workplan for the execution simulator (Phase A/B/D/E test strategy). |
| `docs/v6/V6_AGENT_CREATION_INTEGRATION_PLAN.md` | How V6 integrates with the V2 UI's Review Mode + feature flags. |
| `docs/v6/V6_SCHEMA_BASED_GROUNDING.md` | Phase 2 grounding design — schema-only, no real data fetch during agent creation. |
| `docs/v6/V6_PIPELINE_A_MIGRATION.md` | The 2026-05 migration from Pipeline B (`semantic-plan` + `formalization-system-v4.md`) to Pipeline A (`intent-system-prompt-v2.ts` + `IntentToIRConverter`). Pipeline B endpoints are now `@deprecated`. |

**Cycle-specific / per-WP snapshots** (not load-bearing; search only when investigating *why* a specific WP exists or when adding a new WP):
- `docs/v6/V6_WP16_INVENTORY.md` — inventory of deterministic ops misrouted to AI (feeds WP-16).
- `docs/v6/V6_PRODUCTION_*.md` — point-in-time production notes.
- `docs/v6/v6-archive/` — pre-rebase architectures (V6_WORKFLOW_DATA_SCHEMA_DESIGN, V6_PURE_DECLARATIVE_*, etc.) — historical only, ignore unless reconstructing why an architectural direction was abandoned.

---

## 3. The IntentContract grammar contract

Authored by Phase 1 LLM, validated by Zod, consumed by Phase 2+. The grammar is the contract between the LLM and the rest of the pipeline — every step kind, every payload shape, every ref kind, every transform op is specified in [`intent-system-prompt-v2.ts`](../../../lib/agentkit/v6/intent/intent-system-prompt-v2.ts).

### Top-level structure

```ts
{
  goal: string,                          // human-readable agent goal
  config: ConfigEntry[],                 // user-input declarations with defaults
  steps: IntentStep[]                    // ordered execution plan
}
```

### Step kinds (16 total — see § 6 of the prompt)

`data_source` · `artifact` · `transform` · `extract` · `classify` · `summarize` · `generate` · `decide` · `loop` · `aggregate` · `deliver` · `notify` · `schedule` · `trigger` · `parallel` · `custom_step`

### ValueRef kinds (how steps reference data)

```ts
{ kind: "ref",      ref: VarName, field?: FieldPath }      // upstream step output
{ kind: "config",   key: ConfigKey }                       // user input
{ kind: "literal",  value: JsonValue }                     // constant
{ kind: "computed", op: "concat"|"format", args: ValueRef[] }
```

`field` accepts dotted paths AND array indices: `files[0].id`, `attachments[*].filename`.

### What changes when (rules of engagement)

| You want to… | Touch this | Don't touch |
|---|---|---|
| Add a new step kind or rename one | The Zod schema + § 6 of `intent-system-prompt-v2.ts` + the matching converter method in `IntentToIRConverter` + compiler routing | Plugin definitions (they don't know about IR kinds) |
| Add a new ValueRef kind | The Zod schema + `resolveValueRef()` in `IntentToIRConverter.ts` + the runtime in `ExecutionContext.resolveVariable` | Phase 1 prompt — only after the runtime supports it |
| Add a new payload-level EP-fidelity rule | The `§ 5.5 EP FIDELITY` pattern table in the prompt (added in WP-53) + a cross-reference in the relevant § 6.x step kind | The compiler — root-cause fixes go in the prompt, not in downstream auto-repair |
| Add a Phase 2 binding annotation | `lib/plugins/definitions/<plugin>.json` (`x-variable-mapping`, `x-input-mapping`, `x-context-binding`, `x-from-artifact`) + `CapabilityBinderV2` consumption | The prompt — annotations are plugin metadata, not LLM behaviour |
| Add a runtime safety net | `StepExecutor` / `ParallelExecutor` / `ExecutionContext` / `StructuralRepairEngine` | The prompt — runtime nets don't "teach" the LLM, they catch its drift |

---

## 4. The V6 Work Protocol (rules any change MUST follow)

These are the same rules CLAUDE.md states under "V6 Work Protocol" — restated here so this skill loads them into your context. Source of truth: [CLAUDE.md § V6 Work Protocol](../../../CLAUDE.md#v6-work-protocol).

### Before starting any V6 work

1. **Open [V6_DOCS_INDEX.md](../../../docs/v6/V6_DOCS_INDEX.md)** — Tier 1 reading order. At minimum:
   - [V6_DESIGN_PRINCIPLES.md](../../../docs/v6/V6_DESIGN_PRINCIPLES.md) — 12 prescriptive rules. If you find yourself writing code that matches an anti-pattern in § 2, it's a probable bug.
   - [V6_OPEN_ITEMS.md](../../../docs/v6/V6_OPEN_ITEMS.md) — check if your problem is already a known open item before treating it as new.

2. **Check the active workplans** for the area you're touching (IntentContract / Execution / Regression).

### After fixing a V6 bug

1. **Update the WP entry** in [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md](../../../docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md): mark status as ✅ Fixed with commit ref + date in the summary table. Add a Change History entry at the bottom (NEWEST FIRST).
2. **Remove the entry from [V6_OPEN_ITEMS.md](../../../docs/v6/V6_OPEN_ITEMS.md)** — don't double-track per the single-source-of-truth principle.
3. **If a new pattern emerged**: extend V6_DESIGN_PRINCIPLES.md (add to an existing principle's Evidence list, or add a new principle).
4. **If a new anti-pattern code shape surfaced**: add it to V6_DESIGN_PRINCIPLES.md § Section 2.

### When deferring a bug (documenting without fixing)

1. **Add a new WP entry** to WEAK_POINTS.md with full diagnosis: problem, evidence, fix shape, why-this-wasn't-caught-earlier.
2. **Add a one-line entry to V6_OPEN_ITEMS.md** pointing at the WP.
3. **Update V6_DOCS_INDEX.md "Open work" snapshot** if priority changes.

### When adding a new regression scenario

Follow the step-by-step procedure in [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md](../../../docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md). After Phase E verification, commit the scenario snapshot (`scenario.json` + `intent-contract.json` + `phase2/phase4` JSON files) and update `scenario.json`'s `phase_e_success` / `phase_e_caveat` fields.

### Single-source-of-truth principle

Every open item has exactly ONE authoritative source: WEAK_POINTS for WPs, INTENT_CONTRACT workplan for grammar tasks, `scenario.json` for untested-scenario notes. **V6_OPEN_ITEMS.md is a pointer index** — never write full detail there; always link to the source.

---

## 5. Current invariants — what new code must NOT regress

The pipeline has accumulated invariants through 55+ weak-point fixes. Each row below is a current-behaviour fact you can rely on AND must not break. WP labels are stable; the full diagnosis lives in WEAK_POINTS.md.

### Phase 1 (prompt + IntentContract emission)

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-15** | AI-declared output_schema for `generate.outputs[]` / `extract.fields[]` must declare item-level shape (array `items`, object `properties`). Depth-1 declarations are REJECTED — no silent auto-repair to `items:{type:"any"}`. |
| **WP-44** | Phase 1 prompt must preserve EP format choices (`html_body` vs plain `body`, "HTML table" framing). Pipeline B's `formalization-system-v4.md` lost these; Pipeline A's prompt (intent-system-prompt-v2.ts) carries the fix. |
| **WP-53** | § 5.5 EP FIDELITY in `intent-system-prompt-v2.ts` instructs the LLM to scan EP for filter / format / recipient / scope constraints and emit each as a matching plugin param. Cross-referenced from § 6.1 DATA_SOURCE (decision-tree item #4) and § 6.12 NOTIFY (EP FIDELITY block). Adds ~400-500 tokens per call. **Do not silently revert this section.** |

### Phase 2 (capability binding + data_schema)

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-2** | Generic field name reconciliation strips prefixes (`message_id` → `id`) at Phase 5; reconciles LLM refs against actual plugin output names. Scoped to step output schemas — does NOT cover scatter iteration variables (`doc_item`, `email`, etc.) — gap documented in the contracts-googledocs-v2ui-pipeline-a scenario. |
| **WP-17** | `DataSchemaBuilder.buildLoopSlots()`: `item_ref` schema is derived from unwrapped array (Bug A), and multi-loop collisions merge `produced_by_loops[]` (Bug B). |
| **WP-18** | `inferSchemaForTransformStep`: LLM-declared `transform.output_schema` wins over inheritance; wrapper-objects walked via `unwrapWrapperToArray()`. |

### Phase 3 (IR conversion)

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-1** | `convertNotify()` uses schema-driven param binding — loads action's parameter schema and matches IntentContract fields (`recipients`, `content`, `options`) to params by name. Falls back to `isSendAction` heuristic if no schema. |
| **WP-49** | `convertNotify` projects `cc` AND `bcc` alongside `to` in `params.recipients` — both schema-aware branch (L1045) AND fallback branch (L1102). Workflows without CC/BCC produce identical output to pre-fix. |
| **WP-39** | D-B18 `select`/`custom` → `map` alias updates `pilotOperation` AND `transformConfig.type` AND `transformedConfig.type` consistently. |
| **WP-41** | `select` restored as a runtime transform op (`StepExecutor.executeTransform` case 'select') — builds a singleton wrapper object from `effectiveConfig.fields`; aliasing it to `map` was syntactic, not semantic. |
| **WP-40** | `IRFormalizer.validateIRStructure` does NOT blind-guess auto-correct filter inputs by appending `attachments`/`items`/`results` etc. Explicit error preferred over silent corruption. |

### Phase 4 (DSL compilation)

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-24** | `enforceContentLevelForExtraction`: schema-driven detection — reads `output_dependencies` to find gated fields, walks all non-fetch IR nodes for refs. Fires per-fetch-node. Covers deterministic-transform consumers (filter, map) in addition to AI/extract consumers (WP-11). |
| **WP-32** | `StructuralRepairEngine` scan validates `flatten.field` against the right level (item-level when input navigates via `{{var.subField}}`, root-level otherwise). |
| **WP-46** | `transform/with_fields` with constants-only expressions returns a singleton object (no per-item augmentation). |

### Runtime (lib/pilot/)

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-10** | After scatter completes: separate success from error objects, throw `ExecutionError("all N items failed")` if zero succeeded. **Do not weaken this** — its absence would let downstream steps emit empty/fabricated content silently. |
| **WP-13** | `ai_processing` steps short-circuit with a deterministic no-data payload when input is empty (Layer 1) and prepend an anti-hallucination instruction otherwise (Layer 2). Both layers stay. |
| **WP-29..31** | `parseDate` is timezone-aware (`getUserTimezone()` hook), `today` returns midnight in user TZ, `date_diff/date_add` use calendar-day arithmetic via `Math.round`. Three-tier disambiguation in `parseDate`. |
| **WP-42** | Gmail plugin's `buildEmailMessage` accepts a single string for `recipients.to/cc/bcc` and coerces to array; `countRecipients` counts as 1 not `string.length`. |
| **WP-45** | `ConditionalEvaluator` `gte`/`lte`/`gt`/`lt` are date-aware via shared WP-29 `parseDate`; `condition.value` defensively wraps bare variable refs. |
| **WP-50** | `DataPreprocessor.detectDataType()`'s `summary` clause requires co-occurrence with `start`/`end`/`startTime`/`organizer`/`attendees` — prevents research/AI/extractor outputs from being mis-routed to EventPreprocessor. **WP-51 (architectural family) is still open** for the other clauses (email / transaction / contact). |
| **WP-52** | `StructuralRepairEngine` builtins set includes `'input'` and `'config'` — neither false-positives as broken refs. |
| **WP-54** | `scatter.continueOnError?: boolean` opt-in on `ScatterGatherStep.scatter`. When `true`, production-mode swallows per-item failures (tagged `{error, item:idx}`) instead of fail-fast re-throw. Default `false`. Compiler plumbing from IR `loop.continueOnError` is a deferred follow-up. |

### Persistence / observability

| Ref | Current behaviour (do not regress) |
|---|---|
| **WP-48** | `/api/create-agent` uses `AgentRepository.create()` (not direct supabase insert), `getUser()` auth, Zod validation with `.passthrough()` on `agent_config`, Pino structured logging with correlation ID. |
| **WP-55** | Phase 1 `intent_contract` and Phase 2 `data_schema` are persisted on `agents.agent_config.ai_context.intent_contract` / `.data_schema`. Diagnosis SQL pattern: `SELECT agent_config -> 'ai_context' -> 'intent_contract' FROM agents WHERE id = '<id>'`. See [V6_DEVELOPER_GUIDE.md § "Diagnosing a Production Agent's Phase 1 Emission"](../../../docs/v6/V6_DEVELOPER_GUIDE.md#diagnosing-a-production-agents-phase-1-emission-wp-55). Pre-WP-55 agents have both = null. |

---

## 6. Decision guide — where to make different kinds of changes

| You want to… | Touch this | Don't touch |
|---|---|---|
| Steer the Phase 1 LLM to choose differently (plugin choice, payload shape, field references) | **`intent-system-prompt-v2.ts`** (§ 5.5 EP FIDELITY, or step-kind § 6.x) | Downstream auto-repair / fuzzy match — those are defence-in-depth, not root cause |
| Fix an LLM emitting a wrong field-ref like `{{var.X}}` where the plugin output has `Y` | Investigate: (a) is the plugin def correct? (b) is the prompt vocabulary showing the right name? (c) is `x-variable-mapping` on the plugin's input param adding to confusion? Then fix at the source. WP-2 reconciliation is a safety net, not the place to add new heuristics. | Don't add a new hardcoded synonym to `resolveFieldMismatch` (CLAUDE.md "No hardcoding"). |
| Add a Phase 2 binding annotation for a new plugin pattern | `lib/plugins/definitions/<plugin>.json` (`x-variable-mapping`, `x-input-mapping`, `x-context-binding`) + verify `CapabilityBinderV2` consumes it | Don't bake the pattern into the binder; the binder reads schemas, schemas don't read the binder |
| Add a new runtime transform op | `StepExecutor.executeTransform` switch + the prompt's `§ 6.3.1` STRUCTURED PRIMITIVES table + `DataSchemaBuilder.inferSchemaForTransformStep` + W2 grammar in the IR converter | Don't add it as `custom_code` natural-language (WP-4 — runtime can't execute NL) |
| Add a new safety net for an LLM emission class | First: can the prompt prevent it? (root cause). If not: add the safety net at the latest safe point, prefer **throw with clear error** over **silently auto-fix** (WP-40 lesson). | Don't add Levenshtein/fuzzy-match auto-fix without a confidence threshold ≥ 3 and a regression scenario covering it |
| Fix a runtime error that doesn't reproduce in fresh re-runs | Pull the agent's persisted `intent_contract` via the WP-55 SQL pattern. The original LLM emission is in `agents.agent_config.ai_context.intent_contract`. | Don't try to LLM re-run for diagnosis — emissions are non-deterministic, the re-run may produce a correct emission that doesn't reproduce the bug (lesson from the contracts-googledocs-v2ui-pipeline-a scenario). |
| Reduce token cost in Phase 1 | Trim sections of `intent-system-prompt-v2.ts` that aren't load-bearing; verify with the regression suite Phase D | Don't drop the EP FIDELITY § 5.5 — its ~500 tokens prevent silent execution failures |
| Add a regression scenario | Use `scripts/build-scenario-from-agent.ts <agent_id> <slug>` to seed, then live-capture via `scripts/test-complete-pipeline-with-vocabulary.ts --output-dir <scenario>/output`; commit only the canonical snapshots (`output/` is gitignored) per the regression plan doc | Don't commit `output/` — it's reproducible and bloats the repo |
| Investigate a "no data" / empty-email failure | Check WP-13 short-circuit logs first, then trace upstream to whichever step emptied the data (WP-50-class preprocessor false positive? WP-32 StructuralRepair rewrite? WP-40 IRFormalizer guess?) | Don't conclude "WP-13 swallowed real data" — WP-13 protects against fabrication; the bug is always upstream |

---

## 7. Out of scope (separate skills / different surfaces)

- **V2 thread-based agent-creation flow** (`/v2/agents/new`, the Phase 1/2/3 chat, the v16 prompt template at `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt`). That's the `agent-creation-flow` skill. The two pipelines meet at the V2 UI's Approve button: agent-creation-flow produces the Enhanced Prompt; this skill takes the EP and runs V6.
- **Pipeline B** (`semantic-plan` + `formalization-system-v4.md` + `IRFormalizer`). Migrated away from in 2026-05 (`V6_PIPELINE_A_MIGRATION.md`). All 7 routes under `/api/v6/generate-*` other than `generate-ir-intent-contract` are `@deprecated`. Don't extend them; deletion is unblocked once any test surfaces still pointing at them are migrated (tracked in OPEN_ITEMS § Pipeline B retirement follow-ups).
- **V4 / V5 legacy generators** (`lib/agentkit/v4/`, `lib/agentkit/v5-generator.ts`). Dormant fallback when `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` is off. Do not extend; the flag retirement is a separate decision tracked in OPEN_ITEMS.
- **Plugin internals beyond their definitions + executors** (per-plugin OAuth flows, the plugin connection UI, etc.). The pipeline only consumes plugin JSON manifests + executor classes; deeper plugin work is the `new-plugin` skill.
- **The V1 agent edit page** (`app/(protected)/agents/[id]/page.tsx`). Reads `agents.pilot_steps` for display/edit — relevant only if you change the DSL shape in a way that breaks rendering there.

---

## 8. Anti-patterns to refuse

Source of truth for the full list: [V6_DESIGN_PRINCIPLES.md § 2 "Anti-patterns"](../../../docs/v6/V6_DESIGN_PRINCIPLES.md). The ones that recur most:

| ❌ Anti-pattern | ✅ Correct |
|---|---|
| "Add a hardcoded `'plugin-X-action-Y' → use mapping Z'` rule to the compiler" | Plugin schemas are the source of truth (CLAUDE.md § Platform Design Principles). Add the mapping as an `x-variable-mapping` / `x-input-mapping` annotation on the plugin JSON; let the binder consume it generically. |
| "When LLM emits field X that doesn't exist in schema, fuzzy-match to closest field" | Only if confidence threshold ≥ 3 AND covered by a regression scenario. Default to **throwing a clear error** — WP-40 (`IRFormalizer.validateIRStructure` blind-guess) is the cautionary tale. |
| "Add an `auto-repair` pass that silently rewrites the DSL on load" | `StructuralRepairEngine` already does this. New auto-repair must (a) be schema-driven, not heuristic; (b) log every fix at WARN with a clear before/after; (c) be covered by a regression scenario that verifies the fix doesn't corrupt valid input. WP-32 is the cautionary tale. |
| "Drop or short-circuit data because it looks empty" | WP-13 is the ONE allowed place. Any preprocessor or transform that filters/drops items must be covered by an explicit user-intent check (don't infer "empty → no data" from a side-effect of preprocessing — WP-50). |
| "Strip the `data_schema` from the IR to save bytes downstream" | The compiler needs it for O10/O20 reconciliation, `attachSlotSchemas`, and now WP-55 persistence. |
| "Make a Phase 2 / Phase 3 / Phase 4 step LLM-call" | Phases 2–4 are deterministic. The pipeline's whole speed argument depends on this. New LLM calls go in Phase 1 (extending the prompt) or runtime (`ai_processing` steps in the DSL). |
| "Disable `WP-10` all-failed throw so the email still sends" | No — empty downstream data fabricates fake content (WP-13 family). The right fix is upstream: prevent items from being added to the scatter if they can't be processed, or use `scatter.continueOnError` for heterogeneous-input scatters. |
| "Add a new top-level field to the IntentContract JSON without a Zod schema update" | The IntentContract is a strict contract. New top-level fields require: prompt grammar update + Zod schema + IR converter handling + WP entry documenting the addition. |
| "Inline raw LLM responses without parsing" | Phase 1 outputs are ALWAYS Zod-validated. Bad LLM emissions get surfaced as parse errors, not silently propagated to Phase 2. |
| "Re-introduce `console.log` for debugging" | Use the existing Pino loggers (`createLogger({ module: ... })` with correlation IDs via `.child({ correlationId })`). |

---

## 9. When you've finished work in this area

1. **`npx tsc --noEmit` clean** on the files you touched.
2. **Unit tests pass** for the area you changed: `npx jest lib/agentkit/v6` for compiler/binder work, `npx jest lib/pilot` for runtime work.
3. **Run the regression suite** if your change touches a shared layer (prompt, IR converter, compiler, runtime): `npx tsx --import ./scripts/env-preload.ts tests/v6-regression/run-regression.ts`. Phase A + D must remain green on all scenarios.
4. **Live Phase E smoke test** if your change could affect production runs — pick the most relevant scenario (or the agent that originally surfaced the bug) and re-run through `/v2/agents/new` end-to-end OR via `scripts/test-live-agent-execution.ts --agent-id <id>`.
5. **Update the WP entry** in WEAK_POINTS.md to ✅ Fixed with commit ref + date in the summary table; add a Change History entry (NEWEST FIRST). **Remove the WP from OPEN_ITEMS.md** if it was listed there (single-source rule).
6. **If a new pattern emerged**: add it to V6_DESIGN_PRINCIPLES.md (existing principle's Evidence list OR a new principle).
7. **If a new regression scenario is warranted**: follow the procedure in V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md; commit only the canonical snapshots (`output/` is gitignored).
8. **Update `docs/v6/V6_DOCS_INDEX.md` "Open work" snapshot** if your work changes the active backlog priority.

---

## 10. Related docs (read these when the change is non-trivial)

**Durable / load-bearing (cross-WP):**
- `docs/v6/V6_DOCS_INDEX.md` — the index. Always check this first.
- `docs/v6/V6_DESIGN_PRINCIPLES.md` — 12 principles + 7 anti-patterns + decision checklist.
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md` — the canonical current design doc (April 2026, ~100 KB).
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_WEAK_POINTS.md` — the active WP catalog. Skim the summary table.
- `docs/v6/V6_OPEN_ITEMS.md` — consolidated backlog. Check before starting.
- `docs/v6/V6_ARCHITECTURE.md` — phase-by-phase deep dive.
- `docs/v6/V6_DEVELOPER_GUIDE.md` — recipes, including the WP-55 diagnosis flow.
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION_SCRIPTS.md` — the QA testing manual.
- `CLAUDE.md` § V6 Work Protocol + § Platform Design Principles.
- `docs/SYSTEM_LOGGING_GUIDELINES.md` — Pino + correlation ID conventions for any new logs.

**Cycle-specific snapshots** (search only when you need the diagnosis behind a specific WP):
- `docs/v6/V6_WP16_INVENTORY.md` — WP-16 deterministic-ops inventory.
- `docs/v6/V6_PIPELINE_A_MIGRATION.md` — 2026-05 Pipeline B → A migration audit trail.
- `docs/v6/V6_AGENT_CREATION_INTEGRATION_PLAN.md` — V2 UI integration plan.
- `docs/v6/V6_SCHEMA_BASED_GROUNDING.md` — schema-only grounding design.
- `docs/v6/V6_PRODUCTION_*.md` — point-in-time production notes.
- `docs/v6/v6-archive/` — pre-rebase architectures; historical only.

**Workplans (where in-progress task lists live):**
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md` — grammar / binder / IR / compiler tasks.
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` — execution simulator strategy.
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_REGRESSION_PLAN.md` — regression test infrastructure design.
- `docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT_EP_KEY_HINTS.md` — EP Key Hints (the `{plugin}__{capability}__{param}` prefix convention).
