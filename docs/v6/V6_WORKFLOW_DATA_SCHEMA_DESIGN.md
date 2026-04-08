# V6 Workflow Data Schema — Design Document

> **Status**: Design validated — pending implementation
> **Date**: 2026-02-26 (validated via dry-run against real IR)
> **Authors**: Barak + Claude

---

## 1. Problem Statement

### What's broken today

The V6 pipeline compiles workflows through 6 phases (P0–P5) and then executes them at runtime. Data flows between steps, but there is **no contract** governing that flow. Every boundary uses `any`:

```
Phase 3 (LLM) → produces IR with `any` operation configs
Phase 4 (compiler) → produces WorkflowStep with `[key: string]: any`
Phase 5 (translator) → accepts `any`, produces `any`
Runtime (executor) → casts to `any` before reading step data
```

This causes three classes of failure:

**1. Silent data mismatches.** Step N produces `{ emails: [] }` but step N+1 references `{{step1.data.messages}}`. No error — the reference resolves to `undefined`, and the workflow "succeeds" without doing anything.

**2. Format ambiguity.** Conditional branch steps are stored under `steps`, `then_steps`, `then`, or `else_steps` depending on which phase produced them. Each consumer has `||` fallback chains (`dslStep.then || dslStep.steps`) to handle multiple formats. When a consumer doesn't have the right fallback, branches are silently dropped.

**3. No compile-time validation.** The compiler doesn't know what a plugin action will return, so it can't validate that downstream references are valid. Errors that should be caught at compile time become runtime mysteries.

### The root cause

Each step produces output with an unknown shape (`any`), and the next step hopes to consume it correctly. There is no single source of truth that declares: "this data exists, it has this shape, it's produced here, and it's consumed there."

---

## 2. Core Concept

### The Workflow Data Schema

A **Workflow Data Schema** is a centralized, field-level type declaration that describes every piece of data flowing through a workflow. It is declared once (in Phase 3), validated (in Phase 4), and enforced (at runtime).

Instead of steps referencing each other's raw output:
```
{{step1.data.emails}}          ← fragile, coupled to step ordering
```

Steps reference named paths on the shared schema:
```
{{raw_emails}}                 ← stable, self-documenting, validated
{{raw_emails.total_found}}     ← field access on a declared schema
```

Every step declares which schema path it **reads from** and which it **writes to**. The schema is the contract.

### Design principles

1. **Field-level granularity.** The schema declares individual field names and types, not just top-level types. This catches "field `sender` doesn't exist" at compile time.

2. **Plugin schemas as source of truth.** Plugin definition files already have complete `output_schema` with field-level detail. For action steps, the schema is derived from the plugin — not invented by the LLM.

3. **Compiler infers when possible.** Shape-preserving transforms (filter, sort, deduplicate) don't need LLM-declared output schemas — the compiler infers them from the input schema.

4. **Fail loud, not silent.** When runtime data doesn't match the declared schema, execution stops with a descriptive error showing expected vs. received shape. No silent degradation.

5. **No backward compatibility.** This replaces the current variable reference system entirely. No `||` fallback chains, no dual modes.

### Schema source categories

Not all slots get their schema the same way. The dry-run revealed three distinct categories, each with a different trust level:

| Step type | Schema source | Who populates | Trust level |
|---|---|---|---|
| **Plugin action** (fetch, deliver, file_op) | Plugin definition `output_schema` | Compiler — auto-populated, deterministic | High — plugin definitions are tested |
| **AI step** (transform, generate, extract) | LLM-declared `output_schema` on the node | LLM — enforced by prompt + compiler validation | Medium — depends on prompt quality |
| **Loop item variable** | Derived from parent array's `items` schema | Compiler — unwraps one array level | High — mechanical derivation |

This means the LLM only needs to declare schemas for AI steps and shape-changing transforms. Plugin steps and loop items are automatic. In a typical workflow, this reduces the LLM's schema burden to ~30% of nodes.

### AI output schema depth requirement (CRITICAL)

When an AI step outputs structured data (objects or arrays), the `output_schema` must declare the **full item-level shape** — not just the top-level type with a text description.

**Rejected (too shallow):**
```json
"filtered_leads": { "type": "array", "description": "Array of lead objects with Date, Name..." }
```

