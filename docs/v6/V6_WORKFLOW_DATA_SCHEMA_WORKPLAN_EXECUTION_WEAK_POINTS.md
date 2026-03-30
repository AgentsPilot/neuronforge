# V6 Pipeline — Execution Weak Points & Hardening Plan

> **Last Updated**: 2026-03-30
> **Branch**: `feature/v6-intent-contract-data-schema`
> **Parent workplan**: [V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_EXECUTION.md)

## Overview

This document catalogs the weak points identified during Phase E live execution testing of two scenarios (Gmail Urgency Flagging Agent, High-Qualified Leads Per-Salesperson Email Agent). Each weak point was either directly encountered as a bug (D-B7 through D-B13) or identified as a risk that will surface with new enhanced prompts and plugin combinations.

The weak points are ordered by likelihood of causing failures as new scenarios are added.

---

## Status Summary

| ID | Issue | Priority | Status |
|----|-------|----------|--------|
| [WP-1](#wp-1-intentcontract--ir-converter-notify-step-handling) | `notify` step assumes `send_email` — non-send actions get wrong params | P1 | ⬜ Needs fix |
| [WP-2](#wp-2-field-name-mismatches-between-plugin-output-and-downstream-references) | Field name mismatches (`message_id` vs `id`) across plugins | P0 | ⚠️ Partial — compiler safety net, root cause remains |
| [WP-3](#wp-3-ai_processing-steps-inside-scatter-gather) | `ai_processing` inside scatter-gather — memory/prompt/routing issues | P1 | ⬜ Needs architectural fix (defensive patches in place) |
| [WP-4](#wp-4-transformmap-with-custom_code-natural-language) | `transform/map` with `custom_code` — runtime can't execute NL | P0 | ✅ Fixed — structured `mapping` from Phase 1 |
| [WP-5](#wp-5-transformgroup-output-shape) | `transform/group` returns wrong shape for scatter-gather | P2 | ⬜ Needs fix (D-B12 patch in place) |
| [WP-6](#wp-6-structured-config-reference-objects) | Structured ref objects `{kind:"config"}` not resolved | P2 | ⚠️ Partial — `config` handled, other kinds not |
| [WP-7](#wp-7-gmail-label-resolution-timing) | Gmail label 409 conflict on concurrent creation | P3 | ✅ Fixed with 409 recovery |
| [WP-8](#wp-8-email-subjectbody-encoding) | Non-ASCII chars garbled in email headers | P3 | ⚠️ Partial — Subject fixed, other headers not |
| [WP-9](#wp-9-phase-ad-mock-gap--llm-output-shape-validation) | Mocks don't validate LLM output shape | P3 | ⬜ Deferred (F7 — has token cost) |
| [WP-10](#wp-10-scatter-gather-error-handling--silent-success-with-error-data) | Scatter-gather reports success with error data | P2 | ⬜ Needs fix |

---

## Weak Points

### WP-1: IntentContract → IR Converter: `notify` step handling

**Severity:** High
**Encountered as:** D-B9
**Status:** ⬜ Needs generic fix

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
**Status:** ⚠️ Partial fix — compiler safety net implemented, root cause remains

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
**Status:** ⬜ Needs architectural fix

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
**Status:** ⬜ Needs generic fix

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
**Status:** ✅ Fixed for `{kind: "config"}`, ⬜ Other kinds not handled

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
**Status:** ✅ Fixed for Subject, ⬜ Other headers not handled

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
**Status:** ⬜ Needs fix

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

## Implementation Priority

| Priority | Weak Point | Impact | Effort |
|----------|-----------|--------|--------|
| **P0** | WP-2: Field name mismatches | Breaks every cross-plugin flow | Medium — extend O10 |
| **P0** | WP-4: `custom_code` map | Breaks every transform with non-matching field names | Medium — compiler field mapping |
| **P1** | WP-3: AI in scatter-gather | Breaks any AI inside loops | High — new LLM call path |
| **P1** | WP-1: notify step handling | Breaks non-send plugin actions | Low — schema-driven binding |
| **P2** | WP-5: group output shape | Breaks complex grouping | Low — explicit config |
| **P2** | WP-10: Scatter error handling | Misleading success reports | Medium |
| **P2** | WP-6: Structured ref objects | Breaks computed values | Low |
| **P3** | WP-9: LLM output validation | Only caught in Phase E | Medium + token cost |
| **P3** | WP-7: Label resolution | Race condition, extra API calls | Low |
| **P3** | WP-8: Email encoding | Non-English content | Low |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-03-30 | Initial document | 10 weak points identified from D-B7 through D-B13 bug fixes across 2 scenarios. Proposed solutions documented for each. |
| 2026-03-30 | WP-4 implemented | Structured field mapping from Phase 1 through runtime. LLM prompt updated to emit `mapping: [{to, from}]` for map transforms. IR converter converts to `field_mapping`. Runtime Mode 0 applies deterministic rename. Verified on Gmail Urgency Flagging: LLM emitted correct mapping (`sender←from`, `subject←subject`, `received_date←date`, `matched_keywords←urgency_classification`), `custom_code` eliminated. Backward compatible — old IntentContracts without mapping fall through to Mode 4. |
| 2026-03-30 | WP-2 implemented | Generic field name reconciliation in Phase 5. Schema registry built from workflow output_schemas + scatter item variables. Upstream tracing resolves item schemas through filter/transform chains. Strategies: prefix stripping (`message_id`→`id`), case-insensitive match, underscore/space normalization. Replaces D-B10 Gmail-specific hack. Verified on Gmail Urgency Flagging scenario. |
