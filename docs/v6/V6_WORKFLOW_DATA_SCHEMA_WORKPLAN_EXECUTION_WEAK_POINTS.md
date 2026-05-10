# V6 Pipeline — Execution Weak Points & Hardening Plan

> **Last Updated**: 2026-05-10
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplan**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md)

## Overview

This document catalogs the weak points identified during Phase E live execution testing of two scenarios (Gmail Urgency Flagging Agent, High-Qualified Leads Per-Salesperson Email Agent). Each weak point was either directly encountered as a bug (D-B7 through D-B13) or identified as a risk that will surface with new enhanced prompts and plugin combinations.

The weak points are ordered by likelihood of causing failures as new scenarios are added.

---

## Status Summary

| ID | Issue | Priority | Status |
|----|-------|----------|--------|
| [WP-1](#wp-1-intentcontract--ir-converter-notify-step-handling) | `notify` step assumes `send_email` — non-send actions get wrong params | P1 | ✅ Fixed — schema-driven param binding |
| [WP-2](#wp-2-field-name-mismatches-between-plugin-output-and-downstream-references) | Field name mismatches (`message_id` vs `id`) across plugins | P0 | ✅ Fixed — Phase 2 reconciliation + Phase 5 safety net |
| [WP-3](#wp-3-ai_processing-steps-inside-scatter-gather) | `ai_processing` inside scatter-gather — memory/prompt/routing issues | P1 | ✅ Fixed — `callLLMDirect()` bypasses runAgentKit |
| [WP-4](#wp-4-transformmap-with-custom_code-natural-language) | `transform/map` with `custom_code` — runtime can't execute NL | P0 | ✅ Fixed — structured `mapping` from Phase 1 |
| [WP-5](#wp-5-transformgroup-output-shape) | `transform/group` returns wrong shape for scatter-gather | P2 | ✅ Fixed — compiler emits explicit config |
| [WP-6](#wp-6-structured-config-reference-objects) | Structured ref objects `{kind:"config"}` not resolved | P2 | ✅ Fixed — all kinds handled |
| [WP-7](#wp-7-gmail-label-resolution-timing) | Gmail label 409 conflict on concurrent creation | P3 | ✅ Fixed with 409 recovery |
| [WP-8](#wp-8-email-subjectbody-encoding) | Non-ASCII chars garbled in email headers | P3 | ✅ Fixed — all headers MIME-encoded |
| [WP-9](#wp-9-phase-ad-mock-gap--llm-output-shape-validation) | Mocks don't validate LLM output shape | P3 | ⬜ Deferred (F7 — has token cost) |
| [WP-10](#wp-10-scatter-gather-error-handling--silent-success-with-error-data) | Scatter-gather reports success with error data | P2 | ✅ Fixed — error filtering + all-failed detection |
| [WP-11](#wp-11-search_emails-missing-content_level-full-when-body-is-needed-downstream) | `search_emails` compiled without `content_level=full` — body empty, downstream extraction silently fails | P0 | ✅ Fixed — schema-driven auto-fix in IR converter |
| [WP-12](#wp-12-document-extractor-bound-to-free-text-email-body-instead-of-ai_processing) | `document-extractor` bound to free-text email body — produces "Unknown" placeholders | P0 | ✅ Fixed — binder reroutes non-file inputs to AI extraction |
| [WP-13](#wp-13-ai_processing-hallucinates-on-empty-input) | `ai_processing` fabricates plausible-looking data when input array is empty | P0 | ✅ Fixed — empty-input guard + prompt guardrail |
| [WP-14](#wp-14-scatter-gather-token-bloat--extract-step-output-shape) | Scatter-gather merges full item with extract output → token bloat; I3 doesn't parse `fields` schema; runtime safety misroutes already-text content | P0 | ⚠️ Partial fix (multi-step scatter body case reopened 2026-04-14) |
| [WP-15](#wp-15-ai-declared-output-slots-lose-item-level-shape) | AI-declared output slots lose item-level shape — `generate.outputs[]` / `extract.fields[]` grammar can't express array `items` or object `properties`, so AI slots in `data_schema` are depth-1 (`{type:"array"}` with no item structure). Compiler auto-repairs to `items:{type:"any"}`, masking the gap. Same fabrication-risk class as AliExpress (WP-13) — no schema → no validator can catch downstream silent fabrication. | P0 | ⬜ Not started — see [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks 0.4–0.6 + 2.11 |
| [WP-16](#wp-16-deterministic-data-operations-routed-to-ai-step) | Deterministic data operations (filter, column projection, anti-join, dedup) routed to `ai_processing` because Phase 1 vocabulary doesn't expose workflow primitives — the LLM defaults to `generate/internal` for any internal data op. Each unnecessary AI step adds cost, latency, and fabrication risk; compounds WP-13/WP-15 by inserting LLM boundaries where none were needed. | P1 | 🟡 In progress — task 0.7 ✅ done (see [V6_WP16_INVENTORY.md](./V6_WP16_INVENTORY.md)); tasks 0.8–0.12 ⬜ pending |
| [WP-17](#wp-17-loop-item-slot-misderived-from-nested-array-and-overwritten-across-loops) | Loop `item_ref` slot has the wrong schema (full wrapper object instead of unwrapped per-element shape) when the iterated array is nested under a field, AND the slot is overwritten when multiple loops share an `item_ref` name. Two bugs in `DataSchemaBuilder.buildLoopSlots()` — declared schema doesn't match the runtime iteration value. Cross-step type validator can't catch downstream errors because the source schema lies. | P1 | ✅ Fixed (2026-05-08) — `DataSchemaBuilder.unwrapWrapperToArray()` + `deriveLoopItemSchema()` for Bug A; `produced_by_loops[]` collision-merge for Bug B. 9 unit tests in `__tests__/DataSchemaBuilder.wp17-wp18.test.ts`. |
| [WP-18](#wp-18-shape-preserving-transform-inherits-schema-from-wrong-slot-when-compiler-auto-unwraps-input) | Shape-preserving transforms (`filter`, `sort`, `dedupe`, `flatten`) inherit schema from the input slot per design — but when the input is a plugin wrapper (e.g., Sheets `{values, row_count, ...}`) the compiler auto-injects a `rows_to_objects` transform that unwraps to an object array. `DataSchemaBuilder` doesn't anticipate this and inherits the wrapper schema instead of the post-unwrap shape. The LLM's explicit `transform.output_schema` declaration — which would have caught the discrepancy — is ignored. Same "schema lies about reality" failure class as WP-13/15/17. | P1 | ✅ Fixed (2026-05-08) — `inferSchemaForTransformStep()` now honors LLM-declared `transform.output_schema` first (Bug A), then walks wrapper-objects via `unwrapWrapperToArray()` for shape-preserving inheritance (Bug B, mirrors Phase 4 auto-inject at schema level). 5 unit tests in same file. |
| [WP-19](#wp-19-ai_processing-on-array-input-bulk-vs-per-item) | `ai_processing` step takes an array input and produces an array output (one extraction per item) but runs as a single bulk LLM call instead of a scatter-gather. The LLM emits `kind: "generate"` with `input: <array>` and trusts the LLM to "do for each" inside one prompt. Token-bloat risk on unbounded inputs (WP-14 family) plus higher hallucination/omission rates than per-item processing. Compiler doesn't auto-rewrite because bulk is legitimate for some patterns (cross-item summarization). | P2 | ⬜ Future — observed in `aliexpress-delivery-tracker/output/phase4-pilot-dsl-steps.json` step3 (2026-05-10). Three intervention options: (A) Phase 1 prompt steering, (B) compiler detection + warning, (C) compiler auto-rewrite. Deferred — current scenarios survive small inboxes; revisit when bulk-call failure (token bloat or item drop) is observed in Phase E. |
| [WP-20](#wp-20-project_columnby_index-rejects-object-rows-after-wp-sr-auto-inject) | `transform/project_column` with `column.kind: "by_index"` hard-throws when the input is an array of objects rather than a raw 2D array. After WP-SR landed (auto-inject of `rows_to_objects` for Sheets-derived inputs), upstream rows are now always objects with header keys — but the LLM still emits `by_index: N` based on the column position it saw in the user's prompt ("column E, index 4"). The compiler used to pass raw 2D arrays through, so `by_index` worked; post-WP-SR it doesn't. Sister bug to the original WP-SR `column_N` failure in `transform/map`. | P1 | ✅ Fixed (2026-05-10) — `transformProjectColumn` now tolerates object rows via `Object.values(row)[index]` fallback, mirroring the `transform/map` `column_N` tolerance. |
| [WP-21](#wp-21-contains_any-rejects-string-rhs-when-config-value-is-comma-separated) | `contains_any` operator hard-throws when the right-hand side resolves to a string instead of an array. The LLM commonly emits keyword-list config values as comma-separated strings (`"complaint, refund, angry, not working"`) because that's how the user wrote them in their prose prompt. The runtime requires an array. Same shape as WP-20 — LLM emission style mismatched with the runtime contract; runtime tolerance is the cleanest fix. | P1 | ✅ Fixed (2026-05-10) — runtime tolerance via `coerceToArray()` helper in `ConditionalEvaluator`. `contains_any`, `in`, and `not_in` all accept comma-separated strings (split + trim). 11 new unit tests covering canonical complaint-logger pattern + whitespace handling + case-insensitivity + regression guards for array RHS. |
| [WP-22](#wp-22-set_differencereference-bare-refname-not-resolved-by-runtime) | `transform/set_difference` runtime calls `context.resolveVariable(config.reference)` but the IR converter emits the reference as a bare RefName (`"existing_message_ids"`). `resolveVariable` requires `{{...}}` template syntax — bare strings are returned as-is, so the runtime sees the literal string `"existing_message_ids"` and throws `set_difference.reference must resolve to an array; got string`. Convention mismatch between IR converter and runtime. | P1 | ✅ Fixed (2026-05-10) — both surfaces fixed: (A) IR converter now emits `{{varname}}` (one-line change in `convertTransform` for `set_difference`), (B) runtime defensively wraps bare strings before resolving (handles existing phase4 files without recompile). 3 new unit tests with strict `resolveVariable` stub verifying both bare and templated forms resolve correctly. |
| [WP-23](#wp-23-transformmap-with-numeric-key-field_mapping-produces-objects-not-2d-arrays) | `transform/map` with `field_mapping` whose target keys are numeric strings (`"0"`, `"1"`, ...) is the LLM's expression of "convert objects to 2D array for Sheets append". The runtime currently builds a plain object (`mapped[targetField] = item[sourceField]`), producing `[{"0": ..., "1": ...}, ...]` — an array of objects with numeric-string keys, NOT the 2D array the LLM intended. Downstream `google-sheets.append_rows` expects a 2D array of cell values, gets these weird objects, returns null, and the runtime errors as a calibration stop. Sister bug to WP-20 (object-row tolerance) and WP-SR (`column_N` source keys) — same shape-mismatch class. | P1 | ✅ Fixed (2026-05-10) — runtime tolerance in `transformMap` Mode 0. Detection: all target keys match `/^\d+$/`. When detected, emit an array per item (length = `max(numericKeys) + 1`, missing slots null) instead of an object. 10 new unit tests in `transformMap.numeric-keys.test.ts` covering canonical complaint-logger pattern, JSON shape, missing source fields, non-contiguous indices, and 4 regression guards (string keys, mixed keys, WP-SR `column_N`, empty mapping). |
| [WP-24](#wp-24-content_level-not-forced-full-for-deterministic-body-consumers) | Gmail `search_emails` returns `body` empty unless `content_level: 'full'` is set. The existing WP-11 fix forces `content_level: full` when the graph contains an AI step or a deliver-extract action — but it misses workflows where downstream consumers are **deterministic** transforms (filter on `item.body`, map with `field_mapping: {full_email_text: "body"}`). Result: rows append to Sheets but the body column comes through empty. Same root cause as WP-11; WP-24 extends the detection. | P1 | ✅ Fixed (2026-05-10) — schema-driven detection in `enforceContentLevelForExtraction()`. Two new helpers: `getGatedOutputFields(schema)` reads the plugin's `output_dependencies` and returns the union of `unpopulated_fields` (the set of fields populated only at `content_level: full`); `someNodeReferencesGatedField(ctx, gatedFields)` walks all non-fetch IR node configs and detects references via JSON-value match (`"body"`) or path-tail match (`\.body["}\b]`). Fires PER fetch node — precise (skips fetches that produce gated fields no consumer actually reads), generic (any plugin declaring `output_dependencies`), no false positives on substring matches. 17 new unit tests in `enforceContentLevel.wp24.test.ts` covering canonical complaint-logger filter+map pattern, edge cases (malformed deps, empty fields, fetch-skip, substring-FP guard). |
| [WP-25](#wp-25-broaden-positional-key-detection-in-transformmap-mode-0) | The LLM has multiple emission styles for "convert objects to 2D array for Sheets append": `{"0": "field"}` (numeric), `{"column_0": "field"}` (column_N), `{"A": "field"}` (Excel letter), `{"column_A": "field"}` (column_letter). WP-23 only caught the first pattern. The 2nd Phase E run on `complaint-email-logger` emitted the `column_A`-style variant — `transformMap` produced objects with `column_A`/`column_B`/... keys, `append_rows` returned null, runtime calibration-stopped. Sister to WP-23. | P1 | ✅ Fixed (2026-05-10) — **two-layer fix:** (a) **runtime tolerance** in `transformMap` Mode 0 via `parsePositionalKey()` helper that recognizes all four patterns and converts each target key to a numeric index (Excel-style: A=0, B=1, ..., AA=26). When ALL target keys parse as positional, runtime emits a 2D array per row. (b) **prompt steering** in section 6.11 (DELIVER) declaring numeric-string `"to": "0"` as the canonical form for row-oriented destinations and explicitly listing the 3 non-canonical equivalents to avoid. Defense in depth — prompt converges LLM toward one pattern; runtime tolerance handles drift. 12 new unit tests covering each pattern + canonical complaint-logger column_A failure mode + regression guards. |

---

## Weak Points

### WP-1: IntentContract → IR Converter: `notify` step handling

**Severity:** High
**Encountered as:** D-B9
**Status:** ✅ Fixed — schema-driven param binding

**Problem:** `convertNotify()` in `IntentToIRConverter.ts` assumes all `notify` steps are `send_email`. The current fix uses a hardcoded `isSendAction` check (`send_email` or `send_message`). Any new plugin action that the LLM maps to `kind: "notify"` but isn't a send operation will get the wrong params.

**Current fix:** `isSendAction` branch — send actions use `notify.content`, all others use `notify.options`. Works but is heuristic-based.

**Trigger scenarios:**
- Slack: `update_message`, `add_reaction`
- WhatsApp: `mark_message_read`
- Gmail: future `archive_email`, `move_to_folder`
- Any plugin action the LLM categorizes as "notification-like"

**Proposed solution:**

Schema-driven param binding. Instead of guessing based on step kind, look up the target action's parameter schema and map IntentContract fields to matching params:

1. In `convertNotify()`, after determining `plugin_key` and `action`, load the action's `parameters.properties` from the plugin definition
2. Build params by matching IntentContract fields (`notify.options`, `notify.content`, `notify.recipients`) to the action schema's required/optional params by name
3. For `send_email`/`send_message`, the existing content/recipients mapping is correct — keep it as-is
4. For all other actions, iterate `notify.options` entries and resolve each as a param (current behavior)
5. Add validation: if required params aren't satisfied by any source, log a warning

**Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

---

### WP-2: Field name mismatches between plugin output and downstream references

**Severity:** Critical
**Encountered as:** D-B10
**Status:** ✅ Fixed — Phase 2 reconciliation (root cause) + Phase 5 safety net

**Problem:** The IntentContract LLM references fields by the *consuming* action's parameter name (e.g., `message_id` for `modify_email`) rather than the *producing* action's output field name (e.g., `id` from `search_emails`). The compiler has O10 reconciliation but it doesn't cover scatter-gather item variables. The current fix (D-B10) is a string replacement hack that rewrites `.message_id}}` → `.id}}` globally — fragile and Gmail-specific.

**Current fix:** String replacement in `toPilotFormat()` — rewrites `.message_id` to `.id` in all params. Works for Gmail but breaks if a legitimate `message_id` field exists.

**Trigger scenarios:**
- HubSpot: `contact_id` vs `id`, `deal_id` vs `id`
- Google Drive: `file_id` vs `id`, `folder_id` vs `id`
- Slack: `channel_id` vs `id`, `user_id` vs `id`
- Airtable: `record_id` vs `id`, `base_id` vs `id`
- Any cross-plugin data flow where field names differ between producer and consumer

**Proposed solution:**

Generic field reconciliation in the compiler (O10 extension):

1. For every `{{variable.field}}` reference in the DSL, identify the producing step's `output_schema`
2. If `field` doesn't exist in the schema's properties, search for a matching field by:
   a. Suffix match: `message_id` → look for `id` (strip common prefixes: `message_`, `contact_`, `file_`, `deal_`, `channel_`, `user_`)
   b. The plugin definition's `output_schema` is the source of truth for field names
3. If a match is found, rewrite the reference: `{{variable.message_id}}` → `{{variable.id}}`
4. Log the rewrite for traceability
5. If no match is found, flag as a warning in Phase A (F5 already handles missing params, extend to field refs)

This should run in Phase 3.7 (existing O10 location) and cover both top-level and scatter-gather item variables.

**Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (Phase 3.7 O10)

**What was implemented (partial fix):**

Phase 5 field reconciliation with schema registry + upstream tracing. Catches `message_id` → `id` via prefix stripping, case mismatches, underscore/space normalization. Replaces the D-B10 Gmail-specific hack. Works across all plugins for pattern-based mismatches.

**What remains (root cause):**

The core problem is upstream — the IntentContract LLM generates field references based on what it *thinks* the field should be called (from action parameter names or natural language), not what the producing step's schema *actually* contains. The compiler safety net rewrites mismatches after the fact, but:

- It only catches mismatches that match one of the three algorithmic strategies (prefix strip, case, space/underscore). Semantic mismatches like `sender` → `from` are not caught.
- It doesn't prevent the LLM from generating wrong references in the first place.

**Long-term root cause fix (not yet implemented):**

1. **Phase 2 (CapabilityBinder):** When binding field references, validate that `{kind: "ref", field: "X"}` exists in the source variable's output_schema. If not, resolve to the correct field name at binding time — before it enters the IR.
2. **Phase 1 (IntentContract generation):** Include the upstream output_schema field names in the LLM prompt so the model knows the exact field names available and uses them directly.

These are deeper changes to Phase 1/2 and are deferred for later.

---

### WP-3: `ai_processing` steps inside scatter-gather

**Severity:** High
**Encountered as:** D-B13
**Status:** ✅ Fixed — `callLLMDirect()` bypasses runAgentKit

**Problem:** `runAgentKit` was designed for top-level agent execution — it loads memory, builds a full system prompt with plugin context, and manages conversation sessions. When called inside a scatter-gather loop (3-50 iterations), it:
- Loads memory on every iteration (wasteful, sometimes corrupts output)
- Uses the full agent system prompt instead of the step's task-specific prompt
- Gets misrouted by the orchestrator (classified as `extract` instead of `generate`)

**Current fix (D-B13):** Three defensive patches:
1. Skip orchestration for `ai_processing/generate` steps
2. Override `system_prompt` to step prompt for `ai_processing` steps
3. `_skipMemory` flag to skip memory injection

These work but are fragile — they patch `runAgentKit`'s behavior from outside rather than giving it a proper lightweight execution mode.

**Trigger scenarios:**
- Any scatter-gather with AI steps: classify per item, summarize per item, generate per item, extract per item
- This is a very common pattern in real-world workflows

**Proposed solution:**

Dedicated lightweight LLM call path for `ai_processing` steps:

1. Add a `callLLMDirect()` method to `StepExecutor` that bypasses `runAgentKit` entirely
2. This method:
   - Takes the step prompt as the system prompt
   - Includes the resolved input data in the user message
   - Calls the AI provider directly via `providerFactory.getProvider()`
   - No memory injection, no plugin context, no session management
   - Supports I3 structured extraction via `output_schema`
   - Uses the agent's `model_preference` for model selection
3. `executeLLMDecision()` uses `callLLMDirect()` for `ai_processing` steps, `runAgentKit` for `llm_decision` steps (which need tools/plugins)
4. Remove the `_skipMemory`, system prompt override, and orchestration skip hacks

**Files:** `lib/pilot/StepExecutor.ts`, `lib/ai/providerFactory.ts`

---

### WP-4: `transform/map` with `custom_code` (natural language)

**Severity:** High
**Encountered as:** D-B11b
**Status:** ✅ Fixed — structured `mapping` from Phase 1 through runtime

**Problem:** The compiler generates `custom_code: "Extract sender, subject, date..."` — a natural language instruction that the runtime can't execute. Mode 4 in `transformMap()` auto-maps fields by name matching with a hardcoded alias table (`sender→from`, `received_date→date`, `matched_keywords→urgency_classification`). The alias table is small and won't cover most field mappings.

**Current fix:** Mode 4 with 3 hardcoded aliases. Works for the specific scenarios tested.

**Trigger scenarios:**
- `company_name` from `company` — no alias
- `contact_email` from `email` — no alias
- `deal_value` from `amount` — no alias
- `phone_number` from `phone` — no alias
- Any map transform where target field names differ from source field names

**Proposed solution:**

Compiler-generated explicit field mappings (no runtime guessing):

1. In the compiler, when a `transform/map` step has `custom_code` AND `output_schema`, generate an explicit `field_mapping` config instead:
   ```json
   "config": {
     "type": "map",
     "field_mapping": {
       "sender": "from",
       "subject": "subject",
       "received_date": "date",
       "matched_keywords": "urgency_classification"
     }
   }
   ```
2. The compiler has access to both the upstream output_schema (source fields) and the map's output_schema (target fields). It can match by:
   a. Exact name match: `subject` → `subject`
   b. Case-insensitive match: `Subject` → `subject`
   c. Common alias patterns: `from` → `sender`, `date` → `received_date` (configurable table)
   d. Substring match: `sales_person` → `Sales Person`
3. Add a `field_mapping` mode to `transformMap()` in the runtime that applies the explicit mapping
4. Fall back to Mode 4 (auto-map) only if no `field_mapping` is provided

**Files:** IntentContract schema, generation prompt, IR converter, compiler, runtime

**Root cause analysis:**

The IntentContract LLM is the **only component** that knows both sides of the mapping — it defined the upstream fields (`from`, `subject`, `date`) and it's deciding what the downstream needs (`sender`, `received_date`). After Phase 1, this knowledge is lost in a natural language string that no downstream component can interpret.

**Previous approaches (insufficient):**
- Mode 4 auto-map (D-B11b): Hardcoded alias table in runtime — doesn't scale
- Compiler field matching (WP-2 style): Algorithmic — catches pattern-based mismatches but not semantic ones (`sender` ≠ `from`)
- Runtime passthrough: Skips the map entirely — works when downstream is an LLM but fails when downstream is a plugin action expecting specific field names

**Correct fix: Structured mapping from Phase 1**

The IntentContract LLM must emit explicit field mappings as structured data, not natural language descriptions. This is the only moment where both sides of the mapping are known.

**Implementation — 4 layers:**

**Layer 1: IntentContract schema update**

Add `mapping` field to the transform step type in the IntentContract schema:

```typescript
// In intent contract types
interface TransformStep {
  kind: 'transform'
  transform: {
    op: 'map' | 'filter' | 'group' | 'reduce' | ...
    input: string
    description?: string  // Keep for human readability
    mapping?: Array<{     // NEW: Structured field mapping for map transforms
      to: string          // Target field name in the output
      from: string        // Source field name from the input
    }>
    output_schema?: OutputSchema
  }
}
```

**Layer 2: IntentContract generation prompt update**

Add instruction to the system prompt for IntentContract generation:

```
When creating a transform step with op: "map" that renames or selects fields:
- Include a "mapping" array that explicitly maps each output field to its source field
- Use the exact field names from the upstream step's output
- Example: mapping: [{to: "sender", from: "from"}, {to: "subject", from: "subject"}]
- Do NOT rely on "description" for field mapping — it is for human readability only
```

**Layer 3: IR converter update**

In `IntentToIRConverter.ts`, when converting a transform step with `mapping`:

```typescript
// Convert mapping to field_mapping config
if (step.transform.mapping && step.transform.mapping.length > 0) {
  config.field_mapping = step.transform.mapping.reduce((acc, m) => {
    acc[m.to] = m.from
    return acc
  }, {} as Record<string, string>)
}
```

This replaces `custom_code` with a structured `field_mapping` in the IR/DSL.

**Layer 4: Runtime `transformMap` update**

Add a `field_mapping` mode to `StepExecutor.transformMap()`:

```typescript
// Mode: field_mapping — explicit field rename/select
if (config.field_mapping && typeof config.field_mapping === 'object') {
  return data.map(item => {
    const mapped: Record<string, any> = {}
    for (const [targetField, sourceField] of Object.entries(config.field_mapping)) {
      mapped[targetField] = item[sourceField]
    }
    return mapped
  })
}
```

**What this achieves:**

| Component | Before | After |
|---|---|---|
| IntentContract | `description: "Extract sender, subject..."` | `mapping: [{to: "sender", from: "from"}, ...]` |
| IR/DSL | `custom_code: "Extract sender..."` | `field_mapping: {sender: "from", subject: "subject"}` |
| Runtime | Mode 4 alias guessing or passthrough | Deterministic field rename |

**Backward compatibility:** Steps without `mapping` (older IntentContracts) fall through to the existing Mode 4 auto-map or passthrough. New IntentContracts use the structured path.

---

### WP-5: `transform/group` output shape

**Severity:** Medium
**Encountered as:** D-B12
**Status:** ✅ Fixed — compiler emits explicit output config

**Problem:** `transformGroup()` returns `{grouped, groups, keys, count}` by default. The D-B12 fix adds schema-aware array conversion, but only when `output_schema.items.properties` has exactly one string field (group key) and one array field (items). If the schema has additional computed fields or different types, the mapping won't work.

**Current fix:** Schema-driven mapping — finds one string field and one array field in `output_schema.items.properties` and maps `{key, items}` to those names.

**Trigger scenarios:**
- Group with count: `{salesperson, leads, lead_count}` — three fields, mapping fails
- Group with computed aggregate: `{category, items, total_amount}` — needs sum computation
- Group where output schema has no array field (just the key and a count)

**Proposed solution:**

Enhanced group transform with explicit config:

1. Compiler generates explicit `group_config` when it creates a group transform:
   ```json
   "config": {
     "type": "group",
     "group_by": "Sales Person",
     "output_format": "array",
     "key_field": "salesperson",
     "items_field": "leads"
   }
   ```
2. `transformGroup()` reads `output_format` to decide return type (`array` vs `object`)
3. `key_field` and `items_field` are explicit — no schema inference needed
4. Keep the schema-inference path as fallback for backward compatibility

**Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`, `lib/pilot/StepExecutor.ts`

---

### WP-6: Structured config reference objects

**Severity:** Medium
**Encountered as:** D-B7 (O29)
**Status:** ✅ Fixed — all structured reference kinds handled

**Problem:** The IR converter emits structured reference objects (`{kind: "config", key: "X"}`) instead of template strings (`"{{config.X}}"`). O29 handles `kind: "config"` in `rewriteConfigRefs()`, but other kinds (`kind: "ref"`, `kind: "computed"`, `kind: "literal"`) could also appear and would pass through unresolved.

**Current fix:** O29 detects `{kind: "config", key: "X"}` and replaces with `"{{input.X}}"`.

**Trigger scenarios:**
- Complex enhanced prompts with computed values (concatenation, conditional defaults)
- Multi-source references where the IR uses `{kind: "ref"}` objects
- Scenarios where the LLM generates `{kind: "literal"}` for constant values

**Proposed solution:**

Comprehensive structured reference resolver in Phase 5:

1. Extend `rewriteConfigRefs()` to handle all `kind` values:
   - `kind: "config"` → `"{{input.X}}"` (already done)
   - `kind: "ref"` → `"{{refName.field}}"` (resolve variable reference)
   - `kind: "literal"` → the literal value directly
   - `kind: "computed"` → resolve or flag as warning
2. Rename method to `resolveStructuredRefs()` to reflect broader scope

**Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

---

### WP-7: Gmail label resolution timing

**Severity:** Low
**Encountered as:** D-B10b
**Status:** ✅ Fixed with 409 recovery, ⬜ Concurrent creation race not handled

**Problem:** `resolveLabelNames()` fetches all labels, searches by name, creates if not found. If two scatter iterations try to create the same label simultaneously, both could hit 409. The 409 recovery re-fetches and finds the label, but it's wasteful (2 GET + 2 POST + 1 GET instead of 1 GET + 1 POST).

**Current fix:** 409 conflict → re-fetch labels → find existing. Works but doubles API calls.

**Trigger scenarios:**
- First run of any scenario with custom Gmail labels and parallel scatter-gather

**Proposed solution:**

Label resolution cache within a single `modifyEmail` batch:

1. Cache the labels list in a per-execution instance variable (not static — avoid cross-request leakage)
2. First call to `resolveLabelNames()` fetches and caches
3. Subsequent calls within the same execution use the cache
4. If a label needs to be created, update the cache after creation
5. This eliminates redundant GET calls and the 409 race condition

**Files:** `lib/server/gmail-plugin-executor.ts`

---

### WP-8: Email subject/body encoding

**Severity:** Low
**Encountered as:** D-B11a
**Status:** ✅ Fixed — all headers MIME-encoded

**Problem:** `buildEmailMessage()` MIME-encodes the Subject header for non-ASCII characters, but other headers (From display name, To display name) and inline body text could also have encoding issues.

**Current fix:** Subject-only MIME encoding (`=?UTF-8?B?...?=`).

**Trigger scenarios:**
- Non-English content: Hebrew, Arabic, CJK characters in sender names, recipient display names
- Email body with special characters in plain-text mode (HTML mode handles encoding via `charset=utf-8`)

**Proposed solution:**

Apply MIME encoding to all headers that may contain non-ASCII:

1. Extract the MIME encoding logic into a helper: `mimeEncodeIfNeeded(value: string): string`
2. Apply to Subject (already done), From display name, To display name, Cc, Bcc
3. For display names in address headers, encode only the display name portion: `=?UTF-8?B?...?= <email@example.com>`

**Files:** `lib/server/gmail-plugin-executor.ts`

---

### WP-9: Phase A/D mock gap — LLM output shape validation

**Severity:** Medium
**Encountered as:** D-B8, D-B13 (only caught in Phase E)
**Status:** ⬜ Documented as F7 (deferred — has token cost)

**Problem:** F5 and F6 validate plugin params, but neither validates that LLM step outputs match the declared `output_schema`. The mock LLM returns canned data that always matches. In production, the LLM might return wrong field names, wrong types, or wrapper objects.

**Trigger scenarios:**
- Any `ai_processing/generate` with `output_schema` — mock succeeds, production LLM may return differently shaped data
- Any `ai_processing/classify` — mock returns perfect array, production LLM may return text

**Proposed solution (F7):**

Phase D+ mode with real LLM calls but mocked plugins. See F7 in execution workplan. Deferred due to token cost (~$0.10-0.15 per run). Consider implementing when the scenario count grows above 10 and regression confidence becomes critical.

---

### WP-10: Scatter-gather error handling — silent success with error data

**Severity:** Medium
**Encountered as:** Observed during D-B9 testing (step6 failed but workflow reported success)
**Status:** ✅ Fixed — error filtering + all-failed detection

**Problem:** When a nested step inside scatter-gather fails, the scatter collects error objects `{error: "...", item: N}` instead of data. Downstream steps receive these error objects and either crash or produce garbage (empty summary tables). The workflow still reports `success: true` because top-level steps completed.

**Trigger scenarios:**
- Any scatter-gather where one iteration fails (API rate limit, invalid data, missing field)
- The summary/output steps process error objects instead of real data

**Proposed solution:**

Scatter-gather error awareness:

1. After gather, count how many items are error objects vs real results
2. If ALL items failed, mark the scatter-gather step as failed (not just log)
3. If SOME items failed, include both `successful_items` and `failed_items` counts in the step output metadata
4. Downstream steps should have access to only the successful items (filter out errors before passing to next step)
5. The workflow report should show scatter success rate: `"step5: 12/15 iterations succeeded (3 failed)"`

**Files:** `lib/pilot/ParallelExecutor.ts`, `lib/pilot/StepExecutor.ts`

---

### WP-11: `search_emails` missing `content_level=full` when body is needed downstream

**Severity:** Critical
**Encountered as:** AliExpress Delivery Tracker scenario — live run sent user an email with fabricated "Unknown package_number / Unknown products / Unknown delivery_status" rows
**Status:** ⬜ Open

**Problem:** `google-mail.search_emails` supports a `content_level` param with values `metadata` | `snippet` | `full`. When omitted (as the compiler currently emits), the plugin returns only headers + a snippet. The returned email objects have `body: ""` and a `snippet` containing mostly invisible Unicode whitespace (common with HTML marketing emails like AliExpress).

When a downstream scatter step tries to extract structured fields from `email.body`, it sees empty strings — and the extractor silently returns placeholder "Unknown X" values for every email. No error is raised, the workflow reports success, and the user receives an email full of fabricated data.

**Observed DSL (phase4-pilot-dsl-steps.json):**
```json
{
  "id": "step1",
  "action": "search_emails",
  "params": {
    "query": "{{input.gmail_search_query}}",
    "max_results": 50,
    "include_attachments": false
  }
}
```
No `content_level` — defaults to metadata/snippet. 14 emails returned with empty bodies. All 14 downstream extractions returned `{confidence: 0, success: false, missing_fields: [all]}` but were still fed into the final email.

**Trigger scenarios:**
- Any workflow where an extract/AI step reads `.body` from search_emails output
- Any workflow doing per-email classification, summarization, or field extraction
- Essentially every non-trivial Gmail workflow beyond label/filter management

**Proposed solution:**

Auto-set `content_level: "full"` in `PluginParameterValidator.ts` when a downstream step consumes email body text. Follow the existing `include_attachments` auto-correction pattern already at line 215–239.

Detection logic (in `IntentToIRConverter` or a compiler pass):
1. After compiling all steps, scan each `search_emails` step's output variable (e.g., `aliexpress_emails`)
2. Find downstream steps that reference `{{<var>.emails}}` or scatter over it
3. Within those, check if any nested step reads `item.body`, `item.snippet`, or passes the whole item to an extraction/AI step
4. If yes → set `content_level: "full"` with a "high" confidence correction and log the reason

Simpler variant (ship first): whenever any downstream scatter/ai_processing/extract step consumes the search output, always set `content_level: "full"`. Small latency cost, zero false negatives.

**Files:** `lib/agentkit/v6/utils/PluginParameterValidator.ts`, `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

---

### WP-12: `document-extractor` bound to free-text email body instead of `ai_processing`

**Severity:** Critical
**Encountered as:** AliExpress Delivery Tracker scenario — same live run as WP-11
**Status:** ⬜ Open

**Problem:** `IntentToIRConverter.convertExtract()` routes extract operations either to an `ai_processing` step or to `document-extractor.extract_structured_data`. The binder selected `document-extractor` for extracting package number, products list, and delivery summary **from email body text**. But `document-extractor` is designed for structured document files (PDF, XLSX, invoices, images) — its input param has `x-variable-mapping: { from_type: "file_attachment" }`. When handed free-form email text, its internal extraction fails and it returns `{package_number: "Unknown Package_number", products: "Unknown Products", delivery_status: "Unknown Delivery_status", _extraction_metadata: {confidence: 0, success: false}}`.

This is a binder correctness bug: document-extractor is mis-selected when the input is a text string rather than a file.

**Observed data flow:**
```
step1 search_emails → emails[] (with body="", snippet=whitespace)
step2 scatter foreach email
  step3 document-extractor.extract_structured_data
    input.file_content = full email object (metadata + empty body)
    output: {package_number: "Unknown Package_number", confidence: 0, success: false}
```

All 14 scatter iterations returned the same placeholder because the extractor had no file and no real text to parse.

**Trigger scenarios:**
- Any workflow that extracts structured fields from email bodies, chat messages, Slack posts, Notion pages, webhook payloads — anywhere the input is text, not a file
- New plugins that return text content but whose extract step gets misrouted to document-extractor

**Proposed solution:**

Restrict `document-extractor.extract_structured_data` binding to inputs of type `file_attachment`. In `IntentToIRConverter.convertExtract()` (around line 500–530):

1. Inspect the extract step's source variable and field type by walking the upstream producer's output_schema
2. If the source is a file attachment (has attachment metadata, `file_url`, `file_content` object) → keep `document-extractor`
3. If the source is a plain text field (`string`, `email body`, `message content`, `post content`) → emit an `ai_processing` step with a per-item extraction prompt instead
4. Add a compiler log (O-series: e.g., `[O31]`) noting the routing decision and why

This aligns with the "No Hardcoding in System Prompts" principle in `CLAUDE.md`: don't hardcode plugin-specific rules — reason from the plugin schema (`from_type: "file_attachment"`) which is the source of truth.

**Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (convertExtract, around line 500), optionally `lib/agentkit/v6/capability-binding/CapabilityBinder.ts`

---

### WP-13: `ai_processing` hallucinates on empty input

**Severity:** Critical
**Encountered as:** AliExpress Delivery Tracker scenario — live run with search_emails returning 0 results still produced a two-row HTML summary table with fabricated package numbers (12345, 67890) and fake products, which was then sent as a real email to the user.
**Status:** ⬜ Open

**Problem:** When an `ai_processing` generate step receives an empty array (`[]`) as input — typically because an upstream data-source or scatter produced no items — the LLM has no explicit instruction to acknowledge the empty state. It interprets the prompt (e.g., "Create a professional HTML table with columns for Package Number, Products, Delivery Status…") as a content generation request and fabricates plausible-looking example rows. The downstream notify step then delivers the hallucinated content as if it were real user data.

This is distinct from WP-12 (wrong extractor) — WP-13 can fire whenever a pipeline has an AI step downstream of a potentially-empty collection, regardless of how the collection is filled.

**Observed data flow (2026-04-05 live run):**
```
step1 search_emails → 0 emails returned (query matched no real mail)
step2 scatter foreach email → extracted_packages = []   (empty — no iterations)
step4 ai_processing (generate HTML table)
  input: []   ← empty array
  output: "<table>...12345...Product A...67890...Product C...</table>"   ← fabricated
step5 ai_processing wraps fabricated table in email body
step6 send_email → user receives fake delivery summary
```

The workflow reports `success: true` because every step "completed". There is no signal that the output is fake.

**Trigger scenarios:**
- Any pipeline where a `search`/`read`/`list`/`query` action feeds a downstream AI generate step
- Any pipeline with a scatter-gather whose input might be empty (no matching records) feeding into an AI summary/report step
- Time-window workflows on quiet days ("summarize yesterday's orders", "weekly digest") when there is no new activity
- Filter-based workflows where the filter accidentally excludes everything

**Proposed solution:**

Two complementary layers:

**Layer 1 — Compile-time empty-input guard (preferred):**

In `IntentToIRConverter` / `ExecutionGraphCompiler`, wrap every `ai_processing` generate step whose input is an array (or scatter-gather collection) with a conditional:
1. Detect: step's input references a scatter output, fetch output, or otherwise-collection-typed variable
2. Compile a conditional wrapper: `if input.length === 0 → emit deterministic "no data" payload and short-circuit downstream chain`
3. The "no data" payload is a structured empty-state message, e.g. for HTML table generation: `"<p>No AliExpress delivery updates found in the last 30 days.</p>"`
4. Downstream notify step delivers the empty-state message — user gets honest "nothing to report" feedback, no fabrication

**Layer 2 — Prompt-level guardrail (defense in depth):**

Inject into the system prompt of every `ai_processing` generate/summarize step:
```
If the input data is empty or null, you MUST respond with exactly:
  "No data available."
Do NOT invent, infer, or fabricate any values, names, IDs, dates, or other
content when the input is empty. Returning placeholder or example data is a
critical failure.
```

This catches the case where the compile-time guard misses a variable shape (e.g., input is an object with an empty nested array).

**Why both layers:** Layer 1 is deterministic and zero-token-cost but depends on the compiler correctly identifying "collection" inputs. Layer 2 is a prompt-level fallback that adds ~50 tokens per AI call but catches any case Layer 1 misses.

**Files:**
- `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (convertGenerate — wrap with conditional)
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (emit conditional DSL step)
- `lib/pilot/StepExecutor.ts` or wherever `callLLMDirect` builds the AI prompt (prepend guardrail)

**Status:** ✅ Fixed (2026-04-05) — implemented Layer 1 and Layer 2 in `StepExecutor.ts`. Layer 1 (`detectEmptyAIProcessingInput`) short-circuits the LLM call with a deterministic `{message: "No data available."}` or schema-shaped no-data payload when input is empty/null/all-empty-entries. Layer 2 prepends a ~40-token guardrail to every `ai_processing` prompt instructing the LLM to respond with "No data available." rather than fabricating.

---

### WP-14: Scatter-gather token bloat + extract step output shape

**Severity:** Critical
**Encountered as:** AliExpress Delivery Tracker scenario — Phase E run, step4 hit OpenAI 429 (39,250 tokens requested, 30,000 TPM limit).
**Status:** ⚠️ Partial fix — original single-nested-step case fixed 2026-04-05. Multi-nested-step scatter body case reopened 2026-04-14 (see "Known gap" below).

**Problem (cascade of 3 bugs):**

1. **I3 structured-JSON extraction** in `StepExecutor.executeLLMDecision` only matched `output_schema.properties` (object form) — but the V6 compiler emits `output_schema.fields` (array form). Result: the LLM's JSON response wasn't parsed; step returned a generic alias envelope `{result, response, output, summary, analysis, decision, reasoning, classification, toolCalls}` wrapping the raw stringified response.

2. **Scatter-gather always merged** the nested step's full return object into the original item (pattern introduced for classify steps in D-B10). With the alias-wrapped LLM response, each gathered item became: full email (~5KB) + 9 duplicate alias fields + raw JSON string. For 14 emails: ~72KB → 39,250 tokens → 429.

3. **Runtime safety check** `shouldUseDeterministicExtraction` rerouted any `ai_processing` step whose input had `content` + `mime_type` fields to `executeDeterministicExtraction` — but Google Drive's `read_file` returns already-extracted plain text (not base64), causing "Cannot extract document content from input" failures on the contract-enddate-summary scenario.

**Fixes:**

1. **I3 handles both schema shapes** ([StepExecutor.ts:1474](../../lib/pilot/StepExecutor.ts)) — parses structured JSON when `output_schema` has either `properties` (object) or `fields` (array).

2. **Scatter merge branches on step type** ([ParallelExecutor.ts:395](../../lib/pilot/ParallelExecutor.ts)) — when the nested step is extract-like (`ai_type` ∈ {`llm_extract`, `extract`, `deterministic_extract`} OR `output_schema` has ≥2 fields), return the step result only (no merge with original item). Classify steps and single-label flatten unchanged.

3. **Runtime safety check distinguishes binary from text** ([StepExecutor.ts:4722](../../lib/pilot/StepExecutor.ts)) — only reroutes to deterministic extraction when `content` looks like base64 (length > 100, base64 alphabet, no double spaces) or MIME type indicates binary. Text MIME types (`text/*`, JSON, XML, RTF), plain-text strings, and `export_format: text/plain` are kept on the AI processing path.

**Verified:** All 10 regression scenarios pass Phase D after fixes. AliExpress step4 token count drops from ~39K to <4K.

**Files:** `lib/pilot/StepExecutor.ts`, `lib/pilot/ParallelExecutor.ts`

#### Known gap — multi-nested-step scatter body (reopened 2026-04-14)

**Severity:** Critical
**Encountered as:** Contract End-Date Summary scenario — Phase E run, step7 hit Anthropic 400 (`prompt is too long: 1,004,169 tokens > 1,000,000 maximum`).
**Status:** ⬜ Open

**Problem:**

The WP-14 fix `isExtractLike`-aware merge ([ParallelExecutor.ts:425-437](../../lib/pilot/ParallelExecutor.ts#L425-L437)) lives inside the **single-nested-step branch** of `processScatterItem()` — the `stepResultKeys.length === 1` path at [line 403](../../lib/pilot/ParallelExecutor.ts#L403). When a scatter body has **two or more** nested steps, control flows into the **multi-step branch** at [line 470](../../lib/pilot/ParallelExecutor.ts#L470), which has no `isExtractLike` guard and unconditionally spreads every step's output into the item:

```typescript
} else if (stepResultKeys.length > 1) {
  mergedResult = { ...item };
  for (const stepKey of stepResultKeys) {
    const stepData = itemResults[stepKey];
    if (typeof stepData === 'object' && stepData !== null && !Array.isArray(stepData)) {
      mergedResult = { ...mergedResult, ...stepData };
    }
  }
}
```

**Failure anatomy in contract-enddate-summary:**

Scatter body has two nested steps:
- `step5` — `google-drive.read_file_content` → `doc_content: { file_id, file_name, content (full document text, ~165KB), ... }`
- `step6` — `ai_processing/generate` (extract-like, 5-field `output_schema`) → `extracted_contract_info: { end_date, counterparty, notes, document_title, document_link }`

Each iteration's `mergedResult` becomes `{ ...item (Drive metadata), ...doc_content (full text), ...extracted_contract_info (small) }` — dominated by step5's `content` field. The extract-like guard never runs because it sits in the single-step branch.

For 4 contract documents of ~165KB each, the gathered `contract_extraction_results` array feeds ~1,004,169 tokens to step7 (`ai_processing/generate` computing days remaining), which blows past Anthropic's 1M-token context limit and fails non-retryably.

**Why the original fix didn't cover this:**

- The AliExpress scenario that motivated WP-14 had a single nested `extract` step over each email — cleanly triggered the single-step branch. The multi-step branch was never exercised during verification.
- "All 10 regression scenarios pass Phase D after fixes" (original Verified note) is true, but Phase D uses stub plugin payloads (~20 bytes per field), so even unguarded multi-step merges stay tiny. The bug is invisible in Phase D and only surfaces with realistic Phase E payloads — exactly the [PD-1 Realistic plugin mock payloads](#pd-1-realistic-plugin-mock-payloads-high-value) gap.
- The WP-14 narrative uses singular "the nested step" throughout, reflecting the single-step assumption.

**Proposed fix (runtime):**

Extend the `isExtractLike` detection to the multi-step branch, applied to the **last nested step** in the scatter body:

```typescript
} else if (stepResultKeys.length > 1) {
  const lastStepKey = stepResultKeys[stepResultKeys.length - 1];
  const lastStepData = itemResults[lastStepKey];
  const lastStep = steps.find(s => s.id === lastStepKey);
  const lastIsExtractLike = /* same detection as single-step branch, applied to lastStep */;

  if (lastIsExtractLike && typeof lastStepData === 'object' && lastStepData !== null && !Array.isArray(lastStepData)) {
    mergedResult = lastStepData;
  } else {
    // Preserve existing multi-step spread-merge for non-extract bodies (e.g., multi-classify).
    mergedResult = { ...item };
    for (const stepKey of stepResultKeys) { /* ...unchanged... */ }
  }
}
```

**Rationale for "last step":**

- Semantically, the last nested step is the canonical output of the scatter iteration. Earlier steps (read_file_content, search_emails, etc.) are intermediate data-fetching — they shouldn't survive the gather.
- Matches how the IntentContract LLM reasons about the workflow: scatter *produces* the extraction result, not the intermediate reads.
- Preserves backward compatibility for multi-classify bodies (last step is classify → 1-field schema → not extract-like → fall through to existing spread-merge).

**Stronger long-term fix (compiler + runtime — deferred):**

Rather than continuing to grow runtime heuristics, the compiler should emit an explicit `gather.output_source: "<last_step_output_variable>"` field when the IR indicates the scatter body's purpose is extraction. The runtime would respect the declared contract deterministically when present, falling back to the heuristic only when absent. Aligns with DESIGN_REBASE §P3 — replace runtime heuristics with schema-declared contracts. Filed as follow-up; not required for this scenario to pass.

**Cross-references:** D-B25 in `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` Change History; PD-1 "Realistic plugin mock payloads" (this doc) — realistic mocks would have caught this class in Phase D.

---

### WP-15: AI-declared output slots lose item-level shape

**Severity:** Critical (P0 — same fabrication-risk class as WP-13 AliExpress)
**Discovered as:** Regression scenario review of `tests/v6-regression/scenarios/complaint-email-logger/` (2026-05-06)
**Status:** ⬜ Not started
**Solution (build tasks):** [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks **0.4** (grammar), **0.5–0.6** (Phase 1 prompt), **2.11** (DataSchemaBuilder recursive copy) — then retire [WORKPLAN.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md) task **7.3** safety net once regression shows 0 firings. Full layered solution sketch in the *Proposed solution* subsection below.

**Problem:** AI-declared slots in `data_schema` (those produced by `generate` / `extract` / shape-changing `transform` steps) consistently come out depth-1 — array fields have no `items`, object fields have no nested `properties` — even when the user prompt and the LLM's free-text `instruction` enumerate every field name. This is the same pattern the design doc Section 2 explicitly calls out as **"Rejected (too shallow)"**.

**Canonical reproducer:** `complaint-email-logger`. The Enhanced Prompt asks for rows with columns `sender email, subject, date, full email text, Gmail message link/id`. Phase 1's `prepare_candidate_emails` step emits an `instruction` mentioning every one of those fields, but the structured `outputs[]` it can produce is:

```json
"outputs": [
  { "name": "rows", "type": "array", "description": "Prepared complaint email records..." }
]
```

Phase 2's `DataSchemaBuilder.inferSchemaForGenerateStep()` (task 2.5) faithfully copies this and emits:

```json
"candidate_rows": {
  "schema": {
    "type": "object",
    "properties": {
      "rows": { "type": "array", "description": "..." }
    },
    "source": "ai_declared"
  }
}
```

No `items`. No per-item `properties`. All five field names live only in the prose `instruction` — they never reach `data_schema`.

**Root cause:** Structural — the IntentContract `generate.outputs[]` and `extract.fields[]` grammar today only allows `{name, type, description}`. There is no slot for `items` (when `type: "array"`) or `properties` (when `type: "object"`). The LLM physically cannot declare element shape with the current grammar; the builder can only emit what the grammar carries.

**Why it survived regression so far:** The compiler's depth-enforcement validator was added in `WORKPLAN.md` task 3.8 to reject shallow schemas. It immediately caused non-deterministic pipeline kills because the LLM produced shallow schemas on a fraction of runs. Task 7.3 then weakened the validator to **warn-and-auto-repair** (`type:"array"` → `items:{type:"any"}`, `type:"object"` → `properties:{}`). The auto-repair keeps the pipeline alive but neuters the contract — every AI slot silently degrades to "any" and downstream validators can't catch field misuse.

**Why it matters (the AliExpress analogy):** Direction #2's runtime AI output validator (`AIOutputValidator` / `SchemaViolationError`) only enforces what the slot schema declares. When the slot is `{type:"array", items:{type:"any"}}`, every per-row object passes — even fabricated `"Unknown package_number / Unknown products"` placeholders. **The same class of silent fabrication that motivated the entire DESIGN_REBASE remains uncaught at the AI-step boundary because the schema can't describe what's expected.** This is Direction #2's enforcement gate failing open at exactly the boundary V6 was designed to tame.

**Trigger scenarios:** Every scenario with an AI step that returns an array of objects or a structured object. Confirmed in `complaint-email-logger` (slots `existing_message_ids`, `candidate_rows`, `new_rows_to_append`). Likely present in `aliexpress-delivery-tracker`, `expense-invoice-email-scanner`, `gmail-urgency-flagging`, `leads-per-salesperson-email`, `orders-po-extractor-xlsx`, `po-monitor-supplier-confirmation`, `contract-enddate-summary`, `gantt-urgent-tasks`, `leads-email-summary` — to be confirmed by sweeping each scenario's `phase2-data-schema.json`.

**Cross-references:**
- DESIGN_REBASE.md §P2 — "Structured data decays into natural language, then is reconstructed downstream"
- DESIGN_REBASE.md §P4 — "The IntentContract LLM lacks the context it needs to be correct"
- DESIGN.md §2 — "AI output schema depth requirement (CRITICAL)"
- WP-4 (closest analog — same pattern, fix already proven by promoting prose `custom_code` to structured `mapping[]`)
- WP-13 (the silent-fabrication risk this gap permits)
- `WORKPLAN.md` task 7.3 (the safety net being masked) and `WORKPLAN_INTENT_CONTRACT.md` task 4.6 (its port)

**Proposed solution (layered — see WORKPLAN_INTENT_CONTRACT.md for task-level detail):**

1. **Grammar (task 0.4):** Make `outputs[]` / `fields[]` recursive. `FieldSpec.items?: FieldSpec` for arrays, `FieldSpec.properties?: Record<string, FieldSpec>` for objects.
2. **Phase 1 prompt (tasks 0.5, 0.6):** Teach the LLM the new grammar with a positive complaint-logger example and a negative shallow example. Reinforce: field names mentioned in `instruction` MUST also appear in structured `properties`. Prefer upstream slot field names (from Direction #1's vocabulary injection) over invented ones.
3. **Phase 2 builder (task 2.11):** Update `inferSchemaForGenerateStep()` and `inferSchemaForExtractStep()` to recursively walk nested `items` / `properties` into the SchemaField tree.
4. **Retire the safety net:** Once tasks 1–3 land, instrument `validateSchemaDepth` and run the 10 regression scenarios. When firings drop to 0, change task 7.3 from warn-and-repair back to error-and-throw. Removing it before tasks 1–3 will re-introduce hard pipeline failures — order matters.

**Sequencing rationale:** Removing the safety net before fixing the grammar = pipeline breakage on every shallow LLM run (the original failure mode 7.3 was added to prevent). Fixing the grammar without retiring the safety net = the gap stays masked; retire-after-measuring is the only safe order.

**Files (expected fix surface):**
- `lib/agentkit/v6/intent/intent-contract-types.ts`, `lib/agentkit/v6/intent/intent-contract-schema.ts` (Zod) — grammar
- `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` — prompt rules + examples
- `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` — recursive copy
- `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` — retire auto-repair after measurement

**Test cases:**
- After fix: `complaint-email-logger`'s `phase2-data-schema.json` slot `candidate_rows` contains `properties.rows.items.properties` with all five expected fields.
- After fix: depth-enforcement firings = 0 across all 10 regression scenarios.
- After fix: Direction #2 `AIOutputValidator` catches fabricated rows (e.g., manually inject `"Unknown package_number"` in an AI step output → `SchemaViolationError` raised because the slot now has typed item properties).

---

### WP-16: Deterministic data operations routed to AI step

**Severity:** High (P1 — not data-corrupting on its own; compounds WP-13 / WP-15 by inserting unnecessary LLM boundaries that introduce fabrication risk)
**Discovered as:** Regression scenario review of `tests/v6-regression/scenarios/complaint-email-logger/` (2026-05-06 — same review that surfaced WP-15)
**Status:** ⬜ Not started
**Solution (build tasks):** [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks **0.7** (grammar inventory), **0.8** (add missing primitives `project_column`, `set_difference`), **0.9** (vocabulary injection), **0.10** (Phase 1 prompt rules), **0.11** (defensive `reason` field on `generate/internal`), **0.12** (regression measurement). Compiler-side rewrite (Solution D) is **deferred and gated** on 0.12 — only added if Phase 1 tuning leaves residue.

**Problem:** Pure deterministic data operations (column projection, keyword filtering, anti-join, deduplication) compile to `ai_processing` steps because the IntentContract LLM defaults to `kind: "generate", domain: "internal"` for any internal data manipulation. Each unnecessary AI step adds latency, token cost, and — critically — a new untyped LLM boundary where fabrication can leak in (compounding WP-13 and WP-15).

**Canonical reproducer:** `complaint-email-logger`. Three of seven DSL steps are unnecessary AI:

| DSL Step | What it does | What it should be |
|---|---|---|
| step4 `extract_existing_message_ids` | Returns column 5 of a 2D string array | `transform/project_column` (deterministic — `row[4]`) |
| step5 `prepare_candidate_emails` | Case-insensitive keyword filter on `subject\|snippet\|body` against fixed config keywords + field projection | `transform/filter` + `transform/map` |
| step6 `filter_new_rows` | Anti-join: keep rows where `gmail_message_link_id NOT IN existing_message_ids` | `transform/set_difference` |

The Phase 1 IntentContract declared all three as:

```json
{ "kind": "generate", "uses": [{ "capability": "generate", "domain": "internal" }] }
```

The IR converter then faithfully translates `generate` → `ai_processing` because that's what the contract says.

**Root cause:** Two structural gaps in Phase 1:

1. **Vocabulary gap.** The `PluginVocabularyExtractor` injects plugin actions into the Phase 1 prompt with full input/output schema detail (Direction #1). It does **not** inject *workflow primitives* — the deterministic `transform` step kinds the grammar already supports. So when the LLM has an internal data operation, `generate/internal` is the path of least resistance — it's the only "internal" capability the prompt explicitly mentions.

2. **Grammar gap.** Today's `transform` step grammar (in [intent-schema-types.ts:143](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143)) supports `filter | map | group | dedupe | flatten | sort` with a free-text `rule: string` field. Two operations the complaint-logger needed have no first-class kind: **`project_column`** (extract column N from a 2D array, or field X from each object in an array) and **`set_difference`** (anti-join — keep items whose key is NOT in a reference list). When the grammar lacks the structured form, the LLM falls back to `generate/internal`. Same root pattern as WP-4 (free-text `custom_code` filled the gap until structured `mapping[]` was added).

**Why the compiler doesn't catch it:** No pass fingerprints `ai_processing` steps as "this is a pure projection/filter" and rewrites them to deterministic transforms. The compiler *can* synthesize transforms (it auto-injects `rows_to_objects` for Sheets reads — see WORKPLAN.md task 7.6), but it doesn't reach back and replace AI steps that should have been transforms. Adding such a pass would violate DESIGN_REBASE §P3 ("compiler heuristic soup") unless it's gated on measurement showing Phase 1 tuning isn't enough.

**Why fabrication-risk:** Each unnecessary AI step is a new boundary where the LLM can hallucinate. In the complaint-logger case:
- step4 could fabricate plausible-looking message IDs that don't exist in the sheet → step6 produces wrong dedup result
- step5 could fabricate emails that don't match the keyword rule → "complaints" logged that aren't complaints
- step6 could fabricate rows that already exist → duplicate sheet entries

WP-15's shallow schemas make this worse: with no `items.properties` declared on the AI slot, Direction #2's runtime validator can't catch the fabrication. WP-16 + WP-15 + WP-13 form a chain — fix one alone and the others still leave silent-fabrication paths open.

**Trigger scenarios:** Any workflow with internal data manipulation. Confirmed in `complaint-email-logger` (3 instances: `extract_existing_message_ids`, `prepare_candidate_emails`, `filter_new_rows`). Sweep status:
- `aliexpress-delivery-tracker` (sweep 2026-05-08) — **0 instances**. Phase 1 correctly used `loop`+`extract` for AI extraction and `generate/internal` only for HTML synthesis (legitimate).
- `leads-per-salesperson-email` (sweep 2026-05-08) — **0 instances**. Phase 1 correctly used `transform/filter` and `transform/group` for the deterministic ops, `generate/internal` only for HTML synthesis. Strong evidence that **the LLM chooses primitives correctly when they exist in the grammar** — primary lever is grammar (task 0.8), not vocabulary visibility (task 0.9).
- `expense-invoice-email-scanner` (sweep 2026-05-08) — **1 instance** (`build_attachment_row`). The Phase 1 LLM used `transform/flatten`, `transform/filter`, `aggregate` correctly, but routed a **structured cross-source merge with one derived field** (combining `extracted_fields.*` + `uploaded_file.web_view_link` + computed `has_valid_amount = amount != null`) to `generate/internal` because (a) the grammar's `transform.operation` enum lacks `merge` even though the design table lists it (design/code drift), and (b) no primitive exists for derived/computed fields. **This expands WP-16 task 0.7's scope** — the inventory must reconcile design/code drift on `merge`/`reduce`/`select` and consider a new `derive` / `with_fields` primitive.
- `gmail-urgency-flagging`, `orders-po-extractor-xlsx`, `po-monitor-supplier-confirmation`, `contract-enddate-summary`, `gantt-urgent-tasks`, `leads-email-summary` — regression sweep needed.

**Cross-references:**
- DESIGN_REBASE.md §P3 — "The compiler has become a heuristic soup" (don't add more compiler heuristics; fix at Phase 1)
- DESIGN_REBASE.md §P4 — "The IntentContract LLM lacks the context it needs to be correct" (extend vocabulary, same pattern as Direction #1)
- CLAUDE.md Platform Design Principles — *"Don't use AI for data restructuring — let the compiler detect and optimise redundant AI steps"* (this is the principle being violated)
- WP-4 — closest analog. Free-text `custom_code` was promoted to structured `mapping[]`. Same pattern applies here: `generate/internal` for filter/projection should be promoted to structured `transform` kinds.
- WP-13 — silent fabrication on empty AI input. WP-16 creates more of those AI boundaries unnecessarily.
- WP-15 — shallow AI schemas. WP-16 multiplies the number of slots WP-15 fails to validate.

**Proposed solution (layered — see WORKPLAN_INTENT_CONTRACT.md for task-level detail):**

1. **Inventory + grammar (tasks 0.7, 0.8):** Sweep the existing `transform` operations vs. operations the regression scenarios need. Add missing primitives to the grammar, IR converter, and runtime executors. At minimum: `project_column` (config: `{column_index}` or `{field_path}`) and `set_difference` (config: `{reference_slot, key_field}`). Also formalize that shape-changing transforms must have structured config — no free-text `rule: string` for the new primitives.

2. **Vocabulary injection (task 0.9):** Add a "Workflow Primitives" section to `buildVocabularyInjection()`, listed alongside plugin actions. Same shape as plugin action entries: name, when-to-use, structured config, example usage. Listed primitives: all `transform` kinds + `aggregate`. Each entry includes a one-line "use this instead of `generate/internal` when ..." trigger.

3. **Phase 1 prompt rules (task 0.10):** Explicit guidance: *"For internal data operations, prefer `transform` steps over `generate/internal`. Use `generate/internal` only when the operation requires reasoning beyond rule application (free-form classification, summarization, semantic comparison). If you find yourself writing `instruction: 'extract column 5 from rows'` or `instruction: 'remove rows already in the existing list'`, you should be writing a structured `transform` step instead."* Include the complaint-logger pattern as a negative example with side-by-side rewrite.

4. **Defensive grammar nudge (task 0.11):** On `kind: "generate"` with `domain: "internal"`, require a `reason: string` field. The LLM must justify why a deterministic transform isn't sufficient. Cheap to add, makes the choice deliberate, and gives downstream telemetry a signal about how often `generate/internal` is being used and why.

5. **Measure (task 0.12):** After 1–4 land, sweep all 10 regression scenarios. For each `ai_processing` step in the compiled DSL, regex-match the `prompt` field against deterministic-op fingerprints (`^extract column \d`, `^keep .* where .* contains`, `^remove .* already`, `^group .* by`). Report residual count.

6. **Compiler rewrite (Solution D — deferred, gated on step 5):** If step 5 shows residue > 0 after Phase 1 tuning, add a compiler pass that rewrites those `ai_processing` steps to `transform` steps. If 0, defer indefinitely — adding a compiler pass *just in case* is exactly the heuristic-soup pattern the rebase doc warns against.

**Sequencing rationale:** Steps 1–4 are upstream fixes at Phase 1 (where the choice is made). Step 5 measures whether Phase 1 alone is sufficient. Step 6 is the compiler safety net — only built if measured to be necessary. This is the inverse of the current pattern (compiler heuristic ships first; root cause deferred) and matches DESIGN_REBASE's prescribed direction.

**Files (expected fix surface):**
- `lib/agentkit/v6/intent/intent-schema-types.ts` — extend `transform` step kinds with `project_column`, `set_difference`
- `lib/agentkit/v6/intent/intent-contract-schema.ts` (Zod) — same
- `lib/agentkit/v6/vocabulary/PluginVocabularyExtractor.ts` — add `extractWorkflowPrimitives()` parallel to plugin extraction
- `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` — `buildVocabularyInjection()` includes Workflow Primitives section + new prompt rules
- `lib/agentkit/v6/compiler/IntentToIRConverter.ts` — handle new `transform` kinds
- `lib/pilot/operations/DataOperations.ts` (or equivalent) — runtime executors for `project_column`, `set_difference`

**Test cases:**
- After fix: `complaint-email-logger`'s `phase4-pilot-dsl-steps.json` has at most 1 `ai_processing` step (none for the deterministic operations); steps 4, 5, 6 become `transform` steps with structured config.
- After fix: Phase 1 IntentContract for complaint-logger uses `transform/project_column`, `transform/filter`, `transform/set_difference` instead of three `generate/internal` steps.
- After fix: regression measurement (task 0.12) reports residual `ai_processing`-with-deterministic-fingerprint count across all 10 scenarios.
- After fix: end-to-end correctness — complaint-logger appends only complaint emails, dedup actually works, no fabricated rows.

**Compounding with WP-15:** When WP-15 + WP-16 land together, the complaint-logger DSL drops from 3 `ai_processing` steps with shallow schemas to 0 `ai_processing` steps for deterministic ops. The single remaining AI step (if any — perhaps for keyword classification beyond the simple `contains` check) has a deep `output_schema` that Direction #2's `AIOutputValidator` can actually enforce. The fabrication-risk surface shrinks dramatically.

---

### WP-17: Loop item slot misderived from nested array and overwritten across loops

**Severity:** High (P1 — declared schema doesn't match runtime data; cross-step type validator can't catch downstream errors when the source schema lies)
**Discovered as:** Regression scenario review of `tests/v6-regression/scenarios/aliexpress-delivery-tracker/` (2026-05-08)
**Status:** ⬜ Not started
**Solution (build tasks):** [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks **2.12** (nested-array unwrap), **2.13** (multi-loop `item_ref` collision handling).

**Problem:** When an IntentContract loop iterates over a slot whose **top-level type is not array** but contains a nested array (e.g., `over: "aliexpress_emails"` where the slot is the search-results wrapper `{emails: array<...>, total_found, ...}`), the loop item slot ends up declared with the **wrapper's schema** instead of the per-element schema. Compounded by a second bug: when multiple loops share an `item_ref` name, each loop's `buildLoopSlots()` call overwrites the prior slot in `slots[]`, so `produced_by` reflects only the last loop.

**Canonical reproducer:** `aliexpress-delivery-tracker`. The IntentContract has 3 loops all using `over: "aliexpress_emails"` and `item_ref: "email"`:
- `extract_package_details` (extracts fields per email)
- `mark_emails_read` (modifies each email)
- `move_to_shopping_label` (modifies each email)

`aliexpress_emails` is a Gmail search-results wrapper: top-level `type: "object"` with `properties: {emails: array<email>, total_found: number, search_query: string, ...}`.

The resulting `email` slot in `phase2-data-schema.json`:

```json
"email": {
  "schema": {
    "type": "object",
    "source": "inferred",
    "properties": {
      "emails": { "type": "array", "items": {...email object...} },   // ← wrapper leaked through
      "total_found": { "type": "number" },                             // ← wrapper field
      "search_query": { "type": "string" },                            // ← wrapper field
      ...
    }
  },
  "scope": "loop",
  "produced_by": "move_to_shopping_label"   // ← last loop wins
}
```

Expected:

```json
"email": {
  "schema": {
    "type": "object",
    "source": "inferred",
    "properties": {
      "id": {...}, "subject": {...}, "from": {...}, "to": {...},
      "date": {...}, "snippet": {...}, "body": {...}, "labels": {...},
      "attachments": {...}, "thread_id": {...}
    }
  },
  "scope": "loop",
  "produced_by": "extract_package_details"   // first/canonical owner
}
```

**Root cause (two bugs in `buildLoopSlots()`):**

🐛 **Bug A — nested-array unwrap missing.** [DataSchemaBuilder.ts:458-464](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts#L458-L464):

```typescript
if (overSlot?.schema.type === 'array' && overSlot.schema.items) {
  itemSchema = { ...this.deepCopySchema(overSlot.schema.items), source: 'inferred' }
} else if (overSlot) {
  // Iterating over non-array (edge case) — use the slot schema directly
  itemSchema = { ...this.deepCopySchema(overSlot.schema), source: 'inferred' }
}
```

Only handles slots whose top-level type is `array`. For `over: "aliexpress_emails"` the slot type is `object`, so the check fails and the fallback at line 461 copies the **entire wrapper** as the item schema. The same gap exists in the second-pass fixup at [DataSchemaBuilder.ts:632-633](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts#L632-L633).

In the compiled DSL the runtime loop correctly iterates over `{{aliexpress_emails.emails}}` (the IR converter / compiler unwraps it). So **execution works**, but the **declared schema is wrong** — every cross-step type check on `email.id`, `email.body`, `email.subject` runs against a schema that has no such top-level fields (it has `email.emails[].id`, etc.).

🐛 **Bug B — multi-loop `item_ref` overwrite.** [DataSchemaBuilder.ts:466-470](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts#L466-L470):

```typescript
slots[step.loop.item_ref] = {
  schema: itemSchema,
  scope: 'loop',
  produced_by: step.id,
}
```

Direct assignment with no collision check. When 3 loops share `item_ref: "email"`, the third call (`move_to_shopping_label`) overwrites the prior slot. `produced_by` reflects only the last loop, and any per-loop refinements (e.g., if loops had different over-arrays) would be lost.

**Why both bugs hide:**
- Runtime variable resolution doesn't consult the schema for loop iteration values — it uses the actual iteration data. So execution succeeds despite the schema being wrong.
- Phase 4 cross-step type validator (WORKPLAN.md task 4.7 / WORKPLAN_INTENT_CONTRACT.md task 4.7) checks references against `data_schema`. With Bug A, every per-iteration field reference like `{{email.id}}` should *fail* type validation — but instead it either silently passes (validator misses the case) or auto-repairs (task 7.3 safety net). Either way: the validator can't actually enforce correctness because the schema lies.
- WP-15's auto-repair compounds this. With Bug A producing a wrong-but-non-empty schema, WP-15's depth check sees `properties` present and doesn't fire — the `{type:any}` fallback that would have flagged the issue never triggers.

**Why this matters (fabrication risk):**

This is the same class of "schema lies about reality" failure as WP-13 and WP-15. The runtime `AIOutputValidator` (Direction #2) only catches what the schema declares. When the schema for the *input* to an AI step is wrong, the AI's output schema can be perfectly correct and still mismatch what the AI actually receives. In `aliexpress-delivery-tracker`:

- `extract_fields` step3 receives `{{email}}` — an actual single-email object at runtime
- The declared input schema says `email` has fields `emails`, `total_found`, `search_query` (the wrapper)
- The AI prompt says "extract from `email.body`, `email.subject`" — references that don't exist in the declared schema but DO exist in the runtime data
- Cross-step type validator either silently passes or auto-repairs both sides — gap is hidden

**Trigger scenarios:** Any workflow with:
- A loop whose `over` slot is a wrapper-object (not a top-level array) — e.g., Gmail/Drive/Sheets search results, paginated APIs that return `{items: [...], total, ...}`. **Common.**
- Multiple loops over the same array (mark-as-read + apply-label is the canonical pattern). Confirmed in `aliexpress-delivery-tracker`. Likely repeats across email-batch scenarios.

**To-be-confirmed scenarios** (regression sweep needed): `gmail-urgency-flagging`, `expense-invoice-email-scanner`, `leads-per-salesperson-email`, `complaint-email-logger` (no loops, so unaffected), `aliexpress-delivery-tracker` (confirmed).

**Cross-references:**
- WP-2 — closest analog: field-name mismatches between plugin output and downstream refs. WP-17 is structurally similar but at the loop boundary instead of the cross-step boundary.
- WP-15 — when item schema is wrong, WP-15's depth validator can't fire because `properties` are technically present.
- DESIGN.md §3.4 (Scatter-gather item scope) — explicitly states *"The compiler infers `current_email.schema` from `raw_emails.schema.items`"*. WP-17 is a **failure to honor this design contract** when the array is nested.
- DESIGN_REBASE.md §P1 — "schema contract became advisory" — exactly the failure mode at the loop boundary.

**Proposed solution (two surgical fixes in adjacent code):**

1. **Fix Bug A — nested-array unwrap (task 2.12).** When `overSlot.schema.type !== 'array'`, walk into the schema and find the **single nested array** under `properties[].items` (or `properties[].properties[].items`). If exactly one nested array is found, use its `items` as the item schema. This matches what the IR converter / compiler already does when it rewrites `over: "aliexpress_emails"` to `iterate_over: "{{aliexpress_emails.emails}}"`.
   - **Edge case 1:** if the wrapper has multiple arrays at the same nesting level (rare), require an explicit `loop.over_field` field on the IntentContract step (small grammar addition) so the LLM disambiguates.
   - **Edge case 2:** if no nested array is found, log a warning and keep the existing behavior (copy wrapper) — that's still better than dropping the slot.
   - Same logic must be added to the second-pass fixup at line 632.

2. **Fix Bug B — multi-loop `item_ref` collision (task 2.13).** Two options:
   - **Option a (preferred):** Track all producers. When `slots[item_ref]` already exists with `scope: 'loop'`, verify the new schema matches the existing one (same `over`-array's items shape). If yes, leave the slot alone but **append the loop step to a `produced_by_loops: string[]` field** for traceability. If no, that's a genuine collision (different shapes for the same name) — log an error.
   - **Option b:** Treat each loop's `item_ref` as scope-local — rename to `<loop_id>__<item_ref>` internally, even if the IntentContract uses the same name. Cleaner but more invasive (downstream refs would need rewriting).
   - Recommendation: Option a. Three loops over the same source share semantics; renaming would obscure that.

**Files (expected fix surface):**
- `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` — both bugs in `buildLoopSlots()` and the second-pass fixup loop
- Possibly `lib/agentkit/v6/intent/intent-schema-types.ts` — only if Edge case 1 needs a grammar addition (`loop.over_field`)
- Tests in `__tests__/DataSchemaBuilder*.test.ts` — new cases for nested-array unwrap and multi-loop item_ref

**Test cases:**
- After fix: `aliexpress-delivery-tracker`'s `email` slot has the per-email schema (`id`, `subject`, `from`, `to`, `body`, ...) — not the search-results wrapper.
- After fix: `email` slot's `produced_by` reflects the first/canonical loop (or all three via `produced_by_loops`).
- Unit test: loop with `over` pointing to an object slot containing a single nested array → item slot has the array's `items` schema.
- Unit test: loop with `over` pointing to an array slot directly → behavior unchanged (regression guard).
- Unit test: 3 loops with same `item_ref` over the same array → slot exists once, schema correct, all three loops tracked.
- Cross-step regression: after fix, the cross-step type validator should produce 0 unresolved-reference warnings for `aliexpress-delivery-tracker` references like `{{email.id}}`, `{{email.body}}`.

**Compounding with WP-15:** WP-17's Bug A produces a wrong-but-non-empty schema, which masks WP-15's depth check from firing on loop item slots (the wrong schema technically has `properties`). After WP-17 lands, WP-15's depth validator will see clean per-element schemas and can correctly catch any remaining shallow declarations.

---

### WP-18: Shape-preserving transform inherits schema from wrong slot when compiler auto-unwraps input

**Severity:** High (P1 — declared schema doesn't match runtime data; affects every workflow that filters/sorts/dedupes Sheets data or other wrapper-style plugin output. Common pattern across the regression suite.)
**Discovered as:** Regression scenario review of `tests/v6-regression/scenarios/leads-per-salesperson-email/` (2026-05-08)
**Status:** ⬜ Not started
**Solution (build tasks):** [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks **2.14** (honor LLM-declared `transform.output_schema` even on shape-preserving ops) + **2.15** (verify task 4.5 auto-injected slot registration actually fires for `rows_to_objects`).

**Problem:** `DataSchemaBuilder.inferSchemaForTransformStep()` treats `filter`, `sort`, `dedupe`, `flatten` as shape-preserving and inherits the output slot schema from the input slot (per the design table in WORKPLAN_INTENT_CONTRACT.md line 159). This rule has an unstated assumption: **the input slot schema represents the data the operation will actually see at runtime**. That assumption breaks when the input is a plugin wrapper (Sheets `{values: array<array>, row_count, ...}`, paginated APIs, etc.) and the compiler auto-injects an unwrap transform (`rows_to_objects`) before the filter. The filter operates on object array data, but its output slot inherits the wrapper schema.

The LLM's explicit `transform.output_schema` declaration — which would have caught this — is **ignored** because the operation is "shape-preserving."

**Canonical reproducer:** `leads-per-salesperson-email`. The `filter_qualified_leads` step in [phase1-intent-contract.json:124-165](../../tests/v6-regression/scenarios/leads-per-salesperson-email/output/phase1-intent-contract.json#L124-L165) explicitly declared an output_schema:

```json
"output_schema": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "Date": {...}, "Lead Name": {...}, "Company": {...},
      "Email": {...}, "Phone": {...}, "Stage": {...},
      "Notes": {...}, "Sales Person": {...}
    }
  }
}
```

But [phase2-data-schema.json:57-112](../../tests/v6-regression/scenarios/leads-per-salesperson-email/output/phase2-data-schema.json#L57-L112) shows the `qualified_leads` slot inherited the Sheets wrapper instead:

```json
"qualified_leads": {
  "schema": {
    "type": "object",
    "source": "inferred",
    "properties": {
      "range": { "type": "string" },
      "values": { "type": "array", "items": { "type": "array", ... } },
      "row_count": { "type": "number" },
      "column_count": { "type": "number" },
      ...
    }
  },
  "produced_by": "filter_qualified_leads"
}
```

Meanwhile [phase4-pilot-dsl-steps.json](../../tests/v6-regression/scenarios/leads-per-salesperson-email/output/phase4-pilot-dsl-steps.json) shows:
- Step 2: auto-injected `transform/rows_to_objects` consuming `{{raw_leads.values}}` → `raw_leads_objects`
- Step 3: `transform/filter` consuming `{{raw_leads_objects}}` → `qualified_leads`, with the **correct** declared `output_schema` (array of lead objects) preserved in step config

So three sources of truth disagree: **(a)** the data_schema slot says `qualified_leads` is the Sheets wrapper, **(b)** the DSL step config carries the correct array-of-leads schema, **(c)** the actual runtime data is an array of lead objects. Downstream steps (e.g., `generate_user_summary_html` reading `{{qualified_leads}}` and prompting "Date, Lead Name, Company, ...") work at runtime but can't be type-validated against the slot schema.

**Root cause (two compounding issues):**

🐛 **Bug A — Shape-preserving rule overrides LLM declaration.** [DataSchemaBuilder.ts](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts) `inferSchemaForTransformStep()` for ops in `{filter, sort, dedupe, flatten}` inherits from the input slot unconditionally. When the LLM has declared `transform.output_schema`, it should win — the LLM is signaling "the shape is changing because the input wrapper is being unwrapped" or "I want a stricter schema than the input."

🐛 **Bug B — Auto-injected `rows_to_objects` slot missing from data_schema.** WORKPLAN_INTENT_CONTRACT.md task 4.5 was meant to register a slot for the auto-injected transform's output (e.g., `raw_leads_objects`). The slot is **not present** in this scenario's `phase2-data-schema.json`. Either task 4.5 isn't firing, or it fires after Phase 2 completes, so even if the inheritance rule walked the producer chain it wouldn't find the unwrapped slot to inherit from.

The two bugs reinforce each other: with the unwrapped slot missing AND the LLM declaration ignored, the wrapper schema wins by default.

**Why both effects compound (failure chain):**
1. Compiler auto-injects `rows_to_objects` to convert Sheets wrapper → object array
2. `raw_leads_objects` slot is not registered in data_schema (Bug B / task 4.5 gap)
3. `DataSchemaBuilder` builds `qualified_leads` slot using shape-preserving rule
4. Rule inherits from `raw_leads` (wrapper) — the LLM's declared array-of-leads `output_schema` is discarded (Bug A)
5. `qualified_leads.schema` is the wrapper; downstream consumers can't be validated correctly

**Why it matters (validation failures):**
- Cross-step type validator: `generate_user_summary_html` reads `{{qualified_leads}}` and the AI prompt asks for `Date`, `Lead Name`, `Company`, etc. — fields the slot says don't exist (slot has `range`, `values`, `row_count`).
- `transform/group` step at `group_leads_by_salesperson` operates on `qualified_leads` with `rules.group_by: "Sales Person"` — validator can't verify that `Sales Person` is a valid field of the array items because the slot doesn't declare items at all.
- Same "schema lies about reality" failure class as WP-13 / WP-15 / WP-17. Direction #2's `AIOutputValidator` can't enforce correctness when input-side schema is wrong.

**Trigger scenarios:** Any workflow that filters / sorts / dedupes / flattens output from a plugin that returns a wrapper (Sheets `read_range`, paginated APIs, etc.) and relies on compiler auto-unwrap. Confirmed in `leads-per-salesperson-email`. Likely repeats wherever Sheets data is filtered or grouped — sweep needed across `gmail-urgency-flagging`, `expense-invoice-email-scanner`, `gantt-urgent-tasks`, `complaint-email-logger` (which has `transform/rows_to_objects` auto-inject confirmed but doesn't filter via shape-preserving op so may not trigger), `leads-email-summary`, etc.

**Cross-references:**
- WP-13 / WP-15 / WP-17 — same "schema lies about reality" failure class.
- DESIGN.md §2 (Schema sources) — the design table doesn't anticipate compiler auto-injects affecting shape-preserving inheritance.
- DESIGN_REBASE.md §P1 — "schema contract became advisory" — exact instance: the contract is wrong, not just unenforced.
- WORKPLAN.md task 7.6 (auto-inserted transform output registration) — original Architecture A version of this fix.
- WORKPLAN_INTENT_CONTRACT.md task 4.5 — port of 7.6 to Architecture B; marked Done but evidently not firing for this scenario.
- WORKPLAN_INTENT_CONTRACT.md task 4.7 (cross-step type compatibility checks) — should be flagging the discrepancy between the wrapper slot schema and downstream consumer field references; either it's flagging silently, or auto-repair (task 7.3) is masking.

**Proposed solution (two surgical fixes):**

1. **Fix Bug A — honor LLM-declared `transform.output_schema` (task 2.14).** In `DataSchemaBuilder.inferSchemaForTransformStep()`, change the rule for shape-preserving ops:
   - **Today:** unconditionally inherit from input slot.
   - **Proposed:** if the LLM declared `transform.output_schema`, use that. Otherwise, fall back to the inheritance rule.
   - This treats the LLM as the authority on output shape — same pattern as shape-changing ops (`map`, `group`, etc.) which already require LLM declaration. Also matches WP-15's principle: trust LLM-declared schemas, validate them, don't second-guess them.
   - Edge case: if the LLM-declared schema and the inherited schema both exist and disagree, log a warning but use the LLM declaration. The inherited schema is heuristic; the declaration is explicit.

2. **Fix Bug B — verify auto-injected slot registration (task 2.15).** Audit task 4.5 (`Port auto-inserted transform slot registration`). Confirm:
   - That `raw_leads_objects` (or whatever the auto-injected transform produces) gets a slot registered in data_schema with `source: "inferred"`.
   - That the slot is registered **before** downstream slots that consume it are built — order matters because Bug A's fallback inheritance walks the producer chain.
   - That the inheritance rule, when falling back, picks the slot at the **direct** input position (post-unwrap), not the original pre-unwrap source.
   - If task 4.5 is broken, fix it. If it's correct but timing is wrong, sequence it before `inferSchemaForTransformStep` runs for downstream consumers.

**Files (expected fix surface):**
- `lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts` — `inferSchemaForTransformStep()` for both bugs
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` — verify auto-injected slot registration (task 4.5 audit)
- Tests in `__tests__/DataSchemaBuilder*.test.ts` — new cases: filter step with declared output_schema (declaration wins); filter step on Sheets wrapper input (auto-unwrap chain); filter step without declaration (inheritance still works)

**Test cases:**
- After fix: `leads-per-salesperson-email`'s `qualified_leads` slot has the declared array-of-leads schema, not the Sheets wrapper.
- After fix: `raw_leads_objects` slot exists in data_schema with `source: "inferred"`.
- After fix: cross-step type validator (task 4.7) can resolve `qualified_leads.Date`, `qualified_leads.Sales Person` against the per-row item schema.
- Unit test: shape-preserving transform with explicit `output_schema` → declaration wins.
- Unit test: shape-preserving transform without `output_schema` → inheritance still works (regression guard).
- Unit test: filter consuming auto-injected `rows_to_objects` output → output slot has the unwrapped object-array schema.

**Compounding with WP-15 / WP-17:** WP-18 produces a wrong-but-non-empty schema (the wrapper has `properties`), masking WP-15's depth check on downstream consumers. WP-17 + WP-18 are sister failures — both are "schema inheritance picks the wrong source when the data flow involves an implicit unwrap." After WP-17 + WP-18 land, the cross-step type validator (task 4.7) can finally enforce correctness across loop boundaries and shape-preserving transform boundaries.

---

### WP-19: `ai_processing` on array input — bulk vs per-item

**Severity:** Medium
**Encountered as:** Manual review of `aliexpress-delivery-tracker/output/phase4-pilot-dsl-steps.json` step3 (2026-05-10)
**Status:** ⬜ Future — observed, deferred until a Phase E run actually fails

**Problem:** When the LLM needs to apply AI extraction/classification/generation to each item in an array, it can emit one of two shapes:

1. **Per-item (canonical, safer):** `kind: "loop"` over the array with `kind: "generate"` (or `extract`) inside. The compiler produces a `scatter_gather` running the LLM N times, once per item.
2. **Bulk (current AliExpress emission):** `kind: "generate"` with `input: <array>` and an instruction like "for each email...". The compiler produces a single `ai_processing` step that passes the whole array to one LLM call and trusts the LLM to return an array back.

The LLM picks (2) when the operation has no per-item side-effects (no API calls per item), because (2) is "simpler" — one call instead of N. But (2) has known failure modes:

- **Token bloat (WP-14 family):** if the array is unbounded (Gmail search results: could be 1 or 100 emails), the prompt grows linearly. With 50 emails × 2KB each = 100KB+ prompts that hit the model's input window or rate limits.
- **Hallucination / drift in bulk extraction:** LLMs reliably drop or invent items when extracting in bulk — observed at ~5–10% rate even on small inputs. Per-item processing produces more reliable structured output.
- **All-or-nothing failure:** one malformed input can fail the whole batch; per-item processing isolates failures.

**Concrete example (AliExpress):**

```json
// IntentContract step3 (LLM emission)
{
  "kind": "generate",
  "generate": {
    "input": "delivery_emails",                  // ← whole array
    "instruction": "For each email...",          // ← natural-language for-each
    "outputs": [{
      "name": "deliveries",
      "type": "array",
      "items": { /* per-email shape */ }         // ← LLM expected to return all in one shot
    }]
  }
}

// Compiled DSL step3
{ "type": "ai_processing", "input": "{{delivery_emails}}", ... }
```

Compare with step6 in the same scenario (`mark_and_label_emails`), where the LLM correctly emitted `kind: "loop"` because labeling is a Gmail API call per email.

**Why the compiler doesn't auto-rewrite:**

By design — bulk processing is legitimate for some patterns:
- Cross-item summarization ("summarize this thread of emails")
- Cross-item classification with shared context ("rank these leads by urgency relative to each other")
- Single-shot extraction of a global field ("what's the overall sentiment of this conversation")

Auto-converting `ai_processing` on an array into a scatter would change semantics for these. A safe conversion needs a per-item independence signal that the current grammar doesn't expose.

**Three intervention options:**

1. **Phase 1 prompt steering (lowest risk).** Add explicit guidance to `intent-system-prompt-v2.ts`:

   > When you need AI to apply *independently* to each item in an array (extract per-item fields, classify per-item, generate per-item content), wrap the AI step in a `kind: "loop"` over the array with `item_ref`. Per-item AI calls are safer for token budgets, more reliable for structured output, and isolate failures.
   >
   > Use a single bulk AI call only when the operation requires cross-item context (summarization, comparative ranking, conversation analysis).

   Plus a positive example (per-item) and a negative example (bulk over an unbounded array).

   Pro: targets root cause; LLM is non-deterministic but observable. Con: still depends on LLM compliance.

2. **Compiler detection + warning.** Detect at compile time:
   - `ai_processing` step with `input` resolving to an array slot
   - `output_schema` is `array<object>` with `items.properties` matching the input's per-element shape
   - No cross-item operation hint in the prompt

   Emit a warning "AI on array input — consider scatter_gather for per-item processing". Non-blocking; observable. Could be promoted to an error after measurement shows 0 legitimate bulk-on-array patterns.

   Pro: catches all emissions regardless of LLM choice. Con: warning fatigue if false positives are common.

3. **Compiler auto-rewrite.** Transform detected `ai_processing` patterns into `scatter_gather` wrapping the AI step, with `item_ref` injected. Per-item LLM calls.

   Pro: fixes the problem unconditionally. Con: changes semantics for legitimate bulk operations; needs an opt-out signal in the IntentContract grammar.

**When to act:** This is a latent risk, not an active bug for small inputs. Defer until:
- A Phase E run fails with token-bloat or item-drop on a real-data array, OR
- A new scenario regularly exercises arrays larger than ~20 items, OR
- The W5 measurement starts surfacing this as a recurring `generate/internal` pattern.

**Compounding with WP-13 / WP-14:** WP-13 documented bulk AI's tendency to fabricate when input is empty; WP-14 documented scatter token bloat from full-item merges. WP-19 is the missing third leg — the choice between bulk and scatter at emission time. All three are facets of "LLM-on-collections is risky and needs structural guardrails."

---

### WP-25: Broaden positional-key detection in `transformMap` Mode 0

**Severity:** High (blocks Phase E for any Sheets append workflow where the LLM picks a non-numeric positional pattern)
**Encountered as:** Phase E re-run on `complaint-email-logger` after WP-24 fix landed (2026-05-10) — body cells now populated thanks to WP-24, but step10 (`append_rows`) still returned `null`.
**Status:** ✅ Fixed — runtime tolerance, broadened pattern recognition

**Problem:** WP-23 introduced runtime tolerance for `field_mapping` with all-numeric target keys (`"0"`, `"1"`, ...) — recognizing the LLM's "objects-to-2D-array for Sheets append" intent. But the LLM is creative with positional descriptors. On the same scenario, a fresh compile produced:

```json
"field_mapping": {
  "column_A": "sender_email",
  "column_B": "subject",
  "column_C": "date",
  "column_D": "full_email_text",
  "column_E": "gmail_message_link_id"
}
```

This bypasses `^\d+$` so `transformMap` falls through to object-building → `[{"column_A": "...", "column_B": "...", ...}]`. `append_rows` plugin schema requires `values: array<array<cell-values>>` (a 2D array), not column-letter-keyed objects. Plugin returned null → calibration stop.

**Pattern catalog observed in the wild:**

| Pattern | Example target keys | Index mapping |
|---|---|---|
| Numeric (WP-23) | `"0"`, `"1"`, `"2"` | parseInt |
| `column_<N>` | `"column_0"`, `"column_1"` | parseInt(suffix) |
| Excel letter | `"A"`, `"B"`, `"AA"` | A=0, B=1, ..., Z=25, AA=26 |
| `column_<letter>` | `"column_A"`, `"column_B"` | letter conversion of suffix |

All four mean the same thing: "the target keys are positional column identifiers, not field names — emit a 2D array."

**Fix:** new `parsePositionalKey(key: string): number | null` helper that returns the numeric index for any of the four patterns (or null if not positional). `transformMap` Mode 0 now checks `targetKeys.every(k => parsePositionalKey(k) !== null)` instead of just the numeric regex. When detected, emit a 2D array; otherwise, fall through to object-building.

```ts
function parsePositionalKey(key: string): number | null {
  // "0", "1", "42"
  if (/^\d+$/.test(key)) return parseInt(key, 10);
  // "column_0", "column_1"
  let m = key.match(/^column_(\d+)$/);
  if (m) return parseInt(m[1], 10);
  // "A", "B", ..., "Z", "AA", ...
  if (/^[A-Z]+$/.test(key)) return letterToIndex(key);
  // "column_A", "column_B", ..., "column_AA"
  m = key.match(/^column_([A-Z]+)$/);
  if (m) return letterToIndex(m[1]);
  return null;
}

function letterToIndex(letters: string): number {
  let idx = 0;
  for (const c of letters) {
    idx = idx * 26 + (c.charCodeAt(0) - 'A'.charCodeAt(0) + 1);
  }
  return idx - 1;  // A=0, B=1, ..., Z=25, AA=26
}
```

**Files:** `lib/pilot/StepExecutor.ts` (+~20 lines for helper + extended detection), `lib/pilot/__tests__/transformMap.numeric-keys.test.ts` (renamed in spirit but kept name; +12 new tests).

**Why this isn't a permanent fix:** the LLM might invent a 5th pattern next month. The right long-term fix is either compiler-side rewrite to a canonical op (e.g., `objects_to_rows` with explicit `column_order: [...]`) or LLM emission steering. Tracked as future work — for now, runtime tolerance covers the observed patterns.

---

### WP-24: `content_level` not forced `full` for deterministic body consumers

**Severity:** High (Sheets rows append but content columns are empty)
**Encountered as:** Successful Phase E on `complaint-email-logger` (2026-05-10, post-WP-23) — append succeeded but column D (`full_email_text`) was empty across all rows.
**Status:** ⬜ Documented — fix to follow

**Problem:** WP-11's `enforceContentLevelForExtraction()` post-pass forces `content_level: 'full'` on Gmail `search_emails` (and similar fetch actions) when downstream extraction is detected. The existing detection only matches:
1. `op.operation_type === 'ai'` (any AI step)
2. `op.operation_type === 'deliver'` with action matching `/extract/i`

Both fired correctly when complaints went through an AI extraction step. But this scenario uses **deterministic transforms** instead:

```
step6 (filter):
  condition: { field: "item.body", operator: "contains_any", value: "{{input.keywords}}" }

step7 (map):
  field_mapping: { full_email_text: "body", subject: "subject", ... }
```

Both reference `item.body` — but neither is an AI step or a deliver-extract action. The heuristic returned `hasExtractionConsumer: false`, `content_level` stayed unset, Gmail returned empty `body` fields, downstream rows appended with empty body cells.

**Schema-driven precision:** the Gmail plugin definition declares which fields are gated:

```json
"output_dependencies": [
  {
    "when_param": { "content_level": "metadata" },
    "unpopulated_fields": ["body", "snippet"]
  },
  {
    "when_param": { "content_level": "snippet" },
    "unpopulated_fields": ["body"]
  }
]
```

The union of `unpopulated_fields` across entries (= `{body, snippet}`) is the set of "fields that are populated only when `content_level: full`". If any downstream node references one of those fields, force `full`.

**Fix:**

1. Add a helper `getGatedOutputFields(plugin_key, action): Set<string>` that reads `output_dependencies` and returns the union of all `unpopulated_fields`.

2. Extend `enforceContentLevelForExtraction()` per fetch node:
   - Compute `gatedFields` for the fetch action
   - Walk all nodes and check whether any references a gated field via JSON-shape detection (value match `"<field>"` OR path tail `\.<field>"|}|\b`)
   - If yes → force `content_level: 'full'`
   - Existing AI / deliver-extract checks remain (fast-path)

3. The schema-driven approach is precise (uses the plugin's own declarations), generic (works for any plugin that declares `output_dependencies`), and minimizes false positives (only triggers when a gated field is actually referenced).

**Files:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (~50 lines: helper + extended detection), unit/integration test for `enforceContentLevelForExtraction` covering the deterministic-consumer case.

**Why this slipped past tests:** the existing test for WP-11 covers AI consumers but not deterministic ones — same blind spot family as the CP-D fingerprint measurement (W5 doesn't catch transform/map shape issues; WP-11 tests don't catch transform/filter body-references).

**Sibling check (audit during fix):** other plugins with `output_dependencies` blocks should be similarly handled. Search the plugin definitions for the key. Common candidates: any "search/list" action with a `content_level`, `verbosity`, or similar enum that gates body-like fields.

---

### WP-23: `transform/map` with numeric-key `field_mapping` produces objects, not 2D arrays

**Severity:** High (blocks Phase E for any scenario whose final step appends to Sheets via `google-sheets.append_rows`)
**Encountered as:** Phase E live run on `complaint-email-logger` (2026-05-10, post-WP-22 fix) — `Calibration stop: Non-retryable execution error at step "Append new complaint email rows to the UrgentEmails tab in Google Sheets"` (step11 returned null)
**Status:** ⬜ Documented — fix to follow

**Problem:** The LLM emits `transform/map` with `field_mapping: {"0": "sender_email", "1": "subject", ...}` as the canonical "convert objects to 2D array for Sheets append" pattern. The numeric-string target keys are intended as **array indices**:

```json
"field_mapping": {
  "0": "sender_email",
  "1": "subject",
  "2": "date",
  "3": "full_email_text",
  "4": "gmail_message_link_id"
}
```

But [`transformMap` Mode 0](../../lib/pilot/StepExecutor.ts) builds a plain object via `mapped[targetField] = item[sourceField]`. Result:

```json
[
  { "0": "barak@x.com", "1": "complaint", "2": "Sun...", "4": "msg-1" },
  ...
]
```

— an array of objects with numeric-string keys (note `"3"` may be missing if the source field is undefined). Downstream `google-sheets.append_rows` expects a 2D array (`[[row1...], [row2...]]`) for the `values` parameter; it receives these malformed objects and returns null. Runtime classifies that as a non-retryable error and aborts.

**Why this slipped past CP-D:** the W5 fingerprint measurement only inspects `ai_processing` step prompts. A `transform/map` step with non-canonical `field_mapping` doesn't show up in the deterministic-AI-fallback axis. Same blind spot as WP-SR / WP-20 / WP-22.

**Why the LLM emits this:** the user's prompt typically says "append rows where col 1 is sender, col 2 is subject, col 3 is date..." (1-based) or "the columns are sender, subject, date..." (positional). The LLM correctly reads this as a column-ordered list and wants to express "produce arrays". Lacking a canonical primitive for "objects-to-rows", it picks `transform/map` with numeric target keys as the closest fit.

**Three intervention options (analogous to WP-20/21/22):**

A. **Runtime tolerance** in `transformMap` Mode 0:
   - Detect: all `field_mapping` target keys are non-negative integer strings (`/^\d+$/`)
   - When detected: produce `[Array(N+1).fill(null).map((_, i) => item[mapping[String(i)]])]` per row instead of an object
   - Length = `max(numericKeys) + 1`; gaps fill with null
   - Pro: smallest blast radius; consistent with rest of WP family.

B. **Compiler-side rewrite**: detect at compile time and emit a different op (e.g., `objects_to_rows` with explicit `column_order: ["sender_email", "subject", ...]`).
   - Pro: keeps runtime strict; explicit op better for tooling.
   - Con: heavier; needs new op + grammar.

C. **LLM emission steering**: tell Phase 1 LLM "to convert array-of-objects to 2D array, use [different op or shape]".
   - Pro: targets root cause.
   - Con: depends on compliance; the natural phrasing is "field 0 = X" so the LLM will likely keep using numeric keys.

**Recommended fix:** A.

```ts
// In transformMap Mode 0 (lib/pilot/StepExecutor.ts)
const allNumericKeys = Object.keys(mapping).every(k => /^\d+$/.test(k));
if (allNumericKeys && Object.keys(mapping).length > 0) {
  const indices = Object.keys(mapping).map(k => parseInt(k, 10));
  const len = Math.max(...indices) + 1;
  const applyToArray = (item: any) => {
    const row = new Array(len).fill(null);
    for (const [target, src] of Object.entries(mapping)) {
      row[parseInt(target, 10)] = item ? item[src] ?? null : null;
    }
    return row;
  };
  if (Array.isArray(data)) return data.map(applyToArray);
  if (data && typeof data === 'object') return applyToArray(data);
}
// fall through to existing object-building behavior...
```

**Files:** `lib/pilot/StepExecutor.ts` (~15 lines in `transformMap`), `lib/pilot/__tests__/StructuredTransforms.test.ts` or new test file (4–6 tests).

**Sibling failure mode (separate, lower priority):** `full_email_text` resolves to undefined in step10 even though step7's `field_mapping` declares `full_email_text: "body"`. Likely Gmail `search_emails` returned without `body` populated — same WP-11 family (`content_level: full` not auto-applied). Track separately; doesn't block WP-23.

---

### WP-22: `set_difference.reference` bare RefName not resolved by runtime

**Severity:** High (blocks Phase D / Phase E for any scenario using `set_difference` with a runtime variable reference)
**Encountered as:** Phase D rerun on `complaint-email-logger` after WP-21 fix landed (2026-05-10) — `Step step8 failed: set_difference.reference must resolve to an array; got string`
**Status:** ⬜ Documented — fix to follow

**Problem:** Convention mismatch between the IR converter (compile-time) and the runtime transform. The IR converter for `set_difference` emits the reference as a **bare RefName**:

```ts
// lib/agentkit/v6/compiler/IntentToIRConverter.ts (~line 1346)
transformConfig.reference = this.resolveRefName(refName, ctx)
//   → "existing_message_ids"  (bare string, no {{}})
```

But the runtime calls `context.resolveVariable()` to look it up:

```ts
// lib/pilot/transforms/StructuredTransforms.ts (~line 210)
} else if (typeof config?.reference === 'string') {
  const resolved = context.resolveVariable(config.reference);
  ...
```

And [`ExecutionContext.resolveVariable`](../../lib/pilot/ExecutionContext.ts) requires `{{...}}` template syntax:

```ts
if (!reference.includes('{{')) {
  return reference;  // returned as literal string!
}
```

So `resolveVariable("existing_message_ids")` returns the literal string `"existing_message_ids"`. The runtime sees `typeof resolved === 'string'` and throws.

**Why it didn't fail before WP-SR:** the cascade had to first survive steps 1–7 to even reach `set_difference`. Pre-WP-SR the chain blew up at step5 (`project_column.by_index` on object rows) or earlier. Post-WP-20+WP-21, step8 is now reachable.

**Two fix options:**

**A. IR converter emits `{{varname}}`** (recommended):
```ts
transformConfig.reference = `{{${this.resolveRefName(refName, ctx)}}}`
```
Pro: matches the convention used elsewhere (e.g., `step.input` is `"{{varname}}"`). Single source of truth — IR represents runtime variable refs with `{{}}` syntax. Tooling that reads the IR sees a normal variable reference.
Con: slight asymmetry with `transformConfig.input` which is bare. But `input` is duplicated at the top-level `step.input` (which IS wrapped) — the bare form there is for IR-tracking only, not runtime resolution.

**B. Runtime uses `getVariable(name)` for bare RefNames:**
```ts
} else if (typeof config?.reference === 'string') {
  const refName = config.reference.replace(/^\{\{\s*|\s*\}\}$/g, '');
  const resolved = context.getVariable(refName);
  ...
```
Pro: tolerant of either form. Con: adds runtime logic; doesn't fix the underlying convention mismatch.

**Recommended:** A. Tiny change (1 line in converter), aligns with existing convention.

**Files (Option A):** `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (~1 line), unit test in compiler tests verifying the emission, regression test in `StructuredTransforms.test.ts`.

**Possible siblings to audit:** other transforms that also use `resolveRefName` for runtime-resolved fields:
- `with_fields` Expression refs (already use `{{}}` per W2 normalization — confirmed safe)
- `loop.over` (already wrapped at the `step.input` level — confirmed safe)
- `aggregate.input` (uses top-level `step.input` — confirmed safe)

`set_difference.reference` appears to be the only emit site with this bug. Audit the others to confirm.

---

### WP-21: `contains_any` rejects string RHS when config value is comma-separated

**Severity:** High (blocks Phase D / Phase E for any scenario where LLM emits keyword-list config as a comma-separated string)
**Encountered as:** Phase D rerun on `complaint-email-logger` after WP-20 fix landed (2026-05-10) — `Step step6 failed: contains_any requires an array on the right side, got string`
**Status:** ⬜ Documented — fix to follow

**Problem:** `contains_any` is a set-membership operator added in W2/contains_any work. It expects the right-hand side to be an array of values to match against:

```
case 'contains_any':
  ...
  if (!Array.isArray(right)) {
    throw new ConditionError(
      `contains_any requires an array on the right side, got ${typeof right}`,
      ...
    );
  }
```

But the LLM commonly emits keyword-list values in `workflow_config` as a single comma-separated string, mirroring how users write keyword lists in prose:

```
// User's enhanced-prompt.json:
"if the email content contains any of these keywords (case-insensitive match):
 'complaint', 'refund', 'angry', 'not working'"

// LLM's workflow_config:
"complaint_keywords": "complaint, refund, angry, not working"   ← single string
```

The condition resolves `value: "{{input.complaint_keywords}}"` to that string, runtime sees `Array.isArray(right) === false`, hard-throws.

**Why this collides with the WP-SR family:** same shape — the LLM's natural emission style (string for human-written keyword lists) doesn't match the runtime's strict contract (array required). Like WP-SR (`column_N` keys in `field_mapping`) and WP-20 (`by_index` on object rows), the runtime can either be tolerant or strict; tolerance is the safer default since the user's intent is unambiguous.

**Three intervention options (analogous to WP-20):**

A. **Runtime tolerance** in `ConditionalEvaluator` — when the RHS resolves to a string, split on comma + trim, treat as array. Limit the split to operators that semantically take a list (`contains_any`, `in`, `not_in`). Same philosophy as WP-SR's `column_N` and WP-20's object-row tolerance: be liberal in what you accept from LLM emissions.

B. **Compiler-side conversion** — at value-resolution time, when an operator semantically requires an array but the resolved value is a string, split. Tighter scope, but requires plumbing operator metadata into the compiler.

C. **LLM emission steering** — Phase 1 prompt rule: keyword-list config values must be JSON arrays, not comma-separated strings. Targets root cause but depends on LLM compliance and conflicts with how users write prose prompts.

**Recommended fix:** A (runtime tolerance).

```ts
case 'contains_any':
  ...
  let rightArr: any[];
  if (Array.isArray(right)) {
    rightArr = right;
  } else if (typeof right === 'string') {
    // WP-21: tolerate comma-separated strings — the LLM frequently emits
    // keyword-list config as a single string mirroring the user's prose.
    rightArr = right.split(',').map(s => s.trim()).filter(s => s.length > 0);
  } else {
    throw new ConditionError(
      `contains_any requires an array or comma-separated string on the right side, got ${typeof right}`,
      ...
    );
  }
  // ... use rightArr for matching ...
```

Should also extend the `in` and `not_in` operators with the same tolerance — same rationale.

**Files:** `lib/pilot/ConditionalEvaluator.ts` (~10 lines × 3 operators), `lib/pilot/__tests__/ConditionalEvaluator.contains_any.test.ts` (4 new tests: comma-separated string RHS, whitespace handling, empty string RHS, single-value string RHS).

---

### WP-20: `project_column.by_index` rejects object rows after WP-SR auto-inject

**Severity:** High (blocks Phase D / Phase E for any Sheets scenario using positional column extraction)
**Encountered as:** Phase D failure on `complaint-email-logger` (2026-05-10) — `Step step5 failed: project_column.by_index requires array rows; row 0 is object`
**Status:** ✅ Fixed — runtime tolerance for object rows

**Problem:** `transform/project_column` with `column.kind: "by_index"` hard-throws when the input is an array of objects rather than a raw 2D array:

```
case 'by_index': {
  if (!Array.isArray(row)) {
    throw new StructuredTransformError(
      `project_column.by_index requires array rows; row ${idx} is ${typeof row}`,
      'INVALID_INPUT_TYPE'
    );
  }
  return row[column.index];
}
```

This was correct pre-WP-SR: the auto-inject of `rows_to_objects` was dead (SchemaAwareDataExtractor stub), so Sheets `read_range` outputs flowed through to consumers as raw 2D arrays. The LLM saw "column E, index 4" in the user's prompt and emitted `column: { kind: "by_index", index: 4 }`, which worked.

After WP-SR landed (commit 59c64cd), the auto-inject works — the compiler now inserts `rows_to_objects` (with `preserve_case: true`) before any consumer of the Sheets wrapper. So by the time `project_column` runs, rows are objects with header keys (`{Date, "Lead Name", Stage, ...}`), not arrays. `by_index: 4` blows up.

**Concrete cascade (complaint-email-logger):**
```
step3: read_range                  → existing_sheet_data (2D wrapper)
step4: rows_to_objects (auto)      → existing_sheet_data_objects (array of objects)
step5: project_column by_index: 4  → ❌ throws — row is object
```

**Sister bug:** identical shape to the original WP-SR failure in `transform/map`'s WP-4 `field_mapping` Mode 0, where the LLM emitted `column_N` source keys after the same upstream conversion. Both are post-WP-SR collisions where the LLM's positional emission (chosen because the user's prompt says "column N") doesn't match the runtime's now-converted input.

**Fix:** Same pattern as the WP-SR `column_N` runtime tolerance. When `column.kind === 'by_index'` and the row is an object, fall back to `Object.values(row)[index]`. The auto-inject's `preserve_case: true` keeps insertion order matching column order, so positional access via `Object.values` gives the expected column.

```ts
case 'by_index': {
  if (Array.isArray(row)) {
    return row[column.index];
  }
  if (row && typeof row === 'object') {
    // Post-WP-SR: rows_to_objects converts 2D arrays to objects with header
    // keys. The LLM may still emit `by_index` thinking the input is a raw
    // 2D array. Fall back to positional access via Object.values, which
    // works because rows_to_objects(preserve_case=true) keeps key insertion
    // order matching column order.
    return Object.values(row)[column.index];
  }
  throw new StructuredTransformError(
    `project_column.by_index requires array or object rows; row ${idx} is ${typeof row}`,
    'INVALID_INPUT_TYPE'
  );
}
```

**Files:** `lib/pilot/transforms/StructuredTransforms.ts` (~10 lines), `lib/pilot/__tests__/StructuredTransforms.test.ts` (one existing test asserting throw needs to flip; add 2 new tests for the fallback).

**Secondary issue (separate, lower priority):** in the failing scenario, step5's `output_schema` was the read_range wrapper (`{values, row_count, ...}`), not the column-of-strings shape `project_column` actually produces. The compiler is propagating the input schema as the output schema for `project_column` — wrong but doesn't block runtime. Track separately if it confuses downstream consumers.

**Why this slipped past CP-D:** the CP-D measurement only counted W5 fingerprints (deterministic-AI-fallback firings) — it didn't actually run the compiled DSL. Same blind spot as the WP-SR finding: LLM emission analysis doesn't catch runtime data-flow bugs. Need CP-E (Phase D + Phase E across all 10 scenarios) to surface this class.

---

## Phase D Hardening Roadmap

These are improvements to Phase D (mock WorkflowPilot execution) designed to catch more of the Phase E class of bugs without paying the token cost of live LLM calls. WP-9 (F7 — real LLM in Phase D+) is the ultimate answer but has been deferred. The items below close specific gaps observed during WP-11 through WP-14.

### PD-1: Realistic plugin mock payloads (high value)

**Problem:** Current mocks return stub strings (`"mock_content_001"`, `"mock_body_001"`) and always populate every schema field. Real plugins often return partial data, empty strings, whitespace-only values, or respond differently based on input params. The stub shape hid WP-11 (search_emails with unset content_level returned empty body in real life, non-empty body in mock), WP-13 (mock always non-empty so hallucination path never triggered), and WP-14 (stub payloads were too small to trigger token bloat).

**Proposed solution:**

1. **Use `example_output` from plugin definitions when available.** Most v2 plugin definitions already include an `example_output` block documenting the canonical response shape. Mock executor should return `example_output` (possibly with IDs/timestamps randomised) instead of synthesising from schema.

2. **Parameter-aware mock responses.** The mock for `google-mail.search_emails` should inspect the caller's `content_level` param and return `body: ""` when `content_level !== 'full'`, matching real Gmail API behavior. Same pattern for `include_attachments`, `max_results`, etc.

3. **Realistic payload sizes.** Email bodies, document content, sheet cells should be 1–3KB of varied text (not 20-byte stubs). This surfaces token-budget issues in Phase D that previously only appeared in Phase E.

4. **Variant mock modes** (optional): support `MOCK_SCENARIO=quiet-day` to return zero results from any search/list action, exercising WP-13's empty-input guard in Phase D.

**Files:** mock executor (to be located — likely `lib/pilot/mocks/` or `scripts/test-workflowpilot-execution.ts`), each plugin definition's `example_output`.

**Priority:** P1 — would retroactively catch WP-11, WP-13, and WP-14 in Phase D.

---

### PD-2: Plugin-schema conformance — DEFER (already covered)

Initially considered — adding a Phase D check that verifies compiled plugin params match the plugin's schema semantics. On reflection this duplicates WP-12's compile-time guard (schema-driven reroute of file-only plugins for text inputs) and the existing `PluginParameterValidator` runtime validation. Not worth building. If a binding escapes both, the right fix is to improve WP-12's heuristics, not add a parallel check.

**Status:** ❌ Skipped — redundant with existing mechanisms.

---

### PD-3: Token-budget warnings (cheap, defense in depth)

**Problem:** Phase D mocks don't surface token bloat. WP-14 hit 39K tokens against a 30K TPM limit only in Phase E. A lightweight compile-time warning + runtime warning can flag bloat patterns before Phase E.

**Proposed solution:**

1. **Compile-time warning:** When the compiler finds a `scatter_gather` whose input could exceed ~10 items feeding directly into an `ai_processing` step, emit a compiler warning advising the user that large collections + AI steps risk TPM limits. Cheap — just graph inspection, no token estimation needed.

2. **Runtime warning:** In `callLLMDirect`, log a WARN when the prompt exceeds 80% of the target model's TPM budget (e.g. 24,000 tokens for a 30,000 TPM model). Gives operators an early signal before 429s fire. Single log line, no new infrastructure.

3. **No static token estimation:** Avoiding this deliberately — real token counts depend on real data sizes, approximations would produce false positives or miss edge cases. The structural fix (WP-14's no-merge-for-extract) already addresses the most common pattern.

**Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (compile warning), `lib/pilot/StepExecutor.ts` (runtime warning in `callLLMDirect`).

**Priority:** P2 — structural fixes already in place; these are safety nets.

---

### PD-4: Phase D+ with real LLM — see WP-9

Already documented as WP-9 / F7 — deferred due to ~$0.10-0.15 per run token cost. Revisit when scenario count grows above 10 and regression confidence becomes critical. Would catch WP-13 hallucination class and WP-14 token bloat directly.

---

## Implementation Priority

| Priority | Weak Point | Impact | Status |
|----------|-----------|--------|--------|
| **P0** | WP-2: Field name mismatches | Breaks every cross-plugin flow | ✅ Fixed |
| **P0** | WP-4: `custom_code` map | Breaks every transform with non-matching field names | ✅ Fixed |
| **P1** | WP-3: AI in scatter-gather | Breaks any AI inside loops | ✅ Fixed |
| **P1** | WP-1: notify step handling | Breaks non-send plugin actions | ✅ Fixed |
| **P2** | WP-5: group output shape | Breaks complex grouping | ✅ Fixed |
| **P2** | WP-10: Scatter error handling | Misleading success reports | ✅ Fixed |
| **P2** | WP-6: Structured ref objects | Breaks computed values | ✅ Fixed |
| **P3** | WP-9: LLM output validation | Only caught in Phase E | ⬜ Deferred |
| **P3** | WP-7: Label resolution | Race condition, extra API calls | ✅ Fixed |
| **P3** | WP-8: Email encoding | Non-English content | ✅ Fixed |
| **P0** | WP-11: search_emails content_level | User receives fabricated data on any email-extraction workflow | ✅ Fixed |
| **P0** | WP-12: document-extractor misrouted to email text | User receives "Unknown" placeholder rows for every extracted field | ✅ Fixed |
| **P0** | WP-13: AI hallucination on empty input | User receives fabricated data as if it were real | ✅ Fixed |
| **P0** | WP-14: scatter token bloat + extract output shape | User hits 429 rate limit on real data; contract scenario misroutes | ⚠️ Partial fix — multi-nested-step scatter body case reopened 2026-04-14 |
| **P1** | PD-1: Realistic plugin mocks | Phase D can't catch plugin-default quirks, empty results, token bloat | ⬜ Open |
| **P2** | PD-3: Token-budget warnings | Token bloat only visible in Phase E | ⬜ Open |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-10 | WP-25 fixed — runtime tolerance for 4 positional-key patterns + prompt steering toward canonical numeric form | Phase E re-run on `complaint-email-logger` (post-WP-24 fix; body cells now populated) failed at step10 (`append_rows`) because step9 emitted `field_mapping: {column_A: "sender_email", column_B: "subject", ...}`. WP-23's `^\d+$` regex didn't match → runtime built objects with column-letter keys → Sheets append got malformed input → returned null. Two-layer fix: **(a) runtime tolerance:** `parsePositionalKey()` helper in `StepExecutor.ts` recognizes all four observed positional patterns — numeric (`"0"`), `column_<digit>` (`"column_0"`), Excel letter (`"A"`, `"AA"`), `column_<letter>` (`"column_A"`) — and maps each to a 0-indexed column position via Excel-style letter conversion (A=0, B=1, ..., Z=25, AA=26). When ALL target keys parse as positional, runtime emits a 2D array per row. **(b) prompt steering:** section 6.11 (DELIVER) now declares numeric-string `"to": "0"` as the canonical form for row-oriented destinations (`append_rows` and similar) and explicitly enumerates the 3 non-canonical equivalents to avoid. Defense in depth: prompt converges LLM on one pattern (reduces variance, makes IRs predictable); runtime tolerance handles drift if LLM picks an alternate. 12 new unit tests in `transformMap.numeric-keys.test.ts` covering each pattern + mixed-positional + canonical complaint-logger column_A failure + regression guards. 196/196 known-good tests passing (was 184). The complaint-email-logger Phase E should now succeed end-to-end on re-run. |
| 2026-05-10 | WP-24 fixed — `content_level: 'full'` forced when deterministic consumers reference gated output fields | Schema-driven extension of WP-11. Reads the plugin's `output_dependencies` declarations to learn which fields are gated (populated only at `content_level: full`), then walks all transform/notify/deliver IR node configs and triggers the upgrade if any reference a gated field. Eliminates the deterministic-consumer blind spot that caused complaint-email-logger Phase E to append empty `full_email_text` cells. Generic across plugins — works for any action that declares `output_dependencies`. 17 new unit tests covering canonical filter+map patterns, fetch-node skip, substring-false-positive guards, and edge cases. 184/184 known-good tests passing (was 167 before WP-24). The complaint-email-logger Phase E should now produce non-empty body cells on re-run. |
| 2026-05-10 | WP-23 fixed — `transform/map` with numeric-key `field_mapping` now produces 2D arrays | Runtime tolerance in `transformMap` Mode 0: when all target keys match `/^\d+$/`, emit `Array(max+1).fill(null)` per row and assign by parsed index, rather than an object. Aligns with `google-sheets.append_rows` contract (2D array of cell values). Sister fix to WP-SR (`column_N` source keys), WP-20 (object-row tolerance), and WP-22 (bare RefName tolerance) — all four are runtime-tolerance fixes for LLM emission patterns that don't match strict runtime contracts. **Phase D** continues to pass (9/9 steps; the conditional then-branch containing the affected step doesn't fire on mock data); the unit tests directly validate the algorithm on the canonical complaint-logger emission. **Phase E** is the actual validation — must be re-run on `complaint-email-logger` to confirm step10 produces a 2D array and step11 (`append_rows`) succeeds. **Sibling issue noted (separate, lower priority):** during the failed Phase E, `full_email_text` resolved to undefined for some rows (Gmail body wasn't fetched). Likely WP-11 family (`content_level: full` not auto-applied for the complaint-logger search). With WP-23, missing fields produce null cells instead of skipped keys — Sheets accepts null. |
| 2026-05-10 | WP-23 documented — `transform/map` with numeric-key `field_mapping` produces objects instead of 2D arrays | Surfaced during Phase E live run on `complaint-email-logger` (post-WP-22). Cascade reached step11 of 11, then `google-sheets.append_rows` returned null because step10 produced `[{"0":..., "1":..., "4":...}, ...]` (objects with numeric-string keys) instead of `[[row1], [row2], ...]` (2D array). LLM emits `field_mapping: {"0": "sender_email", "1": "subject", ...}` as the canonical "objects-to-2D-array" pattern but the runtime builds objects. Recommended fix: A — runtime tolerance in `transformMap` Mode 0 (detect numeric-only target keys, emit array per row). Same shape-mismatch family as WP-SR / WP-20 / WP-22. Documented; fix to follow as separate commit. Reinforces the CP-D blind spot (W5 fingerprint measurement only checks `ai_processing` prompts; can't catch `transform/map` shape issues). |
| 2026-05-10 | WP-22 fixed — `set_difference.reference` resolves bare RefName + emits `{{}}` form going forward | Two surfaces fixed: (A) `IntentToIRConverter.convertTransform()` for `set_difference` now emits `transformConfig.reference = "{{varname}}"` (matches convention used by `step.input` and other runtime refs), (B) `transformSetDifference` defensively wraps bare strings in `{{}}` before calling `resolveVariable` (handles existing phase4 files without forcing recompile, and tolerates any non-standard emission paths). 3 new unit tests in `StructuredTransforms.test.ts` using a stricter `resolveVariable` stub that mirrors the production contract (no `{{}}` → returns literal). **Phase D on complaint-email-logger now passes end-to-end** (9/9 steps completed, 0 failures) — was failing at step6 → step8 → finally green after WP-20 + WP-21 + WP-22 unblocked the full cascade. The complaint-email-logger Phase D is the canonical 4-WP integration test for the post-WP-SR Sheets pipeline. 157/157 known-good tests passing (was 154 before WP-22). |
| 2026-05-10 | WP-22 documented — `set_difference.reference` bare RefName not resolved by runtime | Surfaced during Phase D rerun on `complaint-email-logger` after WP-21 fix landed (cascade now reaches step8 instead of failing at step6). Convention mismatch: IR converter emits `reference: "existing_message_ids"` (bare RefName) but runtime calls `resolveVariable()` which requires `{{...}}` syntax. Two fix options (recommended: A — IR converter emits `{{varname}}`). Documented; fix to follow as separate commit. |
| 2026-05-10 | WP-21 fixed — runtime tolerance for comma-separated string RHS on `contains_any`, `in`, `not_in` | `coerceToArray()` helper in `ConditionalEvaluator.ts` accepts both array and comma-separated string forms (split on comma + trim). All three set-membership operators now tolerate either form. Same philosophy as WP-SR (`column_N`) and WP-20 (object rows): be liberal in what we accept from LLM emissions, since the user's prose-style "complaint, refund, angry, not working" is unambiguous. 11 new unit tests covering canonical complaint-logger pattern, whitespace handling, case-insensitivity, and array-RHS regression guards. 154/154 known-good tests passing (was 143 before WP-21). Phase D on complaint-email-logger advanced past step6 (was failing at step6 → now fails at step8 with WP-22). |
| 2026-05-10 | WP-21 documented — `contains_any` rejects string RHS when config is comma-separated | Surfaced during Phase D rerun on `complaint-email-logger` immediately after WP-20 fix landed (step5 now passes, step6 hits a new failure). LLM emitted `complaint_keywords: "complaint, refund, angry, not working"` (single comma-separated string in workflow_config) but `contains_any` requires the RHS to be an array. Same shape as the WP-SR family — LLM emission style mismatched with runtime contract. Documented with three intervention options (runtime tolerance preferred); fix to follow as a separate commit per user direction. |
| 2026-05-10 | WP-20 fixed — `project_column.by_index` tolerates object rows post-WP-SR | Phase D on `complaint-email-logger` failed at step5 (`project_column.by_index requires array rows; row 0 is object`). Diagnosed as the post-WP-SR sister of the original `column_N` collision: after the compiler's auto-inject of `rows_to_objects` (with `preserve_case: true`), Sheets-derived rows are now objects with header keys, but the LLM still emits `by_index: N` because the user's prompt says "column E (index 4)". Same fix shape as WP-SR's runtime tolerance for `column_N` in `transform/map`: `transformProjectColumn` now falls back to `Object.values(row)[index]` when row is an object. Works because `rows_to_objects(preserve_case=true)` preserves key insertion order matching column order. Updated 1 existing test (was asserting throw) and added 2 new tests for the fallback paths. Reinforces the CP-D blind spot: LLM-emission fingerprint measurement doesn't catch runtime data-flow bugs — need CP-E (Phase D+E across all 10 scenarios) to surface this class. |
| 2026-05-10 | WP-19 documented (future / latent risk) | During manual Phase 4 review of `aliexpress-delivery-tracker/output/phase4-pilot-dsl-steps.json`, observed that step3 is a single bulk `ai_processing` call (`input: "{{delivery_emails}}"`) instead of a scatter_gather, despite step6 in the same scenario correctly being a per-item loop for Gmail labeling. Investigation showed the LLM emitted Phase 1 step3 as `kind: "generate"` with `input: <whole array>` — bulk processing — while step6 correctly used `kind: "loop"`. Compiler faithfully translated both. The bulk-on-array pattern carries token-bloat (WP-14 family) + hallucination/omission risk + all-or-nothing failure mode. Three intervention options identified (prompt steering / compiler warning / compiler auto-rewrite). Deferred — current scenarios survive small inboxes; revisit when bulk-call failure is observed in Phase E. |
| 2026-05-10 | RETIRE-1: auto-repair safety nets retired (validateAISchemaDepth + WP-15 builder fallback) | CP-D verified 0/10 firings of both auto-repair safety nets across all regression scenarios — the retirement gate established by Q-A4 sequencing was met. Switched both from warn-and-repair to throw-on-violation: (a) [`ExecutionGraphCompiler.validateAISchemaDepth()`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) now throws when an AI-declared slot has `type: "array"` without `items` (or `type: "object"` without `properties`); (b) [`DataSchemaBuilder.buildSchemaFromNestedFieldSpec()`](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts) (added in [707a429](../../lib/agentkit/v6/capability-binding/__tests__/DataSchemaBuilder.wp15.test.ts) for WP-15) now throws on shallow nested specs instead of emitting `items:{type:"any"}` / `properties:{}` and a warning. Behavior change: future emissions that produce a shallow AI schema will fail the pipeline at compile time with a clear error instead of degrading silently. Easy to revert if the gate proves premature. **Deferred (RETIRE-2):** disabling AI fallbacks for the 5 retire-safe deterministic primitives (`project_column`, `set_difference`, `filter`, `group`, `dedupe`). The "fallback" lives in the LLM's emission choice (it picks `generate/internal` instead of the structured `transform` primitive) — there are no explicit fallback branches inside StepExecutor's transform functions. Genuine retirement requires extracting the W5 fingerprint logic from [`scripts/measure-redundant-ai-steps.ts`](../../scripts/measure-redundant-ai-steps.ts) into a shared module and wiring it into the compiler as a hard gate that rejects `generate/internal` prompts matching the retire-safe fingerprints. Larger blast radius; deserves its own PR + fresh CP-E measurements (post-WP-SR + null-key changes) before committing. |
| 2026-05-10 | WP-SR shipped + CP-D sweep finding | After AUDIT-1 (`SchemaAwareDataExtractor` + `VisionContentBuilder` restoration), discovered that the runtime cascade for Sheets-style 2D-array → object workflows was still broken. Phase E on `leads-per-salesperson-email` produced `[{}, {}, ...]` at the LLM-emitted `transform/map` step because `rows_to_objects` (now firing post-restoration) was lowercasing headers (`"Lead Name"` → `"lead name"`) while the LLM's `field_mapping` referenced original-case headers (`{date: "Date", lead_name: "Lead Name"}`) — every `item["Date"]` lookup returned undefined. Fixed in WP-SR with three coordinated changes: (a) `config.preserve_case: true` opt-in on `rowsToObjects` (extracted to pure module `lib/pilot/transforms/RowsToObjects.ts` for testability), (b) compiler auto-inject now sets `preserve_case: true`, (c) `transformMap` Mode 0 now tolerates `column_N` source keys via positional access (`Object.values(item)[N]`) for the LLM's non-canonical alternative emission. Plus a `group transform null-key guard` follow-up: items whose group-by field resolves to null/undefined/empty-string are dropped by default with a single aggregated warning (was: silently grouped under literal `"null"` and downstream sent emails to recipient `"null"`); opt-in `config.include_null_keys: true` restores legacy behavior. Plus DSL simulator now understands `rows_to_objects` (cosmetic warning fix). **Phase E verified end-to-end on `leads-per-salesperson-email`**: 3 qualified leads filtered, summary email sent, 2 of 3 per-salesperson emails delivered (the 3rd dropped because Lead 5's source row was missing the Sales Person column — the null-key guard now prevents the silent send-to-`"null"` failure mode). 141/141 tests passing (134 prior + 7 new). **CP-D sweep finding (logged for transparency):** of the 10 regression scenarios, 4 use `google-sheets.read_range` (`complaint-email-logger`, `gantt-urgent-tasks`, `leads-email-summary`, `leads-per-salesperson-email`) — all 4 had phase4 outputs compiled pre-restoration and so were missing the auto-injected `rows_to_objects` step; all 4 would have failed end-to-end at runtime the same way `leads-per-salesperson-email` did before WP-SR. `orders-po-extractor-xlsx` uses `transform/group` on `vendor` and benefits from the null-key guard if any extracted line item lacks vendor. **The W5 / CP-D fingerprint measurement (5–6 primitives safe-to-retire) remains valid for the deterministic-AI-fallback axis** — but did not exercise the runtime data-flow axis. Re-running Phase E across all 4 Sheets scenarios with the post-WP-SR pipeline is recommended next time those scenarios are touched. |
| 2026-05-10 | AUDIT-1: V6 utility files restored from `8a9b720` (silently nuked by `eb22311` April merge) | Phase E run on `leads-per-salesperson-email` produced an empty email — investigation traced the failure to a 2D-array→objects conversion that should have been handled by [`SchemaAwareDataExtractor.ts`](../../lib/pilot/utils/SchemaAwareDataExtractor.ts), which turned out to be a 28-line stub. Git archaeology revealed the original 426-line implementation existed at V6 introduction (`8a9b720`) and was silently overwritten by commit `eb22311` ("feat: add core infrastructure and enhance existing plugins" — a 44-file mega-merge with +11,770/-3,708, almost certainly a long-lived branch merged from a state pre-V6). Two days later (`2f8d982`) someone patched the type contracts with stubs returning hardcoded false values, but never restored the implementation — so callers (`ExecutionGraphCompiler.detectOutputIs2DArray()`, `StepExecutor.analyzeOutputSchemaStructure()`) silently received garbage from April 10 to May 10 (~30 days). **Audit identified two more `eb22311` victims:** [`VisionContentBuilder.ts`](../../lib/pilot/utils/VisionContentBuilder.ts) (452→17 lines, vision/PDF processing was a no-op — likely affecting `expense-invoice-email-scanner` and `orders-po-extractor-xlsx`) and `lib/debug/DebugSessionManager.ts` (309→23 lines, but pre-existing static-vs-instance API mismatch with WorkflowPilot — separate issue, deferred). **Restored from `git show 8a9b720:<file>`:** `SchemaAwareDataExtractor.ts` (+426 lines) and `VisionContentBuilder.ts` (+452 lines). Typecheck clean; existing 118/118 test suite passes (W2 + WP-15 + WP-17/18 + contains_any + W2-pipeline integration). **Other findings (not eb22311 fault, documented for transparency):** `lib/extraction/utils/SchemaAwareDataExtractor.ts` and `lib/extraction/UniversalExtractor.ts` are also stubs but are dead code (no imports anywhere), so harmless. **Process gap:** the `eb22311` PR description claimed "Enhanced schema-aware utilities" — it actually deleted them. Need a process to catch large net-deletions in code review (e.g., automated stub detector flagging functions whose entire body is `return false/null/[]/{}`). |
| 2026-05-10 | CP-D verified WP-15 end-to-end — both safety nets fire 0 times across 10 scenarios; eligible for retirement | Full LLM regen of all 10 regression scenarios with the WP-15 prompt + grammar + builder changes (`output-cp-d/`). **DataSchemaBuilder fallback firings: 0/10** (the new WP-15 warning path didn't fire on any scenario). **Compiler `validateAISchemaDepth()` auto-repair firings: 0/10** (task 4.6 auto-repair didn't fire on any scenario). Both retirement gates met. **Canonical reproducer (`complaint-email-logger`)** now produces `complaint_rows` slot with full 5-field nested shape — `array<{sender_email, subject, date, full_email_text, gmail_message_link_id}>`, exactly matching the prompt example, with `source: "ai_declared"` propagated through all levels. Pre-WP-15 the same slot was depth-1 `{type: "array"}` with no `items.properties` — that was the failure mode WP-15 was designed to close. W5 measurement on `output-cp-d`: 17 ai_processing total, 1 residual hit (down from 2 in CP-C), 6 of 7 W2 primitives now SAFE TO RETIRE (up from 5 — `sort` joined). Both auto-repair safety nets (compiler 4.6 + IRFormalizer 7.3) are eligible for removal per the original retirement gates. |
| 2026-05-10 | WP-15 fixed — nested NestedFieldSpec walk shipped (tasks 0.4 + 0.5 + 0.6 + 2.11) | Closed the shallow AI-declared `output_schema` gap end-to-end. Grammar in [`semantic-plan/types/intent-schema-types.ts`](../../lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts) now exposes a recursive `NestedFieldSpec` (`{type, required?, description?, items?, properties?}`) reused by both `extract.fields[]` and `generate.outputs[]`. Phase 1 system prompt section 6.4.1 documents the rule with positive (5-field complaint-logger array-of-objects) + negative (depth-1 form, REJECTED) examples plus a producing-slot table mapping common upstream field names (`from`/`subject`/`internalDate`/`id`) to ✅ correct vs ❌ invented forms (`sender`/`title`/`date`/`message_id`). [`DataSchemaBuilder.ts`](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts) gained a recursive `buildSchemaFromNestedFieldSpec()` helper that walks `items` and `properties` into the runtime `SchemaField` tree; `inferSchemaForExtractStep()` and `inferSchemaForGenerateStep()` both use it. When the LLM declares `type: "array"` without `items` (or `type: "object"` without `properties`), the builder emits a permissive fallback (`items:{type:"any"}` / `properties:{}`) AND a warning with dotted path so the W5 measurement can count residual firings. **Tests:** 11 new unit tests in [`DataSchemaBuilder.wp15.test.ts`](../../lib/agentkit/v6/capability-binding/__tests__/DataSchemaBuilder.wp15.test.ts) covering canonical complaint-logger shape, source propagation through 3 nesting levels, mixed scalar+nested in same outputs[], invoice line-items extract pattern, and the 4 fallback-warning paths. **118/118 total tests passing** (107 prior + 11 new). **Sequencing constraint preserved (Q-A4):** the auto-repair safety net at WORKPLAN.md task 7.3 / 4.6 stays — once a regen sweep shows 0 fallback-warning firings across the 10 regression scenarios, retire the safety net per the original gate. |
| 2026-05-10 | CP-C complete — full LLM regeneration on all 10 scenarios + 2 compiler robustness fixes | After WP-16 W2 primitives + W3 prompt update + WP-17/WP-18 DataSchemaBuilder corrections, ran a fresh end-to-end LLM regeneration on every regression scenario (`output-cp-c/`). Initial sweep: 8/10 succeeded, 2 hit compiler errors. **Fix #1 — `po-monitor-supplier-confirmation`:** `step.notify.recipients.to.map is not a function` because the LLM emitted a single `ValueRef` object instead of an array of `ValueRef`s. Hardened both `convertNotify()` call sites in [`IntentToIRConverter.ts`](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts) (~lines 1043 and 1094) to coerce a non-array `to` field into a single-element array before mapping. **Fix #2 — `leads-email-summary`:** three layered failures revealed by adding stack-trace logging to the compilation catch block: (a) `loadPluginAction()` only tried the `${pluginKey}.json` filename but real plugin definitions use `${pluginKey}-plugin-v2.json` (e.g. `google-mail-plugin-v2.json`) — fixed to try the v2 suffix first then fall back; (b) `loadPluginAction()` only handled legacy array-form `actions: [...]` but V2 definitions use object form `actions: {[name]: ActionDef}` — fixed to handle both shapes; (c) `analyzePluginDataFormat()` iterated `actionDef.parameters` as an array but V2 uses JSON Schema object form `{type: "object", required: [...], properties: {name: schema}}` — added normalization that flattens V2 properties to legacy `[{name, ...schema}]` entries before the inspection loop; (d) `detectNullableToRequiredMappings()` did `new Set(schema.required)` directly but some upstream emitters produce non-array `required` (boolean form) — added defensive `Array.isArray(schema.required) ? ... : []` coercion. **Final W5 measurement (post-fix, all 10 scenarios):** ai_processing total 17 (down from 30 baseline), residual hits 2 (down from 5 baseline). SAFE TO RETIRE: `project_column`, `set_difference`, `filter`, `group`, `dedupe` (5 of 7 primitives at residual=0). KEEP FALLBACK: `with_fields` (1 hit in po-monitor template substitution) and `sort` (1 hit in contract-enddate sort-after-compute). Per Q-A4 sequencing in DESIGN_REBASE, the 5 retire-safe primitives are now eligible to have their AI fallback paths in `StepExecutor` disabled in a follow-up. |
| 2026-05-08 | WP-17 + WP-18 fixed — DataSchemaBuilder corrections shipped | Four bug fixes shipped together as one cohesive change in `DataSchemaBuilder.ts`. WP-17 Bug A: nested-array unwrap so loops over wrapper-object slots (Gmail/Sheets search-results pattern) get the correct per-iteration item schema instead of the wrapper schema. WP-17 Bug B: multi-loop `item_ref` collision merge via new `DataSlot.produced_by_loops[]` field — preserves the slot when 2+ loops share an item name (canonical: 3-loop `aliexpress-delivery-tracker` pattern), warns on genuine schema-mismatch collisions. WP-18 Bug A: `inferSchemaForTransformStep()` honors LLM-declared `transform.output_schema` first across ALL transform ops, including the previously-ignoring shape-preserving filter/sort/dedupe path. WP-18 Bug B: shape-preserving inheritance walks wrapper-object inputs via `unwrapWrapperToArray()` to find the nested array — mirrors the Phase 4 compiler's `rows_to_objects` auto-inject at the schema level (avoids reordering phases). All four fixes covered by 14 new unit tests in `lib/agentkit/v6/capability-binding/__tests__/DataSchemaBuilder.wp17-wp18.test.ts`. 101/101 total tests passing. Compounds with W2/W3/D — cross-step type validator now has trustworthy slot schemas to enforce against. |
| 2026-05-08 | Drift investigation — W2 scope corrected | Pre-W2 trace confirmed `transform/reduce` is fully supported end-to-end (LLM `aggregate` → IR converter `convertAggregate()` → runtime `StepExecutor.transformReduce`). Original "drift" finding read the wrong source file — the active V6 IntentContract grammar at [`semantic-plan/types/intent-schema-types.ts:322`](../../lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts#L322) does include `reduce`, `merge`, `select`. Minor real drifts: `merge` lacks top-level runtime case (low impact — LLM uses `map` with multi-source `inputs[]`); `dedupe` vs `deduplicate` naming. WP-16 task 0.8 narrowed to actually-needed primitives (`with_fields`, `project_column`, `set_difference`, `filter.where contains_any`). Headline finding unchanged: `with_fields` is the leverage point for 5 of 10 WP-16 instances. See [V6_WP16_INVENTORY.md § Drift Investigation](./V6_WP16_INVENTORY.md#drift-investigation-2026-05-08). |
| 2026-05-08 | W1 complete — WP-16 task 0.7 inventory finished | Full sweep of all 10 regression scenarios. Output: [V6_WP16_INVENTORY.md](./V6_WP16_INVENTORY.md). 30 ai_processing steps total; 10 (33%) are WP-16 instances spread across 6 of 10 scenarios (complaint, expense-invoice, contract-enddate, gantt, orders-po, po-monitor); 18 legitimate AI; 1 borderline (XLSX synth). 4 scenarios (aliexpress, leads-per-salesperson, gmail-urgency, leads-email-summary) have ZERO WP-16 instances — confirms Phase 1 LLM uses primitives correctly when grammar provides them. **Highest-leverage missing primitive:** `transform/with_fields` (computed/derived fields) — 5 of 10 WP-16 instances depend on it; without it, multi-stage prep gets jammed into one ai_processing step (gantt "AI contagion"). **Drift surfaced:** `transform/reduce` is being emitted in DSL across 3 scenarios despite being absent from the [intent-schema-types.ts:143](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) enum — investigation required before W2. WP-16's status now 🟡 In progress; WP-16 task 0.8 description rewritten with priority-ordered concrete primitives. Path B Wave 1 ✅ complete. |
| 2026-05-08 | WP-16 augmented with `expense-invoice-email-scanner` sweep evidence | Sweep of scenario 3 surfaced no new structural WP but added concrete examples to WP-16's task 0.7 inventory scope. The LLM correctly used `transform/flatten`, `transform/filter`, and `aggregate` (subset/count) for deterministic ops — strong evidence that grammar availability (task 0.8), not vocabulary visibility (task 0.9), is the primary lever. One residual `generate/internal` step (`build_attachment_row`) implements a structured cross-source merge with computed field; routed to AI because (a) the `transform.operation` enum at [intent-schema-types.ts:143](../../lib/agentkit/v6/intent/intent-schema-types.ts#L143) omits `merge`/`reduce`/`select` despite the design table listing them (design/code drift), and (b) no `derive` / `with_fields` primitive exists for computed boolean fields. WP-16's task 0.7 description updated to require reconciling the drift and considering the new primitive. Also confirmed: WP-15 / WP-17 / WP-18 fingerprints absent from this scenario (different data flow shape — flat array filtering, no wrapper-unwrap chain, single loop). |
| 2026-05-08 | WP-18 documented — Shape-preserving transform inherits schema from wrong slot when compiler auto-unwraps input | Surfaced via `leads-per-salesperson-email` regression sweep (Path A continuation, scenario 2). The `filter_qualified_leads` step explicitly declared an `output_schema` of `array<{Date, Lead Name, ...}>`, but `qualified_leads` slot in data_schema came out as the Sheets wrapper (`{values, row_count, ...}`) because `DataSchemaBuilder` treats filter as shape-preserving and inherits the input slot schema unconditionally. Two compounding issues: (1) LLM-declared `transform.output_schema` is ignored for shape-preserving ops; (2) auto-injected `rows_to_objects` slot (`raw_leads_objects`) is missing from data_schema — task 4.5 was meant to register it but evidently doesn't fire. Three sources of truth disagree (slot schema vs DSL step config vs runtime data), and downstream cross-step type validation can't catch field-reference errors. Trigger: any workflow that filters / sorts / dedupes Sheets data or wrapper-style plugin output. Fix tasks queued in [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks 2.14 (honor LLM-declared output_schema) + 2.15 (audit auto-injected slot registration). Also confirms two diagnostic points: (a) `transform.output_schema` grammar already supports nested `items`/`properties` — narrows WP-15's scope to `generate.outputs[]` and `extract.fields[]` only; (b) when grammar primitives exist (filter, group), the LLM uses them correctly — strongly supports WP-16's primary lever being grammar (task 0.8) rather than vocabulary (task 0.9). |
| 2026-05-08 | WP-17 documented — Loop item slot misderived from nested array and overwritten across loops | Surfaced via `aliexpress-delivery-tracker` regression scenario sweep (Path A continuation after WP-15/WP-16 docs landed). Two adjacent bugs in `DataSchemaBuilder.buildLoopSlots()`: (1) `overSlot.schema.type === 'array'` check at [line 458](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts#L458) only handles top-level arrays — when a loop iterates over a wrapper-object slot like Gmail's `{emails: array, total_found, ...}`, the entire wrapper is copied as the item schema instead of unwrapping to `properties.emails.items`; (2) direct slot assignment at [line 466](../../lib/agentkit/v6/capability-binding/DataSchemaBuilder.ts#L466) with no collision check — when 3 loops share `item_ref: "email"`, the third call overwrites the first two and `produced_by` reflects only the last loop. Both bugs hide because runtime variable resolution doesn't consult the schema for iteration values (execution succeeds despite wrong schema), and WP-15's auto-repair masks the depth check from firing. Same "schema lies about reality" failure class as WP-13 / WP-15 — Direction #2's `AIOutputValidator` can't enforce correctness when the input-side schema is wrong. Common trigger: wrapper-object responses (Gmail/Drive/Sheets search), multi-loop patterns (mark-read + apply-label). Fix tasks queued in [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks 2.12 (nested-array unwrap) + 2.13 (multi-loop collision handling). |
| 2026-05-06 | WP-16 documented — Deterministic data operations routed to AI step | Surfaced via the same `complaint-email-logger` regression review that produced WP-15. 3 of 7 DSL steps (step4 column projection, step5 keyword filter, step6 anti-join dedup) compiled to `ai_processing` because Phase 1 declared `kind: "generate", domain: "internal"` for all of them. Two structural gaps: (1) Phase 1 vocabulary doesn't expose workflow primitives — only plugin actions are injected, so `generate/internal` is the path of least resistance; (2) IntentContract `transform` grammar lacks `project_column` and `set_difference` kinds, leaving free-text `rule: string` or `generate/internal` as the only options. Same pattern as WP-4 (free-text `custom_code` → structured `mapping[]`). Compounds WP-13 (silent fabrication on AI boundaries) and WP-15 (shallow AI schemas) — fix tasks queued in [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) (0.7–0.12). Solution D (compiler-side rewrite) is deferred and gated on 0.12 measurement. |
| 2026-05-06 | WP-15 documented — AI-declared output slots lose item-level shape | Surfaced via `complaint-email-logger` regression review: `phase2-data-schema.json` slots `existing_message_ids`, `candidate_rows`, `new_rows_to_append` are all depth-1 even though the prompt enumerates `sender email, subject, date, full email text, Gmail message link/id`. Root cause is structural — IntentContract `generate.outputs[]` / `extract.fields[]` grammar has no slot for `items` (arrays) or `properties` (objects), and `WORKPLAN.md` task 7.3 auto-repair masks the gap by silently degrading to `items:{type:"any"}` / `properties:{}`. Same fabrication-risk class as WP-13 — Direction #2's `AIOutputValidator` fails open because there's nothing concrete to validate against. Fix tasks queued in [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) (0.4–0.6 grammar + prompt, 2.11 builder); 7.3 retirement gated on regression measurement. |
| 2026-04-14 | WP-14 reopened — multi-nested-step scatter body gap | Contract End-Date Summary Phase E: step7 (`ai_processing/generate`) failed with Anthropic 400 `"prompt is too long: 1,004,169 tokens > 1,000,000 maximum"`. Root cause: WP-14 original fix's `isExtractLike` guard is gated inside the **single-nested-step branch** of `processScatterItem()` at [ParallelExecutor.ts:403](../../lib/pilot/ParallelExecutor.ts#L403). The contract scenario's scatter body has **two** nested steps (step5 `read_file_content` fetching full document text ~165KB/doc, step6 `ai_processing/generate` extracting 5 small fields), which flows into the **multi-step branch** at [line 470](../../lib/pilot/ParallelExecutor.ts#L470) — no `isExtractLike` guard there, unconditionally spreads `{...item, ...step5.output, ...step6.output}`, preserving the full `content` string per iteration. 4 docs × ~165KB ≈ 1M tokens at step7. WP-14's original Verified note ("All 10 regression scenarios pass Phase D after fixes") held because Phase D uses stub plugin payloads ~20 bytes per field — invisible in mocks, only surfaces with realistic Phase E payloads. Exactly the [PD-1](#pd-1-realistic-plugin-mock-payloads-high-value) gap. Proposed fix: extend `isExtractLike` detection to the last nested step in the multi-step branch. Stronger long-term fix (deferred): compiler emits explicit `gather.output_source: "<last_step_output_variable>"` as a schema-declared contract per DESIGN_REBASE §P3. See D-B25 in `V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md` for the per-scenario discovery timeline. |
| 2026-04-05 | WP-11 & WP-12 documented | AliExpress Delivery Tracker scenario live run: user received email with fabricated "Unknown X" rows. Two root causes: (1) search_emails compiled without content_level=full — bodies empty; (2) document-extractor selected for free-text email body extraction instead of ai_processing. Both open. |
| 2026-04-05 | WP-13 documented | AliExpress Delivery Tracker scenario live run (after WP-11/12 patches): search_emails returned 0 results due to stale query, but downstream AI generate step fabricated a two-row HTML table with fake package numbers (12345, 67890) and fake products, which was sent to the user as if real. Distinct from WP-12: WP-13 fires whenever an AI step downstream of an empty collection has no guardrail against hallucination. |
| 2026-04-05 | WP-13 implemented | Two-layer guard in StepExecutor.executeLLMDecision: Layer 1 `detectEmptyAIProcessingInput` short-circuits with deterministic no-data payload (zero tokens); Layer 2 prepends "respond exactly 'No data available.' do NOT fabricate" guardrail to all ai_processing prompts. |
| 2026-04-05 | WP-11 implemented | `enforceContentLevelForExtraction()` post-pass in IntentToIRConverter walks the graph after conversion: if any extraction consumer exists (ai node, or deliver.extract*), finds all fetch nodes with content_level enum params and forces 'full'. Schema-driven, not plugin-specific. |
| 2026-04-05 | WP-12 implemented | Two-part fix: (1) `convertExtract()` in IntentToIRConverter checks if plugin expects file_attachment (via x-variable-mapping.from_type, x-input-mapping.accepts:file_object, or canonical file param names) — if yes AND source var is text-shaped, reroutes to AI extraction. (2) AI-only extract branch uses `ai_type: 'llm_extract'` (not `deterministic_extract`) so compiler emits `ai_processing` DSL step. Also tightened document-extractor plugin description + usage_context to explicitly document "FILES ONLY, not email bodies". |
| 2026-04-05 | WP-14 documented + fixed | Phase E failure: step4 hit 429 rate limit (39K tokens). Cascade of 3 bugs: (1) I3 only matched output_schema.properties, not output_schema.fields that V6 compiler emits; (2) Scatter-gather always merged full item with nested step output (~72KB for 14 emails + LLM envelope); (3) Runtime safety check misrouted already-extracted text content to deterministic_extraction. Fixed all three with surgical changes in StepExecutor + ParallelExecutor. All 10 regression scenarios still pass. |
| 2026-04-05 | Phase D Hardening Roadmap added | Four proposed improvements (PD-1 to PD-4) to close Phase D gaps observed during WP-11/12/13/14. PD-1 (realistic plugin mocks) and PD-3 (token-budget warnings) scheduled; PD-2 (schema conformance) skipped as redundant; PD-4 (real-LLM Phase D+) deferred per existing WP-9. |
| 2026-03-31 | WP-9 deferred | Phase D+ with real LLM (F7) deferred due to token cost (~$0.10-0.15 per run). Documented as future enhancement in execution workplan. |
| 2026-03-30 | WP-7 (pre-existing fix) | Gmail label 409 conflict recovery was already implemented as D-B10b before this document was created. Documented as fixed. |
| 2026-03-30 | Initial document | 10 weak points identified from D-B7 through D-B13 bug fixes across 2 scenarios. Proposed solutions documented for each. |
| 2026-03-31 | WP-8 implemented | `mimeEncodeHeader()` helper applies RFC 2047 encoding to all email headers: To, Cc, Bcc, Subject. Handles display names in addresses (`"ברק" <email>` → encoded display name + raw email). Previously only Subject was encoded. |
| 2026-03-31 | WP-2 root cause fix | Phase 2 field reference reconciliation in CapabilityBinderV2. After DataSchemaBuilder builds data_schema with actual field names, `reconcileFieldReferences()` walks all bound steps, validates `{kind:"ref", field:"X"}` against source schema, rewrites mismatches using prefix strip/case/space strategies. Fixes the root cause at binding time — before IR conversion. Phase 5 safety net retained as defense-in-depth. |
| 2026-03-31 | WP-6 implemented | Extended `rewriteConfigRefs` → `resolveStructuredRefs`. Now handles all `kind` values: `config` → `{{input.X}}`, `ref` → `{{var.field}}`, `literal` → raw value, `computed/concat` → joined string. Previously only handled `config`. |
| 2026-03-31 | WP-5 implemented | Compiler emits explicit group output config: `output_format`, `key_field`, `items_field` derived from output_schema. Runtime reads explicit config first (WP-5), falls back to schema inference (D-B12), then legacy object format. Verified on leads-per-salesperson scenario: `output_format=array, key_field=salesperson, items_field=leads`. |
| 2026-03-31 | WP-10 implemented | Scatter-gather error filtering in ParallelExecutor. After scatter completes: (1) separate success results from error objects `{error, item}`; (2) pass only successful items to gather; (3) if ALL items failed → throw ExecutionError instead of silent success; (4) attach `_scatter_metadata` with success/failed counts + error details. Downstream steps only see clean data. |
| 2026-03-30 | WP-3 Phase E verified | Gmail Urgency Flagging: 8/8 steps, 11 emails classified + labeled + HTML table summary sent. callLLMDirect handles classify (51K tokens) and generate (2.5K tokens) correctly. Labels applied via string→array normalization in base executor. |
| 2026-03-30 | HTML table preference | Added IntentContract prompt guidance: prefer HTML tables for email delivery when data is tabular. Generate steps now emit format:"html" with table instructions. |
| 2026-03-30 | Base executor param normalization | String→array normalization in BasePluginExecutor before schema validation. Fixes config values resolving as strings when schema expects arrays (e.g., add_labels). |
| 2026-03-30 | WP-3 implemented | `callLLMDirect()` method added to StepExecutor — direct provider call following BaseHandler.callLLM() pattern. All `ai_processing` steps (classify, generate, summarize, extract) now bypass both orchestration and `runAgentKit`. No memory loading, no plugin context, no tool loop. Removed D-B13 hacks: `_skipMemory` flag removed from `runAgentKit.ts`, system prompt override removed, orchestration skip expanded from generate-only to all ai_processing. `executeClassifyStep` also migrated to `callLLMDirect`. |
| 2026-03-30 | WP-1 implemented | Schema-driven param binding for `convertNotify()`. Loads action's parameter schema from plugin definition, matches IntentContract sources (recipients, content, options) to schema params by name. No more hardcoded `isSendAction` check. Falls back to heuristic if schema unavailable. Verified: `send_email` gets `recipients`+`content`, `modify_email` gets `message_id`+`add_labels`+`mark_important` — both via schema matching. |
| 2026-03-30 | WP-4 implemented | Structured field mapping from Phase 1 through runtime. LLM prompt updated to emit `mapping: [{to, from}]` for map transforms. IR converter converts to `field_mapping`. Runtime Mode 0 applies deterministic rename. Verified on Gmail Urgency Flagging: LLM emitted correct mapping (`sender←from`, `subject←subject`, `received_date←date`, `matched_keywords←urgency_classification`), `custom_code` eliminated. Backward compatible — old IntentContracts without mapping fall through to Mode 4. |
| 2026-03-30 | WP-2 implemented | Generic field name reconciliation in Phase 5. Schema registry built from workflow output_schemas + scatter item variables. Upstream tracing resolves item schemas through filter/transform chains. Strategies: prefix stripping (`message_id`→`id`), case-insensitive match, underscore/space normalization. Replaces D-B10 Gmail-specific hack. Verified on Gmail Urgency Flagging scenario. |