**Required (full depth):**
```json
"filtered_leads": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "Date": { "type": "string" },
      "Lead Name": { "type": "string" },
      "Stage": { "type": "number" }
    }
  }
}
```

**Why this is critical:** Downstream steps reference fields inside these structures (`{{filter_result.filtered_leads}}`). Loop nodes derive item schemas from the array's `items`. Without the full item schema, the compiler cannot validate field references — and the entire design fails at exactly the points where it matters most (AI→plugin boundaries, array→loop-item derivation).

The Phase 4 compiler must **reject** any AI step `output_schema` where an array field lacks an `items` definition, or an object field lacks `properties`.

---

## 3. Design Validation — Dry-Run Against Real IR

### 3.1 Methodology

To validate this design before implementation, we ran a real workflow through the V6 pipeline and captured the Phase 3 IR output. We then manually walked through every node and asked:
1. Can we build a DataSlot for this node's output?
2. Does every input reference resolve to an existing slot with correct type?
3. Does the schema chain hold across step boundaries?

### 3.2 Test workflow

**Prompt:** "Read leads from Google Sheet, filter to Stage=4, email a summary table to me, and email each sales person only their relevant leads."

**IR produced:** 9 nodes — `fetch_leads` → `normalize_and_filter` → `check_empty` → (branch: `send_empty_notification` | `build_main_html_table` → `group_by_sales_person` → `send_main_email` → `loop_sales_persons` → `send_sales_person_email`)

### 3.3 Slot-by-slot walkthrough results

| Node | Type | Slot produced | Schema source | Input validates? | Output validates? |
|---|---|---|---|---|---|
| `fetch_leads` | plugin (google-sheets.read_range) | `sheet_data` | Plugin definition | N/A (first step) | Yes — `values: string[][]`, `row_count: integer`, etc. |
| `normalize_and_filter` | AI (transform) | `filter_result` | LLM-declared | Yes — `sheet_data.values` is `array` | Yes — but needs full item depth (gap found) |
| `check_empty` | choice | (none) | N/A | Yes — `filter_result.filtered_leads` is `array`, `is_empty` valid | N/A — routes only |
| `send_empty_notification` | plugin (google-mail.send_email) | `empty_email_result` | Plugin definition | Yes — all literals | Yes — unused but valid |
| `build_main_html_table` | AI (generate) | `main_html` | LLM-declared | Yes — `filter_result.filtered_leads` is `array` | Yes — `html_body: string` (complete) |
| `group_by_sales_person` | AI (transform) | `grouped_data` | LLM-declared | Yes — `filter_result.filtered_leads` is `array` | Yes — but needs full item depth (gap found) |
| `send_main_email` | plugin (google-mail.send_email) | `main_email_result` | Plugin definition | Yes — `main_html.html_body` is `string` → matches `body` param | Yes — unused but valid |
| `loop_sales_persons` | loop | `current_group` (item), `sales_person_email_results` (gather) | Compiler-derived | Yes — `grouped_data.groups` is `array` | Yes — item schema derived from array items |
| `send_sales_person_email` | plugin (google-mail.send_email) | `sp_email_result` | Plugin definition | Yes — `current_group.sales_person` is `string`, `current_group.html_table` is `string` | Yes — collected by loop |

### 3.4 Key findings

**1. The design works end-to-end.** Every binding in the 9-node workflow resolves through the schema. The full chain — plugin output → AI transform → AI generate → plugin input → loop → inner plugin — is type-checkable at compile time.

**2. AI output_schema depth is the critical gap.** The current LLM produces `type: array` with a text `description` instead of a formal `items` schema. Steps 2 and 6 both had this gap. Without fixing this in the Phase 3 prompt, the compiler cannot validate field references for 3 of 9 nodes. This is the **single highest-priority requirement** for the Phase 3 prompt update.

**3. Cross-step type validation is the highest-value check.** The most valuable validations are at boundaries where data crosses between different step types:
- AI output → plugin input (Step 5→7: `html_body` string → `body` param)
- AI output → loop item derivation (Step 6→8: `groups` array → `current_group` item)
- Loop item → inner step input (Step 8→9: `current_group.sales_person` → `to` param)

These are the exact points where today's `any` types hide misalignments.

