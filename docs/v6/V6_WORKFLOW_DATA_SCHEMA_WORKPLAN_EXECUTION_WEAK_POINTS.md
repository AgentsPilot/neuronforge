# V6 Pipeline — Execution Weak Points & Hardening Plan

> **Last Updated**: 2026-03-31
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
| [WP-14](#wp-14-scatter-gather-token-bloat--extract-step-output-shape) | Scatter-gather merges full item with extract output → token bloat; I3 doesn't parse `fields` schema; runtime safety misroutes already-text content | P0 | ✅ Fixed — 3 surgical changes |

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
**Status:** ✅ Fixed — 3 surgical changes

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
| **P0** | WP-14: scatter token bloat + extract output shape | User hits 429 rate limit on real data; contract scenario misroutes | ✅ Fixed |
| **P1** | PD-1: Realistic plugin mocks | Phase D can't catch plugin-default quirks, empty results, token bloat | ⬜ Open |
| **P2** | PD-3: Token-budget warnings | Token bloat only visible in Phase E | ⬜ Open |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
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