**4. Compiler-derivable schemas reduce LLM burden.** Of 9 nodes, only 3 require LLM-declared schemas (the AI steps). Plugin steps (4 nodes) get schemas from plugin definitions. Loop items and gather outputs (1 node) are compiler-derived. The choice node produces no data. This means the LLM's schema responsibility is limited to ~30% of nodes.

**5. Branch scope is simpler in practice.** The conditional (`check_empty`) creates two branches, but both terminate at `end`. No step after the conditional merge needs data from either branch. Branch-scoped tracking is needed for correctness, but the common case is straightforward.

---

## 4. Schema Specification

### 3.1 TypeScript Types

**New file:** `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts`

```typescript
/**
 * Scalar types a schema field can hold.
 */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any';

/**
 * A single field within an object schema.
 * Recursive: an object field's `properties` contains more SchemaField entries.
 */
export interface SchemaField {
  type: SchemaFieldType;
  description?: string;
  required?: boolean;

  // Object fields
  properties?: Record<string, SchemaField>;

  // Array fields
  items?: SchemaField;

  // Union fields (for conditional branches that produce different shapes)
  oneOf?: SchemaField[];

  // Origin tracking
  source?: 'plugin' | 'ai_declared' | 'inferred' | 'user_input';
}

/**
 * A named entry in the workflow data schema.
 * This is the top-level data slot that steps read from and write to.
 */
export interface DataSlot {
  schema: SchemaField;
  scope: 'global' | 'loop' | 'branch';
  produced_by: string;        // node ID that writes to this slot
  consumed_by?: string[];     // node IDs that read from this slot
}

/**
 * The workflow-level data schema.
 * Every named data path is declared here.
 * Steps reference these names in {{...}} expressions.
 */
export interface WorkflowDataSchema {
  slots: Record<string, DataSlot>;
}
```

### 3.2 Integration with IR types

In `declarative-ir-types-v4.ts`, `ExecutionGraph` changes:

```typescript
export interface ExecutionGraph {
  start: string;
  nodes: Record<string, ExecutionNode>;
  data_schema: WorkflowDataSchema;  // NEW — replaces variables
  metadata?: { ... };
}
```

`VariableDefinition` is removed. `InputBinding.variable` and `OutputBinding.variable` now reference **slot names** in `data_schema.slots`.

### 3.3 Schema examples by data shape

**Object (plugin action output):**
```json
"search_results": {
  "schema": {
    "type": "object",
    "properties": {
      "emails": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": { "type": "string" },
            "subject": { "type": "string" },
            "from": { "type": "string" },
            "date": { "type": "string" },
            "snippet": { "type": "string" },
            "attachments": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "filename": { "type": "string" },
                  "mimeType": { "type": "string" },
                  "attachment_id": { "type": "string" }
                }
              }
            }
          }
        }
      },
      "total_found": { "type": "number" }
    },
    "source": "plugin"
  },
  "scope": "global",
  "produced_by": "fetch_emails"
}
```

**Array (gathered loop output):**
```json
"all_invoices": {
  "schema": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "vendor": { "type": "string" },
        "amount": { "type": "number" },
        "date": { "type": "string" },
        "category": { "type": "string" }
      }
    },
    "source": "inferred"
  },
  "scope": "global",
  "produced_by": "loop_emails"
}
```

**Primitive (reduce output):**
```json
"total_amount": {
  "schema": { "type": "number", "source": "inferred" },
  "scope": "global",
  "produced_by": "calculate_total"
}
```

**Union for conditional branches:**
```json
"digest_body": {
  "schema": {
    "oneOf": [
      {
        "type": "string",
        "description": "Empty results message"
      },
      {
        "type": "string",
        "description": "HTML table of found invoices"
      }
    ],
    "source": "ai_declared"
  },
  "scope": "global",
  "produced_by": "check_empty_results"
}
```

### 3.4 Scatter-gather item scope

For loops, the schema declares both the **array being iterated** and the **per-item shape**:

```json
"raw_emails": {
  "schema": {
    "type": "array",
    "items": { "type": "object", "properties": { "id": {}, "subject": {}, "..." : {} } }
  },
  "scope": "global",
  "produced_by": "fetch_emails"
},

"current_email": {
  "schema": {
    "type": "object",
    "properties": { "id": {}, "subject": {}, "...": {} },
    "source": "inferred"
  },
  "scope": "loop",
  "produced_by": "loop_emails"
},

"all_transactions": {
  "schema": {
    "type": "array",
    "items": { "type": "object", "properties": { "vendor": {}, "amount": {}, "...": {} } },
    "source": "inferred"
  },
  "scope": "global",
  "produced_by": "loop_emails"
}
```

The compiler **infers** `current_email.schema` from `raw_emails.schema.items`. The gather output `all_transactions.schema.items` is inferred from the loop body's output slot schema.

---

## 5. Phase-by-Phase Changes

### 5.1 Phase 3: IR Formalization (LLM declares the schema)

**What changes:**
- The LLM system prompt (`formalization-system-v4.md`) gets a new "Workflow Data Schema" section replacing the old "Variable System" section
- The LLM must declare `data_schema.slots` as part of the IR output
- Plugin output schemas are injected into the prompt in full JSON (not just field name summaries)
- Post-LLM validation checks that `data_schema` exists and is structurally valid

**Schema declaration rules for the LLM:**

| Step type | Who declares output schema | Source field |
|---|---|---|
| Action (fetch/deliver/file_op) | LLM copies from plugin `output_schema` | `plugin` |
| AI processing | LLM declares expected extraction fields | `ai_declared` |
| Shape-preserving transform (filter, sort, deduplicate) | Not declared — compiler infers | `inferred` |
| Shape-changing transform (map, reduce, group_by) | LLM declares output shape | `ai_declared` |
| Loop item variable | Not declared — compiler infers from parent array's `items` | `inferred` |
| Loop gather output | Not declared — compiler infers from loop body output | `inferred` |

**CRITICAL — Array item depth enforcement (from dry-run validation):**

When the LLM declares an `output_schema` for an AI step, any `array` field MUST include a full `items` schema with `properties` — not just `type: array` with a text `description`. Similarly, any `object` field MUST include `properties`.

The Phase 4 compiler MUST reject schemas that violate this rule. Without it, the compiler cannot:
- Validate field references on array items (e.g., `{{filter_result.filtered_leads[0].Date}}`)
- Derive loop item schemas (loop iterates over array → item shape comes from `items`)
- Cross-validate AI output fields against downstream plugin input parameters

This was the **only design gap** found during the dry-run. See Section 3 for details.

**Reference syntax in nodes:**
- `{{slot_name}}` — references entire slot value
- `{{slot_name.field}}` — references a field within the slot
- `{{slot_name.nested.path}}` — deep field access
- No step ID references allowed (`{{step1.data.emails}}` is invalid)

**Files modified:**
- `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`
- `lib/agentkit/v6/semantic-plan/IRFormalizer.ts`
- `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts`
- `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict-v4.ts`

### 5.2 Phase 4: Compilation (compiler validates schema)

**What changes:**

1. **New validation phase** in `ExecutionGraphValidator.ts`: validates that every `InputBinding.variable` and `OutputBinding.variable` maps to a declared slot, and that `produced_by` references existing nodes.

2. **Plugin schema cross-validation** in `ExecutionGraphCompiler.ts`: for action steps, the compiler loads the plugin's `output_schema` via `PluginResolver` and validates that the declared slot schema matches. If the LLM declared a field that doesn't exist in the plugin schema → compile error.

3. **Schema attachment**: the compiler attaches `output_schema` (from the slot's schema) to each compiled `WorkflowStep`, so the runtime can validate without re-reading the IR.

4. **Shape-preserving inference**: for filter/sort/deduplicate transforms, the compiler verifies the output slot's schema matches the input slot's schema.

5. **Loop validation**: the compiler verifies the item variable's schema matches the parent array's `items` schema, and the gather output is typed as an array.

**Files modified:**
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`
- `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts`
- `lib/pilot/types/pilot-dsl-types.ts` (adds `output_schema`, `input_schema` to `WorkflowStep`)

### 5.3 Phase 5: Translation (pass-through)

**What changes:**
Minimal. The `translateStep` method in `V6PipelineOrchestrator.ts` copies `output_schema` and `input_schema` from DSL steps to PILOT steps. No format conversion needed — the schema fields pass through as-is.

**Files modified:**
- `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts`

### 5.4 Runtime: Execution

**What changes:**

1. **Schema registration**: at execution start, `WorkflowPilot` registers the `data_schema` with `ExecutionContext` so the runtime knows the expected shape for each slot.

2. **Simplified variable resolution**: `ExecutionContext.resolveSimpleVariable()` is simplified from a complex prefix-based switch (`step*`, `input`, `var`, `current`, `item`) to a unified slot-based lookup. All references resolve against `context.variables` where keys are slot names.

3. **Post-step validation**: after each step executes, the runtime validates the actual output against the declared `output_schema`. On mismatch → fail loud with descriptive error showing expected type, actual type, slot name, and step ID.

**Files modified:**
- `lib/pilot/ExecutionContext.ts`
- `lib/pilot/WorkflowPilot.ts`
- `lib/pilot/StepExecutor.ts`

---

## 6. Variable Reference Migration

### Before (current system)
```
{{step1.data.emails}}              → step output by ID
{{step1.data.emails[0].subject}}   → nested field on step output
{{var.all_emails}}                 → named variable
{{input.spreadsheet_id}}           → user input
{{current_email.subject}}          → loop item
```

Multiple namespaces (`stepOutputs`, `variables`, `inputValues`) with complex root detection.

### After (schema system)
```
{{search_results.emails}}          → slot field
{{search_results.emails[0].subject}} → nested field on slot
{{all_emails}}                     → slot (direct)
{{input.spreadsheet_id}}           → user input (unchanged)
{{current_email.subject}}          → loop-scoped slot field
```

One namespace: everything is a slot in `data_schema`. The `input` prefix remains for user-provided workflow inputs.

### Resolution logic

```typescript
resolveSimpleVariable(path: string): any {
  const parts = parsePath(path);
  const root = parts[0];

  // 1. User inputs
  if (root === 'input' || root === 'inputs') {
    return getNestedValue(inputValues, parts.slice(1));
  }

  // 2. Data schema slots (all step outputs, named variables, loop items)
  if (variables.hasOwnProperty(root)) {
    const value = variables[root];
    return parts.length > 1 ? getNestedValue(value, parts.slice(1)) : value;
  }

  // 3. Not found → descriptive error
  throw new VariableResolutionError(
    `Unknown data slot: "${root}". Available: ${Object.keys(variables).join(', ')}`,
    path
  );
}
```

---

## 7. Step Type Handling

### 7.1 Action steps (fetch, deliver, file_op)

| Aspect | How it works |
|---|---|
| **Reads from** | Input slot via `node.inputs[0].variable` + optional `.path` |
| **Writes to** | Output slot via `node.outputs[0].variable` |
| **Schema source** | Plugin `output_schema` from plugin definition file |
| **Compiler validates** | Declared slot schema matches plugin output_schema fields |
| **Runtime validates** | Actual plugin response matches declared slot schema |

### 7.2 Transform steps

| Aspect | Shape-preserving (filter, sort, deduplicate) | Shape-changing (map, reduce, group_by) |
|---|---|---|
| **Schema source** | Compiler infers: output schema = input schema | LLM declares in `data_schema` |
| **Compiler validates** | Output slot type matches input slot type | Output slot exists and is declared |
| **Runtime validates** | Output matches inferred schema | Output matches declared schema |

### 7.3 AI processing steps

| Aspect | How it works |
|---|---|
| **Reads from** | Input slot (document/text content) |
| **Writes to** | Output slot with LLM-declared fields |
| **Schema source** | LLM declares extraction fields in `data_schema` (matches `ai.output_schema`) |
| **Compiler validates** | `ai.output_schema.fields` match the slot's `schema.properties` |
| **Runtime validates** | AI extraction result matches declared field types |

### 7.4 Conditional steps (choice nodes)

| Aspect | How it works |
|---|---|
| **Condition reads** | Slot field (e.g., `{{search_results.emails}}` with `is_empty` operator) |
| **Then-branch writes** | To branch-specific slots OR shared slot with `oneOf` |
| **Else-branch writes** | To branch-specific slots OR shared slot with `oneOf` |
| **Compiler validates** | If shared slot uses `oneOf`, branch count matches rule count |
| **Runtime validates** | Output matches at least one `oneOf` branch schema |

### 7.5 Scatter-gather steps (loop nodes)

| Aspect | How it works |
|---|---|
| **Iterates over** | Global-scoped array slot (e.g., `raw_emails`) |
| **Item variable** | Loop-scoped slot inferred from array's `items` schema |
| **Loop body output** | Writes to a loop-scoped slot per iteration |
| **Gather output** | Global-scoped array slot collecting all iteration results |
| **Compiler validates** | Item schema matches array items; gather output is typed as array |
| **Runtime validates** | Input is actually an array; each iteration output matches item schema |

---

## 8. Runtime Validation

### Strategy: fail loud with context

When a step's output doesn't match its declared schema, execution stops immediately with an error message that includes:

```
SCHEMA VIOLATION: Step output does not match declared schema

  Step: step3 (Extract Invoice Fields)
  Slot: invoice_data

  Errors:
    - invoice_data.vendor: required field missing
    - invoice_data.amount: expected type "number" but got "string". Value: "$42.50"

  Actual output (first 500 chars):
    {"date": "2026-01-15", "amount": "$42.50", "category": "office"}

  Expected schema:
    { vendor: string (required), amount: number (required), date: string, category: string }
```

### Future: adaptation layer

Once the strict validation is proven and we see real-world failure patterns, we can add an adaptation layer that attempts automatic coercion (e.g., `"$42.50"` → `42.50` for number fields). This is explicitly deferred — build strict first, adapt later.

### Validation implementation

```typescript
// In ExecutionContext
validateAgainstSchema(slotName: string, data: any): string[] {
  const schema = this.dataSchema[slotName];
  if (!schema) return [];  // No schema = skip validation
  return this.validateValue(data, schema, slotName);
}

validateValue(value: any, schema: SchemaField, path: string): string[] {
  // 1. Null/undefined check against required
  // 2. Type check (array vs typeof)
  // 3. Object property validation (recurse into properties)
  // 4. Array item validation (validate first item as representative)
  // 5. oneOf validation (at least one branch must match)
  // Returns: array of error strings (empty = valid)
}
```

---

## 9. Code Impact

### New files
| File | Purpose |
|---|---|
| `lib/agentkit/v6/logical-ir/schemas/workflow-data-schema.ts` | `SchemaField`, `DataSlot`, `WorkflowDataSchema` type definitions |

### Modified files
| File | What changes |
|---|---|
| `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` | `ExecutionGraph.data_schema` replaces `variables` |
| `lib/agentkit/v6/logical-ir/schemas/declarative-ir-schema-strict-v4.ts` | JSON Schema updated for `data_schema` |
| `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` | New "Data Schema" section, removes "Variable System" |
| `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Injects full plugin schemas, validates `data_schema` post-LLM |
| `lib/agentkit/v6/logical-ir/validation/ExecutionGraphValidator.ts` | New validation phase for schema consistency |
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Plugin schema cross-validation, schema attachment to steps |
| `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Pass-through of schema fields in translator |
| `lib/pilot/types/pilot-dsl-types.ts` | `output_schema`, `input_schema` fields on `WorkflowStep` |
| `lib/pilot/ExecutionContext.ts` | Schema registration, validation methods, simplified resolution |
| `lib/pilot/WorkflowPilot.ts` | Schema registration at start, validation after each step |
| `lib/pilot/WorkflowParser.ts` | Updated normalization for schema-aware steps |
| `lib/pilot/StepExecutor.ts` | Schema validation calls |
| `lib/orchestration/OrchestrationService.ts` | Updated step flattening for all step types |

### Deleted code
| What | Why |
|---|---|
| `VariableDefinition` interface | Replaced by `DataSlot` |
| `initializeVariables()` in compiler | Replaced by schema validation |
| Legacy `step*` root detection in `resolveSimpleVariable()` | Replaced by unified slot lookup |
| `||` fallback chains in translator, executor, parser | Single canonical format, no fallbacks needed |
| Format sniffing in `flattenNestedSteps()` | Single format, explicit field names |

---

## 10. Input-Type Compatibility — Design Decision (Direction #3)

> **Status**: Implemented (2026-04-07) — interim approach, to be revisited as the plugin catalog matures.
> **Files**: `lib/agentkit/v6/capability-binding/input-type-compat.ts` (single source of truth)

### What it is

A **centralized semantic-type vocabulary and compatibility matrix** that governs whether a plugin action's input requirements match the data type produced by an upstream step. For example: `document-extractor.extract_structured_data` requires `from_type: "file_attachment"` — if the upstream data is an email body (`semantic_type: "email_message"`), the binder rejects the binding and falls back to AI extraction.

### Why this approach (and what's interim about it)

The vocabulary is a **hand-maintained const array** in `input-type-compat.ts`. The TypeScript types (`FromType`, `ToType`) and the runtime validation set (`KNOWN_SEMANTIC_TYPES`) are derived from it automatically. This was chosen over:

- **Open vocabulary** (plugins declare any string) — rejected because it leads to drift and untestable compatibility (Q-C1 decision)
- **JSON-Schema-only approach** (infer types from `type: "object"` + property shapes) — this is what the heuristic fallback does today, but it's fragile (property-name matching) and will be phased out

The interim aspects:

1. **Heuristic marker sets** (`FILE_PROPERTY_MARKERS`, `TEXT_PROPERTY_MARKERS`, `FILE_PARAM_NAMES`) exist as fallbacks for plugin definitions that lack explicit `x-semantic-type` annotations. These should shrink and eventually be deleted as plugin definitions are annotated. Track their firing rate to know when they're dead code.

2. **`PRIMARY_CONTENT_PARAMS`** is a hand-maintained set that scopes which action parameters trigger type-checking. Ideally, plugin definitions would explicitly mark which parameter is the "primary content input" via an annotation (e.g., `x-primary-input: true`), removing the need for this set. That annotation doesn't exist yet.

3. **The validator** (`validatePluginTypeAnnotations.ts`) catches new semantic type values that aren't in the canonical list. This ensures the vocabulary stays coherent, but it's a lint-time check — not a compile-time guarantee.

### How to maintain it

All type definitions flow from `input-type-compat.ts`:

```
FROM_TYPE_VALUES (const array)     → add new types here
TO_TYPE_EXTRAS (const array)       → add new types here
FromType / ToType                  → auto-derived, don't edit
KNOWN_SEMANTIC_TYPES               → auto-derived, used by plugin validator
TYPE_COMPAT                        → add compatibility rules here
```

See the header comment in `input-type-compat.ts` for the full maintenance guide.

### When to revisit

- When >80% of plugin actions have `x-semantic-type` annotations → delete heuristic marker sets
- When a plugin needs a type not in the vocabulary → extend `FROM_TYPE_VALUES` + `TYPE_COMPAT`
- When the `PRIMARY_CONTENT_PARAMS` heuristic causes false positives → consider adding `x-primary-input` annotation to plugin parameter schemas

---

## 11. Future: User-Facing SchemaViolationError Reporting (Direction #2)

> **Status**: Not yet implemented — future enhancement
> **Depends on**: Direction #2 (Runtime AI Output Validation) — `AIOutputValidator.ts`, `SchemaViolationError`

### Problem

When `SchemaViolationError` is thrown at runtime (AI step output doesn't match declared schema after one repair attempt), the error propagates through `WorkflowPilot` and the execution is marked `status: 'failed'`. The structured diagnostic (expected shape, actual shape, field-level validation errors, truncated LLM response) is logged and stored in `error.details`, but it is **not surfaced to the user in a meaningful way**.

Today the user sees a generic "Execution failed" message. They have no visibility into:
- Which step failed and why
- What the LLM actually returned vs what was expected
- Whether the issue is a prompt problem (LLM misunderstood the task) or a schema problem (declared schema doesn't match realistic output)

### What needs to happen

1. **Execution results UI**: When `WorkflowPilot` catches a `SchemaViolationError`, the `ExecutionResultsBuilder` should extract the structured `details` and format them into the execution report visible to the user. Show: step name, expected vs actual shape side-by-side, specific field errors.

2. **Actionable guidance**: The error message should suggest next steps — e.g., "The AI step produced a 'string' where an 'array' was expected. This may indicate the prompt needs to be more explicit about output format, or the output_schema declaration needs to be updated."

3. **Shadow Agent integration**: The `ShadowAgent` (execution observer) should detect `SchemaViolationError` patterns and suggest prompt or schema fixes in its post-execution analysis.

4. **Notification for scheduled agents**: When a scheduled (unattended) agent hits a `SchemaViolationError`, the user should be notified — not just have a silent failure in the execution log. Consider email/in-app notification for agents that were previously succeeding but start failing schema validation.

---

*V6 Workflow Data Schema — Neuronforge*
