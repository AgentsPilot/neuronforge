# V6 Pipeline — Execution Weak Points & Hardening Plan

> **Last Updated**: 2026-06-08 (WP-56 filed + prompt steering)
> **Branch**: `feature/v2-agent-creation-r2r3-toned-single-question`
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
| [WP-26](#wp-26-o23-doesnt-recognize-project_columnby_index-as-a-positional-consumer) | The compiler's O23 optimization in `normalizeDataFormats` is supposed to skip the `rows_to_objects` auto-inject when all downstream consumers use positional access on the 2D array. Today the check only matches the flat `step.config.column_index` property; it does NOT recognize the modern `project_column` shape (`config.column = {kind: "by_index", index: N}`) introduced by W2/WP-16, nor the WP-25 positional `field_mapping` (numeric/letter target keys). When the actual upstream sheet has NO header row (common — users store data starting at row 1), the unnecessary `rows_to_objects` consumes the single data row as a header → 0 data rows downstream → set_difference reference is empty → dedup silently fails → rows duplicate on every run. | P1 | ⬜ Future — observed on `complaint-email-logger` Phase E (2026-05-11). User workaround: add a header row to the destination sheet. Fix: extend the O23 `allUseColumnIndex` check to also recognize `step.config?.column?.kind === 'by_index'` (project_column shape) and `parsePositionalKey()` target keys on `transform/map` (WP-25 shape). When all downstream consumers are positional, skip rows_to_objects insertion and rewrite consumer inputs to point at `producer.<arrayField>`. |
| [WP-27](#wp-27-sheets-append_rows-shifts-to-non-A-column-when-existing-data-has-empty-cells) | `google-sheets.append_rows` uses Google Sheets' "logical table" auto-detection. When the existing data in the target range has empty cells creating a column discontinuity (e.g., column D empty between A-C and E with data — as happens after WP-11/WP-24 evolution: an earlier run wrote rows without the body cell, a later run reads them back), Sheets API's table-walker detects the non-empty column (E) as the "table" and appends new rows after it (E2, F2, ...) instead of at A2. The data shape was correct (5-col 2D array); only the placement shifted. Result: appended rows visually misaligned, sheet has data in two disjoint column ranges. | P1 | ⬜ Future — observed on `complaint-email-logger` Phase E (2026-05-11). User workaround: add a header row (forces Sheets to detect the table at A1). Fix: compiler-side emission of a tighter `range` for append_rows. Currently emits `range: "SheetName!A:E"` (column range — vulnerable to table-walking). Should emit `range: "SheetName!A1"` (point start) OR `range: "SheetName"` (sheet-name-only — Sheets defaults to A1) — both force the API to anchor at A1 regardless of existing cell sparsity. Compiler heuristic: when emitting `append_rows`, normalize the `range` parameter to either bare-sheet-name or `<sheet>!A1`. |
| [WP-28](#wp-28-bare-numeric-source-keys-in-field_mapping-not-recognized-as-positional) | `transform/map` with `field_mapping` where SOURCE keys are bare numeric strings (`"0"`, `"1"`, ...) — the LLM's "give me column N from each row" emission. Today's runtime only recognizes `column_<digit>` as positional source keys (WP-SR fix); bare `"0"` falls through to literal property access on the post-`rows_to_objects` object → `item["0"]` is undefined → every field maps to undefined → empty objects → downstream filter drops everything → user receives "No data available." email despite real Sheet data. Sister to WP-SR / WP-25 — same emission-style family, just on the source side of the mapping. | P1 | ✅ Fixed (2026-05-11) — **two-layer fix mirroring WP-25:** (a) **runtime tolerance:** replaced the `COLUMN_N` regex with `parsePositionalKey()` (already exists from WP-25 for target-keys) on the source side, so all 4 positional patterns work uniformly — bare numeric (`"0"`), `column_<digit>`, Excel letter, `column_<letter>`. (b) **prompt steering:** extended section 6.11 (or wherever WP-25's target-key guidance lives) with source-key canonical form. Defense in depth — prompt converges LLM on field-name source keys; runtime handles drift. N new unit tests covering 4 source patterns + canonical leads-email-summary failure + regression guards. |
| [WP-29](#wp-29-parsedate-is-locale-sensitive-misinterprets-ddmmyyyy-as-mmddyyyy) | `parseDate` in `StructuredTransforms.ts` uses `new Date(value)` which is locale-sensitive. For slash-format inputs like `"12/5/2026"` (the user's Google Sheets DD/MM/YYYY locale), JavaScript interprets as MM/DD/YYYY → Dec 5, 2026 → `date_diff` returns wildly wrong values (207 days instead of 1). For inputs like `"13/5/2026"` (no month 13 in MM/DD), `new Date()` returns Invalid Date → `date_diff` returns null. Cascades through `date_diff` / `date_add` Expression ops in `with_fields` → downstream filter on `days_until_finish` drops every row → empty result email. | P1 | ✅ Fixed (2026-05-11) — **three-tier disambiguation in `parseDate`:** (1) ISO format unambiguous, (2) Tier 1: if either day or month part > 12, format is forced (handles `"13/5/2026"` for free), (3) Tier 2: user-timezone-driven locale via new `IExpressionContext.getUserTimezone()` hook. America/* (excluding South America) → MM/DD/YYYY; everywhere else (and undefined) → DD/MM/YYYY (~85% of world population). `ExecutionContext.getUserTimezone()` reads from `inputValues._user_timezone` / `inputValues.user_timezone` / `variables._user_timezone` — WorkflowPilot can wire from user-context system. New `buildDate()` helper validates day/month overflow (e.g., Feb 30 → null). Tier 3 (explicit `date_format` workflow_config hint) deferred — requires Phase 1 prompt steering. |
| [WP-30](#wp-30-config-expression-resolves-to-literal-string-instead-of-config-value) | `evaluateExpression` for `kind: "config"` calls `context.resolveVariable(\`input.${expr.key}\`)` with a bare path (no `{{...}}` braces). Production `ExecutionContext.resolveVariable` strictly requires `{{...}}` syntax — bare strings are returned as-is. So `{kind: "config", key: "date_window_days"}` returns the literal string `"input.date_window_days"` instead of the value `3`. Cascades through `date_add(today, config_ref)` → `Number("input.date_window_days")` = NaN → `date_add` returns null → `window_end` field is null in every row. Same convention mismatch as WP-22 (`set_difference.reference`). Likely silently broken since W2 (WP-16) shipped — W2 unit tests used a permissive stub context that strips `{{}}` permissively, hiding the production-strict mismatch. | P1 | ✅ Fixed (2026-05-11) — wrapped both `case 'config'` and non-`item` `case 'ref'` paths in `{{}}` before calling `resolveVariable` (audit found the same bug in `ref` for cross-slot references). One-line change each, mirrors WP-22's defensive wrap. |
| [WP-31](#wp-31-today--date_diff-use-time-difference-instead-of-calendar-day-difference) | `today` returns `new Date().toISOString()` — a moment including time-of-day. `date_diff(a, b, 'days')` then computes `Math.floor((a − b) / 86_400_000)` — fractional-days flooring, not calendar-day difference. So `date_diff(May 12 00:00 UTC, May 11 08:29 UTC, 'days')` = `floor(15.5h / 24h)` = `floor(0.65)` = **0** instead of the expected 1. Filter `1 ≤ days_until_finish ≤ 3` then drops the May 12 tasks (the most urgent ones!). Worst-case off-by-one is N tasks dropped where N depends on how close to noon you run the workflow. Compounds with WP-29 (date parsing) and WP-30 (config refs) in the gantt-urgent-tasks cascade. | P1 | ✅ Fixed (2026-05-11) — **three-part fix:** (A) `case 'today'` returns midnight UTC of the current calendar day, optionally in user's local timezone via WP-29's `getUserTimezone()` hook. (B) `case 'date_diff'` with `unit: 'days'` defensively normalizes both sides to UTC midnight using `Math.round` (DST-safe). (C) `case 'date_add'` keeps existing semantics; combined with the new midnight `today`, `today + N days` is exactly N×24h later. 12 new unit tests covering all cases. User confirmed Phase E on gantt-urgent-tasks now produces 3 tasks as expected. |
| [WP-32](#wp-32-structuralrepairengine-rewrites-flatten-field-from-per-item-nested-to-root-level) | `StructuralRepairEngine.scanWorkflow` runs at the top of `WorkflowPilot.execute()` (before any step runs) and **persists fixes back to the agent in the DB**. When a `transform/flatten` step has `input: "{{producer.emails}}"` (path-navigated to the inner array) and `field: "attachments"` (per-item nested extraction), the validator extracts only the top-level var name (`producer`) from the `{{...}}` template, ignores the `.emails` navigation, and validates `field: attachments` against the **root-level** array fields of `producer`'s output_schema. Since the source returns `{emails: [...], total_found, ...}` (a wrapper-object schema), `attachments` is not at root → flagged as `invalid_flatten_field` → autoFix rewrites to `"emails"` (first match in the priority list `['emails', 'items', 'files', ...]`). Result: runtime sees `field: "emails"` but iterates over emails-array items looking for an `emails` sub-field, finds none, returns `[]`. Phase E "succeeds" but downstream consumers (AI step, send email) get empty data → user receives empty email despite producer returning real attachments. | P1 | ✅ Fixed (2026-05-13, commit `b9973ac`) — scan logic now checks `varMatch[2]` first: when `step.input` navigates into a sub-array via `{{producer.subField}}`, validate `config.field` against the per-item array sub-fields instead of the root keys. autoFix priority list extended for the per-item-nested case (attachments-first). 11 new unit tests in `StructuralRepairEngine.wp32.test.ts`. |
| [WP-33](#wp-33-with_fields-expression-accepts-template-strings-but-evaluateexpression-requires-structured-form) | `transform/with_fields` LLM emission carries each augmenting field as `{name, expression}`. The W2 grammar requires `expression` to be a structured `{kind: "...", ...}` object (e.g. `{kind: "ref", ref: "X", field: "Y"}`). When the LLM instead emits a template string (`expression: "{{uploaded_file.web_view_link}}"`), the IR converter's `normalizeExpressionRefs` passes non-objects through unchanged, so phase4 stores the raw template string. At runtime, `resolveAllVariables` walks the step config and substitutes `{{...}}` placeholders with their resolved values **before** the transform runs — so `transformWithFields` sees `field.expression = "https://drive.google.com/..."` (a plain string). It then calls `evaluateExpression(expr, ...)` which throws `INVALID_EXPRESSION: must be {kind, ...}`. Scatter-gather item fails, parent scatter fails, downstream notify never runs → user receives **no email at all**. Convention-mismatch family with WP-22 (set_difference.reference), WP-30 (config bare path), WP-32 (validator vs runtime contract). | P1 | ✅ Fixed (2026-05-13, commit `b9973ac`) — two-layer fix: (A) runtime tolerance in `evaluateExpression` via new `normalizeStringExpression` helper that maps `"{{X.Y}}"` → `{kind: "ref", ref: "X", field: "Y"}`, `"{{input.K}}"` → `{kind: "config", key: "K"}`, plain string → `{kind: "literal", value}`. (B) IR converter normalizes string-form expressions to structured AST at compile time. 30 new tests (18 runtime + 12 converter). |
| [WP-34](#wp-34-deterministicextractor-swallows-pdf-parse-exceptions-and-document-extractor-silently-fabricates-unknown-defaults) | The `document-extractor.extract_structured_data` plugin invokes `DeterministicExtractor` which catches all errors in its main flow and returns a `createFailureResult` (success=false, all fields missing, `method: "text"`). The plugin then applies `"Unknown <FieldName>"` defaults at [`document-extractor-plugin-executor.ts:149`](../../lib/server/document-extractor-plugin-executor.ts#L149) for any required field that came back null/empty. The combination means: when an image-based PDF (no text layer) is passed and `pdfDetector.detect()` either throws or returns empty text, AND AWS Textract is unconfigured (no `AWS_ACCESS_KEY_ID`), AND vision/LLM fallback is not wired in — the workflow does not fail. Instead, downstream consumers receive fabricated `"Unknown Type"`, `"Unknown Vendor"`, etc. as if real data. WP-13-family fabrication risk: the user gets an email that looks legitimate but contains made-up values. Secondary cosmetic: [`gmail-plugin-executor.ts:271-275`](../../lib/server/gmail-plugin-executor.ts#L271-L275) still sets `result.extracted_text = "(PDF text extraction not yet implemented)"` for any PDF attachment — a 2026-02 stub that downstream doesn't actually use (document-extractor reads `data` directly), but is confusing. | P1 | ⬜ Documented — fix deferred (multi-component change) |
| [WP-35](#wp-35-phase-a-simulator-doesnt-understand-array-index-syntax-in-template-refs) | The Phase A DSL execution simulator (`scripts/test-dsl-execution-simulator/`) doesn't understand the `field[N]` array-index syntax inside `{{...}}` template refs. For `{{contracts_folder_results.files[0].id}}`, `VariableStore._lookupRef` splits on `.` and tries `value["files[0]"]` (literal property lookup) which is `undefined` → ref marked unresolved. Separately, `Validator.checkCrossStepFieldRefs` takes `parts[1] = "files[0]"` as a literal field name and checks against the schema's known fields, finds `files` but not `files[0]` → emits `cross_step_field_ref` error. Both fire at severity `error`, causing Phase A to fail. **The runtime `ExecutionContext.resolveVariable` handles this syntax correctly** — only the simulator is strict. Affects any scenario where the LLM uses `{{var.field[N].subfield}}` to extract "the Nth element then sub-access" (most commonly the first folder/file from a search result). Documented 2026-04-10 as a known false positive in the now-removed `verification_status` block of contract-enddate-summary. | P2 | ✅ Fixed (2026-05-14, commit `71575e4`) — new exported `parsePathSegment(segment)` helper in `variable-store.ts` parses `<name>[<index>]` syntax; new `_walkPath` method honors both. Validator's 3 call sites (`checkFieldConsistency`, `checkCrossStepFieldRefs`, `validateConditionField`) strip `[N]` before schema check. 14 new unit tests. |
| [WP-36](#wp-36-phase-d-stub-generator-emits-generic-mock_name_nnn-that-fails-keyword-filters) | The Phase D stub data generator at [`stub-data-generator.ts:210`](../../scripts/test-dsl-execution-simulator/stub-data-generator.ts#L210) falls through to `mock_${fieldName}_${idx}` for the `name` field — producing `mock_name_001`, `mock_name_002`, `mock_name_003`. When the LLM emits a `transform/filter` step with `contains_any` operator and content-specific keywords (e.g., `["Contract", "Agreement", "MSA", "SOW", "Order Form", "Statement of Work"]`), zero mock items match → filter produces 0 results → `on_empty: "throw"` correctly fires because the filter feeds a scatter-gather → Phase D aborts with `Transform step produced 0 results from 3 input items`. The runtime safety check is right; the mock data is the problem. Real Drive/Sheets data has realistic names that would match. PD-1 family (Phase D realism gap). Affects any scenario using keyword-substring filters on file/document names — `contract-enddate-summary` is the first to surface it because earlier scenarios filtered on enum fields (`labels`, `urgency`, `priority`) which happen to align with generic mocks. | P2 | ✅ Fixed (2026-05-14, commit `71575e4`) — new `DOCUMENT_NAME_BANK` constant with 6 realistic business-doc names (Contract / MSA / SOW / Agreement / Order Form / Invoice) cycled by indexSuffix. New `name`/`title` case in `generateStringByFieldName`. 11 new unit tests covering bank cycling, wrap-around, keyword coverage, and field-specific regressions. |
| [WP-37](#wp-37-transformwithfields-rejects-undefined-expressions-when-resolveallvariables-pre-substituted-an-unresolvable-template) | `with_fields.fields[].expression` is meant to be a structured AST node (after WP-33) but the runtime pipeline still pre-runs `ExecutionContext.resolveAllVariables` on the whole step config. When the LLM emits a template-string expression like `"{{attachment_item.thread_id}}"` and that path is unresolvable in the current context (e.g., `thread_id` not propagated by an upstream flatten), `resolveAllVariables`'s whole-template branch returns `undefined` and writes it back. `JSON.stringify` then drops the undefined → the runtime sees `{name: "thread_id"}` (expression silently gone) → `transformWithFields`'s `!field.expression` guard throws `INVALID_CONFIG` before WP-33's `evaluateExpression` tolerance can normalize the string. Net result: scatter-gather "all N items failed" cascading abort. Same family as WP-22 / WP-30 / WP-32 / WP-33 — runtime pre-processing destroys valid LLM intent. | P1 | ✅ Fixed (2026-05-14, commit `10df588`) — split the upstream guard so `name` missing still throws (genuinely invalid), but `expression === undefined` is tolerated as `{kind: "literal", value: undefined}`. Augmented row gets `field.name: undefined`, surfacing the missing data downstream instead of crashing the scatter. 8 new tests + 1 pre-existing assertion updated. |
| [WP-38](#wp-38-self-referential-gmail-queries-pick-up-the-agents-own-past-confirmation-emails) | Gmail-search workflows that send a confirmation email containing a phrase like `"Orders PO Extraction – Processing Complete"` create a **self-referential feedback loop**: the next run's query `subject:Orders newer_than:7d` matches the agent's own prior confirmation email (because it has "Orders" in the subject). The cascade then processes that confirmation email as if it were a real order — its `attachments: []` correctly propagates through, producing a "no data" downstream result and another confirmation email. The agent keeps sending itself confirmation emails about confirmation emails. Affects `orders-po-extractor-xlsx`, `po-monitor-supplier-confirmation`, and any scenario where the LLM emits both (a) a Gmail search filtering on a domain keyword, and (b) a confirmation email containing that keyword in its subject. Pipeline-correctness-wise nothing is broken (no fabrication, accurate "no data" message), but the data shape is misleading — the unique extraction/grouping logic NEVER GETS TESTED because the only matching email is the agent's own self-output. PD-1/PD-3 realism family. Prompt-level fix: query exclusions like `-from:me` or `-subject:"Processing Complete"`; or quoted-subject filters like `subject:"Order PO"` that target the user-facing pattern, not the agent's confirmation phrasing. | P3 | ⬜ Documented — prompt-level fix deferred (scenario-author concern, not pipeline bug) |
| [WP-39](#wp-39-execution-graph-compiler-d-b18-alias-updates-configtype-but-not-stepoperation) | `ExecutionGraphCompiler` aliases `select` / `custom` transform types → `map` (per D-B18, since `select`/`custom` were removed from the IntentContract schema). The alias logic at [`ExecutionGraphCompiler.ts:683-689`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L683) updates `transformConfig.type` AND `transformedConfig.type` to `"map"` but **does not update `pilotOperation`** (line 579). `pilotOperation` flows into `finalOperation` (line 816) → `step.operation` (line 895), so the compiled step ends up with `operation: "select"` at the top level despite `config.type: "map"`. Runtime `StepExecutor.executeTransform()` reads `step.operation` first — sees `"select"` — falls through its switch — throws `Unknown transform operation: select`. Affects every V6-pipeline-generated workflow where Phase 1 LLM emits `transform/select` (which is its natural choice for "project these columns" patterns since `select` was the original IR vocabulary before W2/WP-16 grammar evolved). First surfaced at runtime during Stage 1.2b V2-UI Phase E run on `gantt-urgent-tasks` prompt — step3 died, blocking steps 4-9 from executing. Same incomplete-aliasing pattern exists for `deduplicate → dedupe` (line 680-682) but doesn't surface because runtime handles both. | P0 | ✅ Fixed (2026-05-17) — added `pilotOperation = 'map'` to the D-B18 alias block. Now `step.operation`, `config.type`, and `transformedConfig.type` all agree on `"map"`. |
| [WP-40](#wp-40-irformalizer-blind-guess-auto-correction-corrupts-filter-input-paths) | `IRFormalizer.validateIRStructure` at [`IRFormalizer.ts:1741-1782`](../../lib/agentkit/v6/semantic-plan/IRFormalizer.ts#L1741) tries to "auto-correct" a filter whose input variable is declared as non-array by **blindly appending field names from a hardcoded list** `['attachments', 'items', 'results', 'data', 'list', 'records']` and breaking on the FIRST one. There's no schema check — it always picks `attachments`. The compounding errors: (a) the check looks up the BASE variable declaration (`sheet_rows_wrapper`) but `transform.input` may already access a nested field (`{{sheet_rows_wrapper.rows}}` is the array), so the "object" type assessment is meaningless; (b) the corrected path is appended to `transform.input`'s FULL expression, not the base var, producing nonsense like `{{sheet_rows_wrapper.rows.attachments}}`. Runtime resolves to `undefined` → "Transform step has no input data" → cascade abort. First surfaced at Stage 1.2b on the same `gantt-urgent-tasks` V2-UI agent — step4 (`Transform: filter` to skip header row) died once the WP-39 fix unblocked step3. Textbook V6_DESIGN_PRINCIPLES Principle 11 violation: defense-in-depth heuristic SILENTLY corrupts data while logging "Auto-corrected" as if it was a fix. | P0 | ✅ Fixed (2026-05-17) — deleted the blind-guess loop in `validateIRStructure`; restored explicit validation error. Filters whose input already accesses a nested field (`{{var.subfield}}`) bypass the type check (trust the LLM). The schema-aware `autoFixFilterTransforms` (line 1846+) — which uses skeleton `filter_hints` — is the legitimate auto-fix path and is unchanged. |
| [WP-41](#wp-41-d-b18-select-to-map-alias-is-syntactic-not-semantic) | `ExecutionGraphCompiler`'s D-B18 alias renames `transform.type: "select"` → `"map"` ([WP-39](#wp-39-execution-graph-compiler-d-b18-alias-updates-configtype-but-not-stepoperation) fixed the partial relabel) — but the alias is purely syntactic. `select` and `map` are different operations: `select` constructs ONE wrapper object from source-level references; `map` iterates an input array and produces ONE output per item. The LLM emits `select` with `fields: {rows: "{{src.values}}", row_count: "{{src.row_count}}", ...}` intending a singular wrapper, then downstream consumers do `{{wrapper.rows}}` to drill into the bundled array. After the alias, runtime `map` iterates the 57-row input array and runs the field-construction **per item** — producing 57 identical copies of the literal config (`[{type:"map", input:"...", fields:{...}}, ×57]`) instead of one wrapper. `wrapper.rows` then resolves to undefined on the resulting array, breaking every downstream `transform/filter` consumer. Surfaced at Stage 1.2c live Phase E run after both WP-39 and WP-40 fixes landed — step4 still fails at runtime despite a clean path because step3's output has the wrong shape. Affects every workflow where Phase 1 LLM emits `transform/select` to build a wrapper object (which is its natural choice for "bundle source metadata with the rows array" patterns). | P0 | ✅ Fixed (2026-05-17) — chose **Option A**: restored `select` as a runtime transform op via new `case 'select'` in `StepExecutor.executeTransform` that builds a single wrapper object from `effectiveConfig.fields` (post-resolveAllVariables, values already resolved). Compiler D-B18 alias split into two arms: `select` preserved (no rename, `pilotOperation` stays `'select'`); `custom` still aliases to `map` for now. End-to-end Phase E confirmed 7/7 steps pass on `gantt-urgent-tasks-v2ui` regression scenario (real Gmail delivery succeeded). |
| [WP-42](#wp-42-gmail-plugin-rejects-string-recipientsto-from-llm-emission) | Gmail plugin executor's `buildEmailMessage` calls `.map()` on `recipients.to` (and `recipients.cc` / `recipients.bcc`), assuming the plugin schema's declared array shape. The LLM commonly emits a single email as a string (`recipients.to: "meiribarak@gmail.com"`) since EP Key Hints surface the value as a string — the natural emission style. Runtime throws `TypeError: recipients.to.map is not a function`. Same plugin-contract / LLM-emission-style mismatch family as WP-21 (`contains_any` with string RHS) and WP-25/28 (positional-key field_mapping). Bonus: `countRecipients` in `base-plugin-executor.ts` called `.length` on the string and returned the character count (e.g., 20 for a 20-char email) — silently inflated `total_recipients` in validation rules ("send email to 20 recipients?" confirmation). Surfaced at Stage 1.2d live Phase E run after WP-41 unblocked the cascade to step9 (the send-email step). | P0 | ✅ Fixed (2026-05-17) — two-line runtime tolerance: (a) new `toEmailArray()` helper in `buildEmailMessage` coerces string → `[string]` and passes arrays through unchanged; (b) `countRecipients` patched to count `1` for a single-email string instead of `string.length`. Mirrors the WP-21/22/25 runtime-tolerance pattern. End-to-end Phase E confirmed on `gantt-urgent-tasks-v2ui` (real email delivered to meiribarak@gmail.com). |
| [WP-43](#wp-43-ai_processing-prompt-vs-data-shape-and-temporal-anchor-drift) | TWO compounding `ai_processing` prompt-context gaps that together cause the model to silently produce empty/fabricated results despite real input data. **(a) Shape drift:** Phase 3 LLM authors `ai_processing.instruction` referencing column letters (`"Use column A as task_name, column D as status..."`) — the wording naturally inherited from EP Key Hints like `task_name_column: "A"`. But the compiler auto-injects `rows_to_objects` for Sheets data, so by the time the AI step runs, the input is an array of objects with header keys (`Tasks`, `Status`, ...). The model's prompt says one thing; the data shape says another. **(b) Temporal anchor missing:** Instructions like "due_date within the next 3 days **relative to now**" are unresolvable — the prompt never anchors "now" to a concrete date. The model has no reliable reference for date filtering and conservatively returns empty. Both gaps surfaced live on `gantt-urgent-tasks-v2ui` Stage 1.2e after WP-39/40/41/42 fixed all runtime errors: pipeline ran 7/7 steps, sent a "No tasks matched the criteria" email despite 3 tasks in the data that should have matched. | P0 | ✅ Fixed (2026-05-17) — runtime preamble (Option B) prepends two short anchors to every `ai_processing` prompt when input is an array of objects: (1) `INPUT DATA SHAPE` lists named keys + positional aliases (column A=key1, column B=key2, ...); (2) `CURRENT DATE` provides today in ISO + human form with a hint about DD/MM/YYYY interpretation. ~150 tokens, no compiler change, no Phase 3 prompt change. End-to-end Phase E confirmed: AI step now extracts 3 real tasks; email body lists them. **Option A (formalization-system-v4.md prompt extension)** queued as a follow-up to also fix the IR-author-time pass and reduce reliance on the runtime preamble. |
| [WP-44](#wp-44-v6-formalization-drops-explicit-ep-format-requirements-html-vs-plain-text) | Phase 3 IRFormalizer (using `formalization-system-v4.md`) loses explicit format requirements declared in the user's Enhanced Prompt. The `gantt-urgent-tasks-v2ui` EP says "HTML" 6 times across `sections.output` / `sections.delivery` — including the literal *"Put the HTML summary table in the email `html_body`"*. But the V6 IR authored: (a) AI step prompt saying *"Create a concise **plain-text** email body"*; (b) `output_schema.body.description: "Plain-text email body"`; (c) `send_email` step using `content.body` (plain) instead of `content.html_body`. Net result: user receives an ASCII-pipe-separated table instead of the requested HTML table. **Comparison with the IntentContract pipeline:** the previous `gantt-urgent-tasks` scenario (authored via the old IC pipeline) correctly produced `content.html_body: "{{email_content.body}}"` — fidelity to the EP. The V6 formalization prompt has no equivalent guidance steering the LLM to preserve EP-level format choices. Sister to WP-43: same family of "Phase 3 LLM authors workflow steps that don't reflect EP-level user requirements" — but on a different surface (output format / plugin param choice rather than instruction-language / temporal anchor). | P1 | ⬜ Documented — fix deferred. Two intervention angles: (A) extend `formalization-system-v4.md` with guidance to inspect the EP's `sections.output` + `sections.delivery` for format-specific instructions (`html_body` / `markdown_body` / `plain_body` / structural keywords like "HTML table", "Markdown", "JSON") and (a) author the AI generation prompt to match, (b) wire the resulting field to the matching plugin parameter; (B) compiler-side rewrite — when the EP contains `html_body` and the IR has `content.body`, swap to `content.html_body` (more brittle since it tries to fix what the LLM should have authored correctly). Bundle with WP-43 Option A in the next Phase 3 prompt-fidelity follow-up session. **Effectively resolved by Pipeline A migration** — Pipeline A's IntentContract prompt preserves `html_body` correctly (confirmed live Stage P4 2026-05-17). Once Pipeline B is fully retired (P6) this WP becomes historical. |
| [WP-45](#wp-45-conditionalevaluator-gte-lte-do-not-resolve-bare-variable-refs-and-are-not-date-aware) | `ConditionalEvaluator` (used by every `transform/filter` step) had two compounding gaps that together break date-range filters: (a) `condition.value` was only defensively resolved as a bare variable reference (`"date_window.window_start"` → `{{date_window.window_start}}`) for the `in`/`not_in` operators (WP-22's narrow O26 fix). For `gte`/`lte`/`gt`/`lt`/`eq`/`ne` the bare string was treated as a literal — `compareValues("19/5/2026", "date_window.window_start", "gte")` was always false. (b) The ordered comparison operators `gte`/`lte`/`gt`/`lt` did raw `>=`/`<=`/`>`/`<` — lexicographic on strings — and never called `parseDate`. So even if (a) were fixed and the runtime got the ISO string `"2026-05-17T00:00:00.000Z"`, `"19/5/2026" >= "2026-05-17T..."` is still a string-vs-string lexicographic compare. Surfaced at Stage P4 of the Pipeline A migration on `gantt-urgent-tasks-v2ui-pipeline-a` — step6 (date-range filter built via `Due Date >= window_start && <= window_end`) returned 0 of 4 priority-matched tasks. WP-29/30/31 (2026-05-11) fixed similar bugs but **only in the W2 expression evaluator** (`StructuredTransforms.ts`'s `evaluateExpression`, used by `transform/with_fields`) — not in `ConditionalEvaluator` (which is its own parser + comparison code in a separate file). Two date parsers diverged: one hardened, one stayed brittle. The old `gantt-urgent-tasks` regression scenario built `days_until_finish` as a *number* in `with_fields` and filtered on that number, so the filter's parseDate gap was never exercised. Pipeline A's LLM picked a cleaner shape (`with_fields` builds a `date_window` object → `filter` directly compares dates), exposing the gap. | P0 | ✅ Fixed (2026-05-17) — (a) generalised bare-string defensive wrap to all comparison operators via `looksLikeBareVariableRef()` helper (identifier-path regex; literal values with spaces/punct stay literal). (b) `gte`/`lte`/`gt`/`lt` now date-aware via new `compareAsDates()` helper: when both sides parse as dates (via the canonical WP-29 `parseDate` re-used from `StructuredTransforms.ts`), compare via `Date.getTime()`; otherwise fall through to native `>=`/`<=`/`>`/`<` (numeric and string comparisons unchanged). (c) `ConditionalEvaluator.parseDate` now delegates to the shared WP-29 parser so `before`/`after`/`within_last_days` also benefit — eliminates the duplicate weaker parser. End-to-end Phase E confirmed on `gantt-urgent-tasks-v2ui-pipeline-a` (3 real tasks delivered in HTML email). |
| [WP-46](#wp-46-transform-with_fields-with-constants-only-produces-per-item-array-instead-of-singleton-object) | `transform/with_fields` is documented as "augment each input item with computed fields" — input array → output array, same length, each item gets the new fields. But the IntentContract LLM commonly emits it for a different intent: *"compute these named constants for downstream comparisons."* Example (gantt-urgent-tasks-v2ui-pipeline-a step4): `fields: [{name: "window_start", expression: {kind: "today"}}, {name: "window_end", expression: {kind: "date_add", days: {kind: "config", key: "date_window_days"}}}], output_variable: "date_window"`. All field expressions are constants (no `item.*` references). The downstream filter then does `value: "date_window.window_start"` — treating `date_window` as a singleton object. Pre-fix runtime: produces an array of 57 row copies each augmented with the same constants; `.window_start` access on the array is undefined; filter returns 0 rows silently. Same anti-pattern shape as WP-41 (LLM picked transform whose semantics don't match the intended use) but on a different surface (`with_fields` constants-as-object pattern vs `select` build-singleton pattern). | P0 | ✅ Fixed (2026-05-17) — runtime tolerance in `transformWithFields`: new `isConstantExpression()` helper walks each field's expression tree; if ALL field expressions are constant (no `kind: "ref"` with `ref: "item"` or `ref: "item.X"`), evaluate once and return a singleton `{[fieldName]: value, ...}` object regardless of input array length. Per-item augmentation behaviour is unchanged when ANY field references `item.*`. End-to-end Phase E confirmed: step4 emits `{"window_start": "2026-05-18T00:00:00.000Z", "window_end": "2026-05-21T00:00:00.000Z"}`; step6 filter resolves and returns 3 of 4 candidate rows correctly; final HTML email delivered with 3 real tasks. |
| [WP-47](#wp-47-v2-ui-re-prompts-for-input-values-already-provided-via-ep-resolved_user_inputs-on-pipeline-a) | V2 UI's `extractInputSchema` + post-V6 input-collection flow re-prompts the user for input values they ALREADY provided during the conversational EP build phase — but ONLY on Pipeline A. Root cause: a naming-convention mismatch between two key namespaces that the V2 UI tries to reconcile via strict string equality. (a) The EP's `resolved_user_inputs[]` uses **EP Key Hint format** (`google-sheets__table/get__spreadsheet_id`, `google-mail__email/send_message__recipients.to`, ...). (b) Pipeline A's IC LLM emits its own keys for `config[]` (`spreadsheet_id`, `tab_name`, `range`, ...) — human-readable, transcribed-from-EP values but renamed. The DSL's `{{input.X}}` refs use the IC's keys. The V2 UI builds `resolvedInputs` from the EP keys (set (a)) and then filters `input_schema` looking for `input.name in resolvedInputs` (line 1190 in `app/v2/agents/new/page.tsx`). For IC keys (set (b)), the lookup misses every time — V2 UI thinks the user hasn't provided them and re-prompts. **Pipeline B doesn't show this** because its compiler inlines `resolved_user_inputs` values directly into DSL `params` at compile time, so there are no `{{input.X}}` refs to surface in Source 1 of `extractInputSchema`. | P1 | ✅ Fixed (2026-05-19) — V2 UI now pre-populates `resolvedInputs` from `v6Data.ir.config_defaults` (which Pipeline A returns in the IR; absent on Pipeline B, so the new branch is a no-op there). The IC LLM transcribed EP values into `config[].default`, keyed by the same names the DSL's `{{input.X}}` refs use — exact match for the line-1190 filter. ~12 LOC in `app/v2/agents/new/page.tsx`. The visual concern that `extractInputSchema` still produces duplicate-looking entries (e.g. both `spreadsheet_id` and `google-sheets__table/get__spreadsheet_id`) is left as a separate polish item — not user-blocking because the values are pre-filled. |
| [WP-48](#wp-48-api-create-agent-violated-claudemd-mandatory-rules-direct-supabase-insert--header-only-auth--no-input-validation) | Pre-existing tech-debt violation surfaced during a code review prompted by the Pipeline A migration. `/api/create-agent/route.ts` — the single endpoint that persists every agent created via the V2 UI (V4 + Pipeline A + Pipeline B all funnel through it) — violated five CLAUDE.md mandatory rules at once: (1) direct `supabase.from('agents').insert([...])` instead of using `AgentRepository.create()` (rule #1); (2) trusted the client-supplied `x-user-id` header without verifying a Supabase session (rule #5 / security); (3) no Zod validation on the request body — only ad-hoc `if (!agent.agent_name)` checks (rule #2); (4) module-scoped service-role Supabase client used unconditionally (rule #4 — RLS bypass without explicit justification); (5) ~40 `console.log/warn/error` calls instead of structured Pino logging (rule #3 / SYSTEM_LOGGING_GUIDELINES.md). Not introduced by Pipeline A — present since `57caa8e Completed full cycle in creating the agent`. Surfaced now because the Pipeline A migration prompted the user to ask "is the agent saved via the repository or direct DB insert?" | P1 | ✅ Fixed (2026-05-19) — five-part refactor: (a) `lib/repositories/types.ts` `CreateAgentInput` extended from 7 fields to ~25 fields covering the full agent persistence shape (`pilot_steps`, `workflow_steps`, `input_schema`, `agent_config`, `ai_reasoning`, etc.). (b) `/api/create-agent` writes via `new AgentRepository().create(...)` instead of direct supabase insert. (c) Auth replaced with `getUser()` from `@/lib/auth` (Supabase SSR session cookie validation) — expired sessions now correctly return 401. (d) Zod schema `CreateAgentSchema` validates the request body shape; pass-through allowed on the inner `agent` object to keep tolerance for V4/V6 emission variants. (e) All `console.*` calls migrated to structured Pino logging per `docs/SYSTEM_LOGGING_GUIDELINES.md` — module logger, per-request correlation ID + child logger, structured `(context, msg)` calls, `{ err: error }` error pattern, `duration` performance metric on completion/error paths, child logger for the AIS subsystem block, ASCII separators + emoji noise removed. Module-scoped service-role supabase client preserved ONLY for the `token_usage` SELECT in the AIS section (no repository for that table yet — documented as a follow-up). |
| [WP-49](#wp-49-convertnotify-emits-paramsrecipients-with-to-only--cc-and-bcc-silently-dropped) | `IntentToIRConverter.convertNotify()` reads `step.notify.recipients?.to` but builds `params.recipients` with **only** the `to` field — `cc` and `bcc` are present on the IntentContract `notify` block and validated by the schema, but never emitted to the compiled DSL. Both code paths (schema-aware binding at L1045-1054 AND fallback `isSendAction` heuristic at L1095-1105) have the same omission. Compiler then emits an `[O11] Config key "email_cc" declared but never referenced in workflow` warning because the IntentContract's config-defaults included `email_cc` but no DSL step references it — the warning correctly diagnosed the orphaned key but didn't surface the lossy projection upstream. **Surfaced live 2026-05-30** on agent `b4bda055-4f6d-403d-b5e5-52a143905fdf` ("Gantt Critical/High Tasks Due Soon — Email Summary"): user's Enhanced Prompt specified `recipients.to: meiribarak@gmail.com` AND `recipients.cc: offir.omer@gmail.com, eomer3@gmail.com`; both correctly carried through Phase 1 IntentContract (`step.notify.recipients.cc[]` present in IR — dev.log L7669–7674); compiled pilot_steps step11 had `recipients: { to: ["{{input.email_to}}"] }` only; Gmail API call's `transformedParams` (dev.log L28315–28329) had only the TO; CC recipients silently never received the email. Sister to WP-1 (same `convertNotify` function), same "EP fidelity loss" family as WP-44 (Pipeline B's `formalization-system-v4.md` dropped HTML format requirements). Distinct family from WP-42 (runtime tolerance for string→array) — this is a **compiler-side lossy field projection**, not a runtime contract mismatch. | P0 | ✅ Fixed (2026-05-30) — three-line addition at each of the two `params.recipients = { to: ... }` assignments. Pattern mirrors the `to` normalization (array-or-single tolerance) and conditionally spreads `cc` / `bcc` keys only when the IR provides them, so workflows without CC/BCC produce identical output to pre-fix. Result: compiled DSL's `params.recipients` now carries `{to, cc?, bcc?}`; the `[O11] email_cc declared but never referenced` warning naturally disappears for affected workflows because the config key is now referenced. |
| [WP-50](#wp-50-datapreprocessor-misclassifies-any-object-with-a-summary-field-as-a-calendar-event--silently-eats-ai_processing-input) | `DataPreprocessor.detectDataType()` classifies any object with a `summary` field as a calendar `'event'` because the heuristic at [DataPreprocessor.ts:199-207](../../lib/orchestration/preprocessing/DataPreprocessor.ts#L199-L207) uses an unguarded OR (`data.startTime \|\| data.start?.dateTime \|\| (data.start && data.end) \|\| data.summary`). The `summary` clause was added for Google Calendar's event-title field but matches any AI/research/extractor output whose top-level shape happens to carry a `summary` (research overview, AI-pre-processed text, document summary, etc.). Once mis-classified, `EventPreprocessor.validateEvents()` ([EventPreprocessor.ts:138-150](../../lib/orchestration/preprocessing/EventPreprocessor.ts#L138-L150)) filters out anything without `startTime` — for a non-event object this drops everything. The cleaned input then collapses to ~2 chars, and the WP-13 empty-input guard ([StepExecutor.ts:1552-1564](../../lib/pilot/StepExecutor.ts#L1552-L1564)) correctly short-circuits the `ai_processing` step with the deterministic no-data payload. WP-13 is doing its job — the real loss happened one layer upstream. **Surfaced live 2026-05-30** on agent `22da09f7-d697-4072-8eaf-e1ef83df5a2e` ("Top AI App Releases — Weekly Blog Table Email"): step1 (`chatgpt-research.research_topic`) returned a real result with `summary`, 5 `sources[]`, `key_points[]`; step2 (`ai_processing` → `top_items`) ran in 337ms with 0 LLM tokens (dev.log L9529), input collapsed `11221 → 2 chars` (`savingsPercent: "100.0"`, dev.log L9482-9485), WP-13 fired `reason: "input is null/undefined"` (dev.log L9486-9490); step3 built an empty "no data" HTML body; step4 dutifully emailed it. Same "silent data loss masked by a downstream guardrail" family as WP-32 (StructuralRepairEngine rewriting a valid `flatten.field` to `"emails"` because the validator looked at the wrong level), WP-40 (IRFormalizer blind-guess auto-correcting a filter input by appending `attachments`), and WP-13 itself (anti-hallucination guard hiding the empty-input cause). Distinct from those because the lossy step is the **preprocessing** layer, not the IR/compiler/auto-repair layer. **Targeted fix landed; the underlying anti-pattern is tracked separately as [WP-51](#wp-51-datapreprocessor-shape-heuristic-routing-into-lossy-specialized-preprocessors-architectural).** | P0 | ✅ Fixed (2026-05-30) — tightened the `'event'` heuristic so `summary` alone is no longer sufficient. The `summary` clause now requires co-occurrence with at least one event-specific co-field (`start`, `end`, `startTime`, `organizer`, `attendees`). Preserves Calendar event detection (which always carries `start`/`end` plus `organizer`/`attendees`) while no longer eating research outputs, AI summaries, document summaries, extractor results, or any other shape whose top level happens to carry a `summary` field. One-line change. |
| [WP-51](#wp-51-datapreprocessor-shape-heuristic-routing-into-lossy-specialized-preprocessors-architectural) | **Architectural / family-of-bugs.** The DataPreprocessor's whole routing design — `detectDataType()` matching plugin-output shape against hardcoded field-name heuristics, then dispatching to specialized preprocessors (`EmailPreprocessor`, `EventPreprocessor`, `ContactPreprocessor`, `TransactionPreprocessor`) that are **destructive** (drop items failing their type-specific validators) — guarantees that any LLM/plugin output whose shape happens to overlap any heuristic clause will be silently emptied before reaching the LLM. WP-50 fixed one such clause (`summary` alone → event); the other three clauses in [DataPreprocessor.ts:178-207](../../lib/orchestration/preprocessing/DataPreprocessor.ts#L178-L207) have the same structural risk: `subject` + (`from`/`sender`/`payload`) → `'email'` → `EmailPreprocessor` (probably truncates bodies, drops items without standard email fields); `amount`/`total` + (`currency`/`status`/`paid`) → `'transaction'` → `TransactionPreprocessor`; `email` + (`firstName`/`lastName`/`name`/`properties`) → `'contact'` → `ContactPreprocessor`. No regression scenario today exercises any of these false positives, so the failure mode is latent rather than active — but the WP-50 incident is a proof-of-concept: when it surfaces, the user sees a successful-looking run with empty data and no error. Same family as WP-13 / WP-32 / WP-40 ("silent data loss masked by a downstream guardrail"). Predicted triggers as new plugins land: any future plugin returning `{subject, from/payload, ...}` for non-email semantics (e.g. RSS items, support-ticket APIs, form-submission payloads); any plugin returning `{amount, currency, ...}` for non-payment semantics (e.g. budget/quota responses, telemetry samples); any AI/extractor step that emits a normalised contact-like shape (`{email, name}`) before going through a downstream ai_processing step. | P1 | ⬜ Documented — fix deferred (architectural). Two intervention directions, both bigger than the WP-50 patch: **(A) Schema-driven routing.** Upstream step declares its output type (already partially available via `output_schema.type` + plugin manifest metadata); `detectDataType` becomes a fast lookup against that declaration instead of a shape heuristic. Eliminates the false-positive class entirely. Risk: requires schema-completeness on every plugin output; some legacy outputs may not declare a usable type. **(B) Non-destructive preprocessing contract.** Specialized preprocessors are restricted to `add metadata only, never drop items`. `EventPreprocessor.validateEvents()`, `EmailPreprocessor`'s body truncation, `ContactPreprocessor`'s validation, etc., are downgraded from "filter out invalid items" to "annotate items with `_preprocessor_warnings`". WP-13's empty-input guard remains the only place where data can be deemed empty, and it does so on the actual data, not on a side-effect of preprocessing. Risk: loses some of the noise-stripping value the specialized preprocessors were designed for; need to verify each preprocessor's drop-paths are recoverable. **(C) Hybrid (recommended).** Add a "default to GenericPreprocessor on type ambiguity" path: when the detected type's specialized preprocessor would result in `>50%` data shrink AND no item-level confidence signals, fall back to `'generic'` automatically with a warning log. Cheapest mitigation; doesn't require schema work or preprocessor rewrite. Bundle when next family member surfaces. |
| [WP-52](#wp-52-structuralrepairengine-doesnt-recognise-inputconfig-as-built-in-template-namespaces--false-positive-broken_variable_reference) | `StructuralRepairEngine.findBrokenVariableReferences()` ([StructuralRepairEngine.ts:1737-1768](../../lib/pilot/shadow/StructuralRepairEngine.ts#L1737-L1768)) walks every `{{X.Y}}` template, takes the root var (`X`), and checks it against (a) the set of step IDs / output_variable names and (b) a hardcoded `builtins` set: `['current_item', 'current_email', 'current_row', 'index', 'context']`. The set covers loop-context variables but **does not include `'input'`** — yet `{{input.X}}` is the primary templating namespace for every workflow's configuration parameters (`{{input.research_topic}}`, `{{input.recipient_to}}`, etc., resolved by `ExecutionContext.resolveVariable` against the run's input values). Every config reference therefore false-positives as a `broken_variable_reference` and is reported in the WARN log under "Structural auto-repair fired on workflow before execution". **No data corruption today** because the engine couldn't auto-fix the misflagged refs (`suggestion` from `suggestVariableCorrection` returned `null`, so `autoFixable: false`, `will_persist: false`) — runtime resolves `input.X` correctly regardless. But there is a **latent corruption risk** via the fuzzy-match path: `suggestVariableCorrection` ([L1773-1798](../../lib/pilot/shadow/StructuralRepairEngine.ts#L1773-L1798)) does Levenshtein-distance ≤ 2 matching against step IDs. Any future workflow with a step ID within edit-distance 2 of `'input'` (e.g. `inputs`, `init`) would receive a suggestion, flip `autoFixable: true`, and — in `will_persist: true` mode — silently rewrite valid `{{input.X}}` references into `{{wrong_step.X}}`. Same blind-guess auto-correction anti-pattern as WP-40 (IRFormalizer appending field names from a hardcoded list). **Surfaced live 2026-05-30** on agent `22da09f7-d697-4072-8eaf-e1ef83df5a2e` post-WP-50 fix: warning fired with `issue_count: 3, fixed_count: 0, failed_count: 3, will_persist: false` against `input.research_topic` (step1), `input.recipient_to` and `input.recipient_cc` (step4). All three are valid config references; the workflow ran successfully. Same StructuralRepairEngine validator-vs-runtime contract-mismatch family as WP-32 (validator-pulled-the-wrong-level on `flatten.field`). Also closely related to the `findConfigReferences` check at L403-419 in the same file, which catches the *opposite* mistake (`{{config.X}}` used instead of `{{input.X}}`) — both checks are in agreement that `input.X` is the canonical form, but the broken-ref check forgot to skip it. | P1 | ✅ Fixed (2026-05-30) — added `'input'` and `'config'` to the `builtins` set so neither is flagged as a broken reference. `'config'` included as defence-in-depth because (a) older Pipeline-B output occasionally emitted `{{config.X}}`, and (b) the same file's `findConfigReferences` already runs a separate normalisation pass that rewrites `config.X` → `input.X` regardless of whether the root-var check skipped, so no behaviour change there. Eliminates the warning entirely for `input.*` / `config.*` refs; also closes the latent fuzzy-match corruption window for those namespaces. One-line change. |
| [WP-53](#wp-53-phase-3-ir-author-drops-ep-level-plugin-filter-constraints-only-google-docs-only-pdfs-in-folder-x-when-authoring-stepparams) | **EP-fidelity loss in the Phase 3 IR-author (root-cause class).** When the Enhanced Prompt's prose contains a **filter constraint** that maps directly to a plugin parameter — *"Consider only Google Docs documents"* → `google-drive.list_files.file_types: ["document"]`, *"only PDFs"* → `file_types: ["pdf"]`, *"in folder Contracts"* → `folder_id: ...`, *"from sender X"* → `gmail.search_emails.query`, etc. — the Phase 3 IR-author LLM picks the right action but **drops the filter constraint** when authoring `step.params`. The action's parameter schema literally exposes the param (verified in [google-drive-plugin-v2.json:97-113](../../lib/plugins/definitions/google-drive-plugin-v2.json#L97-L113)), the EP literally states the constraint, but the IR omits the param. Downstream consumers then process all items (including ones that don't match the filter), which surfaces as either (a) cascade failures (downstream plugins receive items they can't handle — this is what happened on agent `8c7caa01-e328-4b0a-ae04-afbcd10add45`), (b) silent data dilution (filter-incompatible items become rows in the user's report), or (c) hard-to-debug "agent ran but did the wrong thing" outcomes. Same family as **WP-44** (Pipeline B's `formalization-system-v4.md` dropping `html_body` / "HTML table") and **WP-49** (`convertNotify` dropping `cc`/`bcc` — though that one is a converter-side projection, not a Phase 3 prompt issue). All three instances are *"EP says X, plugin supports X as a param, IR drops X"*. **Surfaced live 2026-05-31** on agent `8c7caa01-e328-4b0a-ae04-afbcd10add45` ("Contract Expiration Monitor"): EP said "Consider only Google Docs documents in that folder"; compiled step2 had `params: { folder_id: "{{contracts_folder.folder_id}}" }` with **no `file_types` filter**; step2 returned all 7 files including 3+ DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`); scatter step3 fanned out to `google-docs.read_document` on each; Google Docs API 400'd on the DOCX files (Hebrew error HTML page from `docs.google.com` — dev.log L11813, L11840); `ParallelExecutor` `runMode: production` fail-fast threw → execution failed. **Note the layering:** WP-49's *converter-side* projection bug was easy to fix (deterministic transformation); WP-53 is a *prompt-side* fidelity bug, which is structurally harder because the LLM has to learn a new pattern of attention. Per-instance fixes (per-agent DB patches) don't help; the family requires a prompt change so future agents don't recur. | P0 | ✅ Fixed (2026-05-31) — Phase 3 prompt change: new **§ 5.5 EP FIDELITY** section in [intent-system-prompt-v2.ts](../../lib/agentkit/v6/intent/intent-system-prompt-v2.ts) (+74 lines) instructs the LLM to scan EP `sections.data` / `sections.actions` / `sections.output` / `sections.delivery` / `processing_steps` for filter / format / recipient / scope constraints, look up the bound action's parameter schema, and emit each matching param in `step.payload` (or `recipients`/`content` for notify). Includes a pattern table covering: type/format filters ("only Google Docs" → `file_types: ["document"]`), resource IDs ("in folder Y" → `folder_id`), search-query language ("from sender X" → `query`), date filters, body format ("HTML" → `html_body`), recipients structure (to/cc/bcc), and language. Includes the WP-53 incident as the canonical anti-example. Cross-referenced from § 6.1 DATA_SOURCE (decision-tree item #4) and § 6.12 NOTIFY (EP FIDELITY block covering cc/bcc and HTML/plain body — also closes the prompt-side of WP-44 and WP-49). Adds ~400-500 tokens to every Phase 3 call; cost trivial vs the silent execution failures it prevents. **Companion runtime mitigation:** [WP-54](#wp-54-parallelexecutor-production-mode-fail-fast-amplifies-per-item-failures-into-whole-run-failures) still planned to add `scatter.continueOnError` so any future Phase 3 fidelity miss doesn't kill whole runs. **Not implemented:** the capability binder safety net (B) and the compiler-level filter auto-inject (C) — declined for now per "fix root cause first, layer defence later if it recurs." |
| [WP-54](#wp-54-parallelexecutor-production-mode-fail-fast-amplifies-per-item-failures-into-whole-run-failures) | `ParallelExecutor` running in `runMode: "production"` re-throws on any per-item scatter failure ([dev.log L11808, L11835, L11875](../../dev.log#L11808)), aborting the entire run. This is the right policy for some scenarios (when every item must succeed for the workflow to be correct — e.g. an order-processing scatter where missing one order is data loss) but **wrong for "scan a folder of mixed-type files" scenarios** where a fraction of items being un-processable is expected (Drive folders mix Google Docs / DOCX / PDF / images; Gmail searches return both relevant and spam; web research returns dead links). One bad item kills the whole run, no partial results, no skip-and-continue. Surfaced on agent `8c7caa01-e328-4b0a-ae04-afbcd10add45` as the **amplifier** for WP-53: WP-53 caused 3 items in a 7-item scatter to fail at `google-docs.read_document`; ParallelExecutor's fail-fast turned that into a whole-run failure instead of "4 items processed, 3 skipped." Distinct from WP-53 (which is the root cause — the IR shouldn't have iterated those items in the first place), but the runtime fail-fast amplifies any future Phase 3 fidelity miss into a hard execution error rather than a partial-success email. WP-10 (2026-03-31) already added scatter-gather error filtering — but that fix was scoped to the *gather* phase (separate success from error results, all-failed detection); it didn't change the *production-mode re-throw* policy on per-item failures. | P1 | ✅ Fixed (2026-05-31) at the runtime layer — `scatter.continueOnError?: boolean` field added to `ScatterGatherStep.scatter` in [types.ts](../../lib/pilot/types.ts) and honoured at [ParallelExecutor.executeScatterItem](../../lib/pilot/ParallelExecutor.ts) (~10 LOC). When `true`, production-mode skips the fail-fast re-throw and swallows the per-item error the same way calibration/batch already do (tagging the result with `{error, item:idx}`); the gather phase's existing WP-10 error filtering then separates failures from successes so downstream consumers only see good items. Default `false` — existing workflows behave exactly as before. **Deferred (separate follow-up):** (i) IntentContract LOOP grammar field + Phase 3 prompt rule for "emit `continueOnError: true` on heterogeneous-input scatters" so future agents opt in automatically; (ii) [ExecutionGraphCompiler.ts:1170-1185](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts#L1170-L1185) plumbing of `loop.continueOnError` → `scatter.continueOnError`. Both are easy follow-ups but not blocking — the runtime hatch is usable today via DB patches or manual DSL edits (which is how agent `8c7caa01-e328-4b0a-ae04-afbcd10add45` will be remediated as part of the WP-53 incident response). |
| [WP-55](#wp-55-phase-1-intentcontract--phase-2-data_schema-not-persisted-on-the-agents-row--production-diagnosis-of-llm-emission-variance-requires-non-deterministic-llm-re-runs) | **Observability / production diagnosis gap.** The Phase 1 `IntentContract` (raw LLM output that authored the IR) and the Phase 2 `data_schema` (slot schemas + semantic types built from plugin definitions) are NOT persisted on the `agents` row. They live in memory during `/api/v6/generate-ir-intent-contract`, surface in Pino at info level (`[IntentGen] ✅ Intent Contract generated successfully` with `{ intent: v.value }` — [generate-intent.ts:296](../../lib/agentkit/v6/intent/generate-intent.ts#L296)), and are then discarded. The final compiled DSL on `agents.pilot_steps` carries no fingerprint of which Phase 1 emission produced it. When an agent fails in production (especially failures that depend on Phase 1 LLM emission variance — cf. WP-53 / WP-49 / this incident), diagnosis requires either (a) searching Pino logs by `correlationId` (assuming logs are shipped + retained — not guaranteed) where the `correlationId → agent_id` mapping isn't persisted anywhere, or (b) re-running the EP through Pipeline A's endpoint to capture the IC live (which costs LLM tokens AND is non-deterministic — the re-run can author a CORRECT IC that doesn't reproduce the bug, exactly as we observed during the contracts-googledocs-v2ui-pipeline-a investigation — see [scenario known_weaknesses](../../tests/v6-regression/scenarios/contracts-googledocs-v2ui-pipeline-a/scenario.json)). **Surfaced 2026-06-01** as the meta-problem during that investigation: we spent several hours hunting the `id` → `folder_id` schema mutation via static analysis because the agent's actual Phase 1 emission wasn't recoverable. A re-run produced a different (correct) emission that didn't carry the bug. With persisted intent_contract + data_schema, the diagnosis would have been a one-query lookup: *"agent X's IntentContract had `field: \"folder_id\"` at this exact location; here's the data_schema slot it bound to."* The `agents.agent_config` JSONB column already exists ([types.ts:52](../../lib/repositories/types.ts#L52), [CreateAgentInput:94](../../lib/repositories/types.ts#L94)) and already holds `creation_metadata.platform_version`, `ai_context.enhanced_prompt`, `ai_context.reasoning`, etc. — the exact right home for these two additional artifacts. No new table, no migration; just two new keys in the JSONB. Not a runtime correctness bug (workflows still execute), but high-leverage observability: makes every future Phase 1 emission-variance bug a one-step lookup instead of a multi-hour hunt. Related to but distinct from the WP-13 / WP-50-style *runtime* observability gaps (those are about silent data loss; this is about *creation-time* artifact loss). | P2 | ✅ Fixed (2026-06-01) — Pipeline A response extended to carry `intent_contract` (Phase 1 raw LLM output) and `data_schema` (Phase 2 slot schemas) alongside `ir` and `workflow` ([generate-ir-intent-contract/route.ts:234-245](../../app/api/v6/generate-ir-intent-contract/route.ts#L234-L245)). V2 UI's `mapV6ResponseToAgent` forwards both into `agent_config.ai_context.intent_contract` / `.data_schema` ([page.tsx:262-275](../../app/v2/agents/new/page.tsx#L262-L275)). `CreateAgentAIContext` interface extended with the two new optional fields, declared `?: unknown \| null` for backwards-compat with pre-WP-55 agents and non-V6 generators ([generate-agent-v2.ts:212-231](../../components/agent-creation/types/generate-agent-v2.ts#L212-L231)). `/api/create-agent` needed NO code change — its Zod schema already accepts arbitrary keys inside `agent_config` via `z.record(z.unknown()).nullish()` (WP-48 work). Implementation totalled ~107 LOC across 4 files; no schema migration. **Diagnosis SQL pattern** documented in [V6_DEVELOPER_GUIDE.md § "Diagnosing a Production Agent's Phase 1 Emission (WP-55)"](./V6_DEVELOPER_GUIDE.md#diagnosing-a-production-agents-phase-1-emission-wp-55) with a checklist of bug fingerprints (wrong field references, wrong plugin choice, missing EP constraints) — direct ties to the WP-44 / WP-49 / WP-53 family. **Pre-WP-55 agents** carry `intent_contract = null` / `data_schema = null`; no backfill possible (source artifacts were never persisted). **Future companion (not implemented):** a `getAgentDiagnostics(agentId)` repository method that bundles `{intent_contract, data_schema, pilot_steps, creation_metadata}` for a future admin UI. |
| [WP-56](#wp-56-phase-1-references-the-wrong-field-name-on-a-scatterloop-iteration-variable-container-id-reused-for-items) | **Phase 1 emits a field reference on a scatter/loop iteration variable using a field name that belongs to a *different* resource, so it resolves to `undefined` at runtime.** Same incident agent as WP-49/53/54/55 (`8c7caa01-e328-4b0a-ae04-afbcd10add45`, "Contract Expiration Monitor"). The workflow first resolves a **folder** (a `find_or_create_folder`-style step whose output identifier is `folder_id`), then `list_files` inside it (Drive file items expose `id`), then scatters over those files calling `google-docs.read_document` with `document_id: "{{doc_item.folder_id}}"`. Drive file items have **no** `folder_id` field — the LLM reused the *container's* identifier name (`folder_id`) for the *items*. At runtime `{{doc_item.folder_id}}` → `undefined` → `document_id` defaults to `""` → Google Docs API 400 on every item ([dev.log L7468 `GET .../documents/ 400`](../../dev.log#L7468)); WP-54 swallows each, WP-10 throws `3/3 items failed`. **Why nothing caught it:** (a) WP-2's field-name reconciliation is scoped to step **output** schemas, NOT scatter/loop **iteration-variable** field refs (gap explicitly noted in the [contracts-googledocs-v2ui-pipeline-a scenario `known_weaknesses`](../../tests/v6-regression/scenarios/contracts-googledocs-v2ui-pipeline-a/scenario.json)); (b) the compiler's O10 reconciliation found no mismatch because the agent's stored step2 `output_schema` *also* carried key `folder_id` (description "Unique file ID") — schema and reference agreed on the wrong name. The root cause of that `id` → `folder_id` **schema mutation** (DataSchemaBuilder uses straight key copy from the plugin def, which returns `id`) is still **NOT pinned** — it appears downstream of `DataSchemaBuilder`, possibly triggered by the LLM's `field: "folder_id"` reference. Same family as **WP-2** (field-name mismatch) and **WP-53** (EP-fidelity), but distinct: this is *iteration-variable* field fidelity, an area no existing reconciliation covers. **Phase 1 emission is non-deterministic** — a 2026-06-01 re-run emitted the CORRECT `field: "id"` + `read_file_content` and didn't reproduce. | P1 | 🟡 Partial (2026-06-08) — **root-cause prompt steering added:** new **FIELD FIDELITY (WP-56)** rule in § 6.9 LOOP "CRITICAL LOOP RULES" of [intent-system-prompt-v2.ts](../../lib/agentkit/v6/intent/intent-system-prompt-v2.ts) instructs the LLM that `item_ref.<field>` names MUST come from the iterated collection's element schema (`loop.over` producer's `output_schema` items), never reused from a container/other step — with the folder-id-vs-file-id case as the canonical anti-example, framed plugin-agnostically (container vs items). Applies to scatter-gather iteration variables too. **Still open:** (i) deterministic safety net — extend WP-2-style reconciliation to scatter/loop iteration-variable field refs (the calibration-side detector is tracked as P3 in [CALIBRATION_FALSE_SUCCESS_FIX_WORKPLAN.md](../../docs/workplans/CALIBRATION_FALSE_SUCCESS_FIX_WORKPLAN.md)); (ii) pin the `id` → `folder_id` `data_schema` mutation via a live capture with intermediate-state dumps (WP-55 persistence now makes this recoverable). |

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
**Solution (build tasks):** [WORKPLAN_INTENT_CONTRACT.md](./V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md) tasks **0.4** (grammar), **0.5–0.6** (Phase 1 prompt), **2.11** (DataSchemaBuilder recursive copy) — then retire [v6-archive/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md](./v6-archive/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN.md) task **7.3** safety net once regression shows 0 firings. Full layered solution sketch in the *Proposed solution* subsection below.

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

### WP-47: V2 UI re-prompts for input values already provided via EP resolved_user_inputs (on Pipeline A)

**Severity:** P1 — UX-blocking only on Pipeline A. The user has already provided all the values during the conversational EP-build phase; the V2 UI then asks again for each one before finishing agent creation. Existing Pipeline B users don't see this; new Pipeline A users do (and there's no functional consequence beyond the UX — the user can re-enter the values and the agent works).
**Encountered as:** User report on 2026-05-19 right after the Pipeline A migration landed: "while building the agent via the thread based prompt flow, I answer all the questions and provides all the input values, but still at the end of the creation it prompts the fields it needs once more." Reproduced on agent `670cac2a-…` (the leads-qualified-stage4-v2ui-pipeline-a scenario). Investigation traced the bug to a key-naming mismatch between two namespaces the V2 UI's flow tries to reconcile.
**Status:** ✅ Fixed (2026-05-19, branch `feature/v6-v2-integration`)

**Problem:**

After the V6 endpoint returns, [`app/v2/agents/new/page.tsx`](../../app/v2/agents/new/page.tsx) does two things:

1. **Builds `input_schema`** via `extractInputSchema(workflow_steps, enhancedPromptData)` from THREE sources (lines 111-176):
   - **Source 1** — scan DSL `workflow_steps` for `{{input.X}}` references. Produces entries like `name: "spreadsheet_id"`.
   - **Source 2** — iterate `enhancedPromptData.specifics.resolved_user_inputs`. Comment: *"V6 compiler hardcodes resolved values into steps, so {{input.*}} patterns won't exist"* — assumes Source 1 will be empty. Produces entries like `name: "google-sheets__table/get__spreadsheet_id"`.
   - **Source 3** — `user_inputs_required` (unanswered inputs).

2. **Filters for required-and-missing** (line 1190):
   ```ts
   agentData.input_schema?.filter(
     (input) => input.required === true && !(input.name in resolvedInputs)
   )
   ```
   where `resolvedInputs` is a plain JS object built from EP `resolved_user_inputs`, keyed by the EP-Key-Hint names.

**The mismatch on Pipeline A:**

| Source 1 entry (DSL ref name) | Source 2 entry (EP key) | `in resolvedInputs`? |
|---|---|---|
| `spreadsheet_id` | `google-sheets__table/get__spreadsheet_id` | NO — re-prompted |
| `tab_name` | `google-sheets__table/get__tab_name` | NO — re-prompted |
| (no Source 1) | `notes_column_header` | YES — skipped |
| (no Source 1) | `stage_match_type` | YES — skipped |

The DSL uses Pipeline A's IC LLM-chosen names (`spreadsheet_id`); the resolvedInputs map uses EP-Key-Hint names (`google-sheets__table/get__spreadsheet_id`). The same conceptual input shows up as TWO `input_schema` entries with no bridge between them. V2 UI prompts the user for the DSL-name version every time.

**Why Pipeline B didn't surface this:**

Pipeline B's compiler (in the deprecated semantic flow) **inlines** `resolved_user_inputs` values directly into DSL `params` at compile time:
```jsonc
"params": { "spreadsheet_id": "1RHL..." }   // ← literal, no {{input.*}} ref
```
Source 1's regex finds nothing in Pipeline B's DSL → no entries with DSL-ref names → no key-mismatch. Source 2 alone produces the schema, with all keys in EP-Key-Hint format matching `resolvedInputs` perfectly.

The cost of Pipeline B's approach: values are frozen into the DSL at compile time, can't be changed later without re-compiling. Pipeline A's approach (keep `{{input.X}}` refs, resolve via `agent_configurations.input_values` at runtime) is architecturally cleaner — but exposed this bridging gap.

**Why this wasn't caught earlier:**

The Pipeline A migration's Stage P1 investigation focused on the response-contract shape the V2 UI's `mapV6ResponseToAgent` consumes — what fields the UI reads from the response. The downstream `requiredParams` filter (the actual user-facing prompt-flow gate) operates AFTER `mapV6ResponseToAgent` runs, on `agentData.input_schema`. P1 didn't audit the post-mapping flow because it was already "working" for Pipeline B. The bug only manifests when (a) the DSL has `{{input.X}}` refs (Pipeline A only) AND (b) those refs use names different from the EP's resolved_user_inputs keys (Pipeline A only, because the IC LLM renames them).

**Fix shape:**

Pipeline A's IR carries `config_defaults: [{key, default, type, description}, ...]` where `key` matches the DSL's `{{input.X}}` ref names by construction (the same converter emits both) AND `default` carries the value the IC LLM transcribed from the EP. The endpoint already returns this in `v6Data.ir.config_defaults`. V2 UI just needs to pre-populate `resolvedInputs` from it:

```ts
// app/v2/agents/new/page.tsx around line 1180
if ((v6Data as any)?.ir?.config_defaults) {
  for (const entry of (v6Data as any).ir.config_defaults) {
    if (entry?.key && entry.default !== undefined && !(entry.key in resolvedInputs)) {
      resolvedInputs[entry.key] = entry.default
    }
  }
}
```

After this:
- `resolvedInputs.spreadsheet_id = "1RHL..."` ✓ (from IR's config_defaults, matches DSL ref)
- `resolvedInputs.tab_name = "Leads"` ✓
- Filter at line 1190 finds all IC keys in resolvedInputs → no re-prompting.

Pipeline B is unaffected because Pipeline B's response doesn't carry `ir.config_defaults` in a comparable shape (and even if it did, Pipeline B's DSL has no `{{input.X}}` refs to match against, so the entries wouldn't show up in `input_schema` from Source 1).

**Files:**

- [`app/v2/agents/new/page.tsx`](../../app/v2/agents/new/page.tsx) — ~12 LOC added in the post-V6-response block that builds `resolvedInputs`. Reads from `v6Data.ir.config_defaults` and merges entries whose keys aren't already in `resolvedInputs`. Pipeline B safe (no-op when `ir.config_defaults` absent).

**Test coverage:**

Verified manually: re-creating an agent via V2 UI with `NEXT_PUBLIC_USE_V6_PIPELINE_A=true` and confirming the post-V6 step transitions directly to scheduling without re-prompting (when all `config[].default` values are populated). The leads-qualified-stage4 scenario is the canonical regression seed.

**Follow-ups not addressed by this fix:**

- `extractInputSchema` (lines 111-176) still produces duplicate-looking entries (e.g., both `spreadsheet_id` and `google-sheets__table/get__spreadsheet_id` in `input_schema`). Visual concern only — the values are pre-filled, the user doesn't get prompted. Worth a polish PR that dedupes entries by path-suffix matching (e.g., recognise that `google-sheets__table/get__spreadsheet_id` ends with `spreadsheet_id` so they're the same conceptual input). Not user-blocking; not done in this commit.
- The IC LLM could be steered to use EP-Key-Hint format for its `config[].key` names, which would eliminate the mismatch at the source. Prompt-engineering change; defer until clearer evidence the current naming is causing other downstream issues.

**Related anti-pattern:**

This is the same shape as WP-22 / WP-30 / WP-42 — two layers in the same pipeline using different naming/format conventions for what is logically the same value, with no bridge. The fix is always a bridge at the lowest-friction point (here, V2 UI). Worth a V6_DESIGN_PRINCIPLES note: when two layers each independently CAN choose a naming convention, and they cross over, one of them is going to bear the bridging cost — design the cheaper side to be the bridge layer.

---

### WP-46: `transform/with_fields` with constants-only produces per-item array instead of singleton object

**Severity:** P0 — every Pipeline-A workflow that uses `with_fields` to compute named constants for downstream filters/comparisons silently produces an array instead of the singleton object the downstream consumer expects. The error surface is identical to WP-45 (downstream variable resolves to undefined; filter returns 0 rows; "no data" email sent) but the root cause is one step earlier in the chain.
**Encountered as:** Stage P4 live Phase E re-run after WP-45 was applied, on `gantt-urgent-tasks-v2ui-pipeline-a` (`4c74a248-…`), 2026-05-17. step5 (priority filter) correctly produced 4 candidates. step6 (date-range filter) still returned 0 rows. Log showed `Resolving variable {{date_window.window_start}}` now happens (WP-45 wrapping kicked in), but `resolveVariable` returned `undefined`. Inspection of step4's output: `[{Tasks: "Date", window_start: "...", window_end: "..."}, {Tasks: "Brand Efforts", window_start: "...", window_end: "..."}, ×57]` — an **array of 57 row copies**, not the singleton `{window_start, window_end}` the IR expected.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`)

**Problem:** [`transformWithFields`](../../lib/pilot/transforms/StructuredTransforms.ts) is documented as "augment each input item with computed fields." Its contract: input array (N items) → output array (N items, each with new fields spread on top). When the IntentContract LLM emits a `with_fields` step like:

```json
{
  "type": "with_fields",
  "input": "{{task_objects}}",
  "fields": [
    {"name": "window_start", "expression": {"kind": "today"}},
    {"name": "window_end",   "expression": {"kind": "date_add", "date": {"kind": "today"}, "days": {"kind": "config", "key": "date_window_days"}}}
  ],
  "output_variable": "date_window"
}
```

…the LLM's actual intent is *"compute two named constants and store them as `date_window` for downstream comparisons."* All field expressions are constants — none reference `item.*`. But the runtime faithfully applies the per-item augmentation contract: 57 input rows → 57 output rows, each augmented with the same constant values.

Downstream filter then does `{ field: "item.Due Date", value: "date_window.window_start", operator: "gte" }`. After WP-45 the bare-string ref is wrapped to `{{date_window.window_start}}` and `resolveVariable` is called. But `date_window` is an array — accessing `.window_start` on it returns `undefined`. Filter compares `"19/5/2026" >= undefined` → false for every row. Silent 0-output.

**Compounding root cause — same anti-pattern as WP-41:** the LLM picked a transform whose runtime semantics don't match the intended use. WP-41 was `select` (single-object construction) being aliased to `map` (per-item iteration). WP-46 is `with_fields` (per-item augmentation) being used for the singleton-constants pattern. Both errors are at the "semantic match between transform choice and intended use" surface. Both are fixed via runtime tolerance — detect the pattern, switch to the right output shape.

**Why this wasn't caught earlier:**

- The old `gantt-urgent-tasks` regression scenario used `with_fields` to build `days_until_finish` — a NUMBER computed PER ITEM (`date_diff(today, due_date, 'days')` where `due_date` is from the current item). That correctly produces an array of augmented rows because the per-item augmentation matches the intent (every row gets its own `days_until_finish` value).
- Pipeline A's new scenario uses a different pattern: `with_fields` with constants ONLY (no per-item refs). The compiler/runtime never had to distinguish before because Pipeline B's IRFormalizer routed through `ai_processing/extract` to do the date math — no `with_fields` step needed.
- This is the first time a Pipeline-A LLM emitted constants-only `with_fields`, exposing the semantic gap.

**Fix shape — runtime tolerance:**

Detect at runtime whether ALL field expressions are constant (no `kind: "ref"` targeting `item.*`). If so, evaluate once and return a singleton object. Otherwise, retain the existing per-item augmentation behaviour.

```ts
const allConstant = fields.every((f: any) =>
  f && f.expression !== undefined && isConstantExpression(f.expression)
);
if (allConstant) {
  const singleton: Record<string, any> = {};
  for (const field of fields) {
    singleton[field.name] = evaluateExpression(field.expression, null, context, evaluator);
  }
  return singleton;
}
// ... existing per-item augmentation path unchanged ...
```

The detection (`isConstantExpression`) walks the expression tree recursively. A `kind: "ref"` node is considered per-item iff `ref === "item"` or starts with `"item."`. Any other ref kind (`config`, `today`, `literal`, refs to other global variables, nested `date_add`/`date_diff`) is constant. Conservative — unknown shapes treated as non-constant to preserve existing behaviour.

**Files:**

- [`lib/pilot/transforms/StructuredTransforms.ts`](../../lib/pilot/transforms/StructuredTransforms.ts) `transformWithFields()` — added constants-only fast-path (~25 LOC) + new `isConstantExpression()` helper (~15 LOC).

**Test coverage:**

End-to-end live Phase E on `gantt-urgent-tasks-v2ui-pipeline-a` (3 real tasks delivered in HTML email). **Follow-up:**
- Unit test `transformWithFields` const-only path: synthetic config with `{kind: "today"}` + `{kind: "literal", value: 3}` fields, input array of 5 items. Assert output is a single object with both fields, not an array of 5.
- Unit test `isConstantExpression`: `{kind: "today"}` → true; `{kind: "ref", ref: "item.due_date"}` → false; `{kind: "date_add", date: {kind: "today"}, days: {kind: "config", key: "x"}}` → true (nested constants); `{kind: "date_add", date: {kind: "ref", ref: "item.start"}, days: {kind: "literal", value: 7}}` → false (nested item ref).
- Regression test: re-run all existing W2/`with_fields` regression scenarios; assert their behavior didn't change (most have at least one per-item field, so the new path doesn't activate).

**Related observation — same anti-pattern as WP-41:**

WP-41 and WP-46 share the same shape: LLM picks transform A; the downstream consumer's data flow expects shape B; A and B are different runtime semantics. The fix in both cases is runtime tolerance that switches to shape B when the pattern is detected. Worth a V6_DESIGN_PRINCIPLES note: when an LLM picks a transform type that's "almost right but a different output shape," runtime tolerance is usually cleaner than IR-level rewriting or prompt steering. (a) Runtime tolerance is localized and easy to test; (b) IR rewriting requires the converter to understand the LLM's downstream-consumer intent; (c) prompt steering is fragile across LLM versions.

---

### WP-45: ConditionalEvaluator `gte`/`lte` do not resolve bare variable refs and are not date-aware

**Severity:** P0 — every `transform/filter` that uses ordered comparisons (`gte`/`lte`/`gt`/`lt`) on date or variable-reference values silently returns 0 rows. Pipeline correctness-wise the filter "runs" — no error, no warning — but downstream conditional steps then route to the wrong branch (commonly the "no results" path) and the user sees an empty result email despite real data being upstream.
**Encountered as:** Stage P4 live Phase E run on Pipeline A's `gantt-urgent-tasks-v2ui-pipeline-a` agent (`4c74a248-…`), 2026-05-17. Pipeline A's IntentContract LLM generated a more elegant workflow than Pipeline B: `transform/with_fields` computes a `date_window = {window_start, window_end}` object using W2 expressions (`{kind: "today"}`, `{kind: "date_add", ...}`), then `transform/filter` directly compares `item.Due Date >= window_start && <= window_end` using `gte` / `lte`. step5 (priority filter) correctly produced 4 candidate rows; step6 (date-range filter) dropped all 4. Diagnosis: condition.value was the bare string `"date_window.window_start"` (not wrapped in `{{...}}`), so the runtime treated it as a literal; even if it had been resolved, the ISO date string would have been compared lexicographically to the DD/MM/YYYY value, failing anyway.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`)

**Problem (two compounding gaps in one file):**

[`lib/pilot/ConditionalEvaluator.ts`](../../lib/pilot/ConditionalEvaluator.ts) is the runtime for `transform/filter` conditions. Two specific gaps:

**Gap (a) — bare-string variable refs only resolved for `in`/`not_in`.** WP-22's defensive wrap (line 168-175, the "O26" comment) handled `condition.value` as a bare RefName specifically for `in`/`not_in` operators. Every other operator (`gte`/`lte`/`gt`/`lt`/`eq`/`ne`) saw the bare string as a literal. The IC LLM (and likely the IRFormalizer too) commonly emits `condition.value: "date_window.window_start"` for cross-variable comparisons, not `{{date_window.window_start}}`.

**Gap (b) — `gte`/`lte`/`gt`/`lt` do raw `>=`/`<=`/`>`/`<`, not date-aware.** Lines 570-588 (pre-fix) called native JavaScript operators without consulting `parseDate`. Only the date-specific operators `before` / `after` / `within_last_days` (lines 715-731) called the internal `parseDate`. So even if Gap (a) were fixed and the runtime received `"2026-05-17T00:00:00.000Z"` as the value, comparing it via `>=` to `"19/5/2026"` (DD/MM/YYYY string) is lexicographic and always false.

**Compounding root cause — two date parsers diverged.** The W2 expression evaluator (`lib/pilot/transforms/StructuredTransforms.ts`'s `parseDate`) was hardened during WP-29 / WP-30 / WP-31 (2026-05-11): added locale-aware DD/MM vs MM/DD disambiguation, UTC-midnight `today`, calendar-day `date_diff`. **`ConditionalEvaluator.ts` had its own private `parseDate`** — narrower, only matched a few fixed regexes (`MM/DD/YYYY` hardcoded), no DD/MM/YYYY support, no locale awareness. WP-29 didn't touch it because the WP was scoped to W2 expressions. The two parsers diverged; one got fixed, one stayed brittle.

**Why this wasn't caught earlier:**

- The old `gantt-urgent-tasks` regression scenario used a different shape: `with_fields` built `days_until_finish` as a NUMBER (`date_diff(today, due_date, 'days')`), then filtered on that number (`days_until_finish >= 1 && <= 3`). Pure numeric comparison — never exercised the filter-side date parser.
- Pipeline B's `gantt-urgent-tasks-v2ui` scenario sidestepped this entirely by routing through `ai_processing/extract` ("filter to tasks due in the next 3 days") — the LLM did the date math semantically.
- Pipeline A took a cleaner approach (deterministic `with_fields` produces `date_window`, then `filter` compares dates directly). That shape **never existed before** in any regression scenario. The bug surfaced the first time a fresh LLM picked this design.
- WP-22 (set_difference.reference bare RefName) added the defensive wrap narrowly to `in`/`not_in`. The lesson — "runtime should tolerate bare RefNames for variable references" — didn't generalize because none of the subsequent scenarios needed it.

**Fix shape:**

Two coordinated changes plus a parser unification, all in `ConditionalEvaluator.ts`:

1. **Generalize the bare-string defensive wrap** — new `looksLikeBareVariableRef()` helper (identifier-path regex). Apply the wrap to all operators when the value parses as a path; literal values with spaces/punctuation stay literal:
   ```ts
   } else if (looksLikeBareVariableRef(expectedValue)) {
     const resolved = context.resolveVariable(`{{${expectedValue}}}`);
     if (resolved !== undefined && resolved !== `{{${expectedValue}}}`) {
       expectedValue = resolved;
     }
   }
   ```

2. **Date-aware ordered comparisons** — new `compareAsDates(left, right)` helper. When both sides look date-like (string or Date) AND both parse via the shared parser, compare by `Date.getTime()`; otherwise fall through to native `>=`/`<=`/`>`/`<` (numeric / string comparisons in existing scenarios unaffected):
   ```ts
   case 'gte': {
     const cmp = compareAsDates(left, right);
     return cmp !== null ? cmp >= 0 : left >= right;
   }
   ```

3. **Delegate `parseDate` to the WP-29 shared parser.** Import `parseDate as parseDateShared` from `StructuredTransforms.ts`. The private `ConditionalEvaluator.parseDate` keeps the numeric-input path (Unix timestamps) but delegates string handling to the shared parser. This eliminates the duplicate weaker parser and makes `before` / `after` / `within_last_days` benefit from WP-29's locale-aware disambiguation too.

**Files:**

- [`lib/pilot/ConditionalEvaluator.ts`](../../lib/pilot/ConditionalEvaluator.ts) — `~50 LOC net`: import shared parser, add 2 helpers, generalize bare-string wrap, rewrite `gte`/`lte`/`gt`/`lt` cases, replace private `parseDate` with delegating thin wrapper.

**Test coverage:**

End-to-end live Phase E on `gantt-urgent-tasks-v2ui-pipeline-a` (3 real tasks delivered in HTML email). **Follow-up:**
- Unit test `compareAsDates`: ISO vs DD/MM, DD/MM vs DD/MM, ISO vs ISO, mixed numeric / date inputs.
- Unit test `looksLikeBareVariableRef`: `"existing_message_ids"` → true; `"date_window.window_start"` → true; `"item.0"` → false (no, that should be true — it matches the regex); `"Critical, High"` → false (comma); `"Done"` → false (single word but matches regex — false positive). Confirm `resolveVariable(`{{Done}}`)` returns `{{Done}}` unchanged so a literal "Done" stays as itself.
- Regression test: synthetic IR with `filter` condition `{field: "item.due_date", value: "wrapper.start", operator: "gte"}` + a `wrapper` variable holding an ISO date. Assert items with `due_date >= wrapper.start` pass.

**Related observation — DESIGN_PRINCIPLES Principle 12 candidate:**

WP-45 surfaces a new anti-pattern: **"runtime helpers that look the same should BE the same."** Two `parseDate` functions in two files diverged; one got hardened, one didn't, and the divergence was invisible until a scenario exercised the second path. Worth adding to V6_DESIGN_PRINCIPLES: when shared runtime concepts (date parsing, variable resolution, type coercion) exist in multiple places, prefer a single canonical helper imported by all consumers. The duplicate-implementation shape is identical to WP-21/22/25/28's "runtime tolerance pattern" but at the helper-library level: tolerance code should live in one place, not be reinvented per call site.

---

### WP-44: V6 formalization drops explicit EP format requirements (HTML vs plain text)

**Severity:** P1 — pipeline runs correctly and delivers correct DATA; only the OUTPUT FORMAT is wrong. User sees the right tasks but in a plain-text ASCII-pipe table instead of the requested HTML table. Annoying rather than wrong-content, but a fidelity gap nonetheless — and a regression vs. the previous IntentContract pipeline that handled this correctly.
**Encountered as:** Stage 1.2f review of the delivered email on `gantt-urgent-tasks-v2ui` (2026-05-17), after WP-39/40/41/42/43 fixed all runtime + extraction issues. User reported receiving an email containing the correct 3 tasks but formatted as a plain-text table with ASCII pipe separators, despite the EP explicitly specifying HTML 6 times.
**Status:** ⬜ Documented — fix deferred. Bundle with WP-43 Option A in the next Phase 3 prompt-fidelity follow-up session.

**Problem:** The Enhanced Prompt for this scenario reads (excerpt):

```
sections.output:
- "Generate a nice HTML summary table for the matching due-soon tasks."
- "The HTML table must include columns in this order: Task Name, Priority, Due Date, Status."
- "If any tasks were skipped due to invalid/missing Due Date, include a separate HTML section..."

sections.delivery:
- "Put the HTML summary table in the email html_body."
- "If there are skipped tasks, include the skipped section in the same email html_body below the main table..."
```

The user named the parameter (`html_body`) explicitly. But the V6 IRFormalizer (using `formalization-system-v4.md`) authored:

| Step | Authored content | Should have been |
|---|---|---|
| step8 (AI generate) prompt | `"Create a concise plain-text email body listing the tasks in a readable table-like format..."` | `"Create an HTML summary table with columns..."` |
| step8 output_schema | `body: { description: "Plain-text email body" }` | `body: { description: "HTML email body containing the summary table" }` |
| step9 (send_email) params | `content: { body: "{{tasks_email_content.body}}" }` | `content: { html_body: "{{tasks_email_content.body}}" }` |

The model dropped "HTML" entirely and defaulted to "plain-text" — a generic safe default that doesn't reflect user intent. Same pipeline ran the previous `gantt-urgent-tasks` scenario (via the OLD IntentContract pipeline) and correctly produced `content.html_body` with HTML generation — so the regression is specifically in the V6 formalization prompt, not anywhere else.

**Why this wasn't caught earlier:**

- Regression scenarios commit pre-baked phase4 snapshots; the format-fidelity gap doesn't surface because the snapshots have the right shape already (either hand-edited or generated by a different prompt version).
- Phase A / Phase D validation gates check structural correctness (steps connect, types match, etc.) — not "did the authored prompt match the EP's stated format choice." There's no validator that reads `sections.delivery` and checks the resulting send-step parameter.
- This is the first end-to-end Phase E run from V2 UI to deliver a real, user-visible email. Earlier scenarios either failed at runtime (so the email never sent) or sent emails that happened to use plain-body matching plugin behaviour by accident.

**Fix shape:**

Two angles (mutually compatible; either alone suffices):

**Option A — formalization-system-v4.md prompt extension.** Add a section to the Phase 3 prompt teaching the LLM to:
1. Scan `sections.output` and `sections.delivery` for explicit format keywords (`HTML`, `Markdown`, `plain text`, `JSON`, `table`, etc.)
2. Scan for explicit plugin-param names (`html_body`, `markdown_body`, `body`)
3. When found, author the AI generation prompt to produce that format AND wire the result to the matching plugin parameter
4. When ambiguous, prefer the user's explicit phrasing over the LLM's "safe default" of plain text

This is the same family as WP-43 Option A. Both surfaces (column-letter refs + format choices) are EP-level user requirements that the V6 formalization prompt currently fails to preserve. Bundle as one follow-up session.

**Option B — compiler-side rewrite.** Less attractive: when the EP contains `html_body` and the IR/DSL has `content.body`, swap to `content.html_body`. Brittle (tries to compensate for what the LLM should have authored correctly) and only fixes one specific manifestation. Not recommended.

**Files (when fix lands):**

- [`lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`](../../lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md) — section to add: EP fidelity guidance for AI generation + delivery params.

**Test coverage (when fix lands):**

- Unit test: synthetic EP with `html_body` and "HTML" in delivery section, verify the resulting IR uses `content.html_body` for send_email and authors an HTML-generation prompt for the upstream AI step.
- Regression: re-run `gantt-urgent-tasks-v2ui` through V2 UI after the prompt fix; verify the new IR has `content.html_body` and the AI prompt says "HTML".

**Related observation — Phase 3 prompt fidelity:**

WP-43 + WP-44 are the same anti-pattern shape: the Phase 3 LLM transcribes loosely from the EP, dropping or misinterpreting specifics. WP-43 dropped data-shape context (column letters → named keys) and temporal anchors (now). WP-44 drops format choices (HTML → plain text) and plugin-param names (`html_body` → `body`). The IC pipeline preserved these via more rigorous prompt engineering; the V6 formalization prompt regressed. Worth a comprehensive "Phase 3 prompt-fidelity audit" pass that compares IC and V6 prompts side-by-side for what guidance was lost in the migration.

---

### WP-43: ai_processing prompt-vs-data shape AND temporal-anchor drift

**Severity:** P0 — pipeline runs all steps successfully but the AI step silently returns empty results despite real matching data. User sees a "no tasks matched" email (or empty result) when the actual data has matches. Catastrophic in the "correct-looking but wrong content" category — worse than a hard failure because there's no error signal pointing at the bug.
**Encountered as:** Stage 1.2e live Phase E run on `gantt-urgent-tasks-v2ui` (`dc04876c-…`), 2026-05-17, after WP-39/40/41/42 fixes brought the runtime to 7/7 steps. Pipeline succeeded structurally; email sent; **wrong branch taken** (step7 "no tasks" branch instead of step8 "have tasks"). step5 (`ai_processing/extract`) returned `{tasks: []}` despite 3 visible tasks in the input data that matched the criteria (Critical/High priority, due within May 18-20).
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`) — runtime preamble (Option B). Option A (Phase 3 prompt change) queued as a follow-up.

**Problem:** Two compounding gaps in the `ai_processing` prompt context, each independently bad, together unrecoverable:

**(a) Shape drift — column-letter references in instruction vs named-key objects in data.**

The Phase 3 LLM authors `ai_processing.instruction` text such as:

> "Convert the provided **2D array** of Google Sheets rows into an array of task objects. Each row corresponds to **columns A:G**. Use **column A** as task_name, **column D** as status, **column F** as due_date, and **column G** as priority."

This wording is inherited verbatim from the Enhanced Prompt's `resolved_user_inputs` (`task_name_column: "A"`, `status_column: "D"`, etc.), which the user wrote when thinking about their Sheet. But the compiler auto-injects `rows_to_objects` for any Sheets-style 2D-array input, so by the time step5 runs:

- Instruction says: "2D array, columns A/D/F/G"
- Data shape: `[{Tasks: "...", RETAIL: "...", Outsourced: "...", Status: "...", Pre Dec: "...", Due Date: "...", Priority: "..."}, ×57]`

The runtime injects the data into the prompt via `buildLLMPrompt`'s `## Data for Analysis:` section, so the model sees BOTH the misleading instruction AND the actual named-key data — but it takes the instruction's "2D array" framing literally and either:
- Returns an empty array (model can't find "column A", "column D" in objects with semantic keys), or
- Fabricates values from the first row positions (worse — silent wrong data)

**(b) Temporal anchor missing — "next 3 days relative to now" but no "now" is provided.**

The instruction also says "Return only tasks whose due_date is within the next 3 days relative to now." But `buildLLMPrompt` doesn't include the current date anywhere in the prompt. The model has no reliable reference for "now" — it knows its training-cutoff date (which is stale by months/years) and it shouldn't guess.

When asked to filter by a date range it can't compute, a well-aligned model returns nothing rather than risk fabrication. So `{tasks: []}`.

**Compounding effect:** even if shape drift was the only bug, the model might guess column mappings positionally. Even if temporal anchor was the only bug, the model might infer a reasonable "now" from data context. But both together push the model firmly into the "return empty" zone — and the empty result then drives step6's conditional `is_empty` check to the wrong branch.

**Why this wasn't caught earlier:**

- Regression scenarios use committed `phase4-pilot-dsl-steps.json` snapshots; Phase D mocks return plausible data that the AI can match. No regression scenario exercises a fresh LLM-authored AI prompt against real data with date-range filtering.
- WP-13 anti-hallucination guardrails prevent fabrication when input is *technically* empty. But here input is non-empty — just incomprehensible to the model given the prompt mismatch. WP-13 doesn't apply.
- The IC prompt (`intent-system-prompt-v2.ts`) has WP-28 guidance telling the LLM "use named keys not column letters in `transform/map.field_mapping.from`" — but that's for the IntentContract pipeline AND only covers `transform/map`. The V2 UI uses `formalization-system-v4.md` (no equivalent guidance) and the gap surfaces in `ai_processing.instruction` (different surface).
- This is the first end-to-end Phase E run from V2 UI on real data with a date-range filter. The earlier successful Stage 1.2c run (3 tasks extracted) was non-reproducibly lucky — the same prompt against the same data, run twice, gave 3 tasks once and 0 tasks the second time. LLM stochasticity masks the underlying instability.

**Fix shape (Option B — runtime preamble):**

Two short anchors prepended to every `ai_processing` prompt when the resolved input is an array of objects (the post-`rows_to_objects` shape):

```
INPUT DATA SHAPE: The input below is an array of N object(s) with these named keys: [...].
If the instruction below references columns by letter or sheet position (e.g. "column A",
"column G", or "2D array of rows"), treat them as positional aliases for these keys
(column A = "key1", column B = "key2", ...). Use the named keys directly when extracting values.

CURRENT DATE: Today is YYYY-MM-DD (DDD, DD MMM YYYY). When the instruction below references
"today", "now", "the next N days", "this week", or any other temporal anchor, use this date
as the reference point. Dates in the input data may use formats like DD/MM/YYYY or D/M/YYYY —
interpret them in that locale unless explicitly told otherwise.
```

Combined ~150 tokens, fires only when there's actual data to anchor (2D arrays and scalar inputs are unaffected; non-`ai_processing` step types unaffected).

**Files:**

- [`lib/pilot/StepExecutor.ts`](../../lib/pilot/StepExecutor.ts) — new WP-43 block in `executeLLMDecision`, immediately after the WP-13 Layer 2 anti-hallucination guardrail. ~30 lines net.

**Test coverage:**

End-to-end live Phase E on `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui/` now succeeds with real content: AI step extracts 3 tasks matching Critical/High priority + due-in-next-3-days, email body lists them, conditional routes to the have-tasks branch (step8 → step9). **Follow-up:**
- (Option A) Extend `formalization-system-v4.md` AI Operation section to instruct the Phase 3 LLM to author `ai_processing.instruction` text in named-key terms (avoiding the shape-drift gap at the IR-author surface) and to never assume the runtime has access to time-relative references without explicit anchoring.
- Add unit tests verifying the preamble fires for `ai_processing` with array-of-objects input and is omitted for 2D-array, scalar, or non-`ai_processing` inputs.
- Consider extending the preamble pattern to other deterministic-language-reference cases (timezone hints, locale, etc.).

**Related observation — anti-pattern: "prompt-context completeness is a platform responsibility":**

LLMs are not deterministic compilers — they need context to reason correctly. When the workflow author or the Phase 3 LLM writes "today" or "column A", the runtime has the responsibility to translate those into something concrete. Same anti-pattern shape as WP-29 / WP-30 / WP-31 (W2 expression-evaluator runtime that resolves `today`/`config`/`date_diff` deterministically because the LLM can't) — except for free-form natural-language instructions, the resolution layer must be a *preamble* rather than a structured replacement.

Worth adding to V6_DESIGN_PRINCIPLES as a new principle or extending an existing one: **"Runtime must provide deterministic anchors that the LLM can rely on."**

---

### WP-42: Gmail plugin rejects string `recipients.to` from LLM emission

**Severity:** P0 — fires on every workflow that sends a single-recipient email via `google-mail.send_email`. The LLM commonly emits the recipient as a string (the natural reading of the EP Key Hint `google-mail__email/send_message__recipients.to: "user@x.com"` and a near-universal pattern for the "send me a summary email" use case). Plugin executor throws `TypeError: recipients.to.map is not a function` and the workflow calibration-stops at the delivery step.
**Encountered as:** Stage 1.2d live Phase E run on V2-UI-generated `gantt-urgent-tasks` agent (`dc04876c-…`), 2026-05-17, after WP-39, WP-40, AND WP-41 fixes all landed. step9 (`Deliver using google-mail`) died with `recipients.to.map is not a function`. The runtime cascade now ran 8/9 steps successfully — only the delivery step failed.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`)

**Problem:** [`gmail-plugin-executor.ts:498-512`](../../lib/server/gmail-plugin-executor.ts#L498) `buildEmailMessage()` calls `recipients.to.map((r) => ...)` (and similar for `cc` / `bcc`) assuming the plugin schema's declared `array` shape. The schema declares:

```json
"recipients": {
  "to": { "type": "array", "items": { "type": "string", "format": "email" } },
  "cc": { "type": "array", "items": { "type": "string" } },
  "bcc": { "type": "array", "items": { "type": "string" } }
}
```

But the LLM emits a single email as a string:

```json
"params": {
  "recipients": {
    "to": "meiribarak@gmail.com"   ← string, not array
  }
}
```

The pre-check `if (recipients?.to?.length)` passes truthy (the string length is positive), then `.map()` blows up.

Secondary bug compounded with this: [`base-plugin-executor.ts:194-202`](../../lib/server/base-plugin-executor.ts#L194) `countRecipients()` did `recipients.to?.length` on a string and returned the character count (e.g., 20 for `"meiribarak@gmail.com"`). The pre-execution validation rule `total_recipients > 10` then matched, logging `"Send email to {total_recipients} recipients?"` confirmation requests for what was actually one recipient. Silent inflation of validation flags.

**Why this wasn't caught earlier:**

- Existing regression scenarios that send email all happened to use array recipients (either hand-edited phase4 snapshots or generated by an LLM run that happened to emit arrays) — the typecheck never bit.
- The plugin's parameter validation accepts both string and array values at the schema-validation layer (the schema is enforced softly, not strictly) — so the bad value reaches the executor.
- This is the first end-to-end live Phase E run from V2 UI output where the LLM picked the string emission style. EP Key Hints surface the value as a string ("meiribarak@gmail.com"), and the LLM faithfully copied that string into `recipients.to` without wrapping in an array.

**Fix shape:**

Two-part runtime tolerance — mirrors the WP-21/WP-22/WP-25 pattern (runtime coerces LLM-emission-style mismatches at the boundary instead of forcing schema-level enforcement).

1. **`buildEmailMessage`**: new `toEmailArray()` helper at the top of the method. Coerces string → `[string]`, passes arrays through unchanged, drops everything else. Apply uniformly to `to`, `cc`, `bcc` before calling `.map()`.
2. **`countRecipients`**: replace `field?.length` with a typed counter: array → `.length`, non-empty string → `1`, else → `0`. Eliminates the character-count inflation in validation rules.

**Files:**

- [`lib/server/gmail-plugin-executor.ts`](../../lib/server/gmail-plugin-executor.ts) lines 498-517 — `buildEmailMessage` patched with `toEmailArray()` helper.
- [`lib/server/base-plugin-executor.ts`](../../lib/server/base-plugin-executor.ts) lines 194-205 — `countRecipients` patched with typed counter.

**Test coverage:**

End-to-end live Phase E on `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui/` confirmed both halves of the fix (real email delivered with correct recipient count). **Follow-up:** add unit tests for both helpers — `toEmailArray("a@b.com") → ["a@b.com"]`, `toEmailArray(["a@b.com", "c@d.com"]) → ["a@b.com", "c@d.com"]`, `toEmailArray(undefined) → []`; `countRecipients({to: "x@y.com"}) → 1`, `countRecipients({to: ["a", "b"], cc: "c"}) → 3`.

**Related observation — same anti-pattern as WP-21/22/25:**

Family of bugs where the LLM's natural emission style doesn't match the runtime's strict-contract expectation. The fix pattern is consistent: **runtime tolerance at the plugin-executor boundary**, not schema-level enforcement (because schema-level enforcement loses information — there's no way to recover the LLM's intent from a rejection). Adding WP-42 to the "runtime tolerance for LLM emission styles" cluster: [WP-21 (`contains_any` string RHS)](#wp-21), [WP-22 (`set_difference.reference` bare RefName)](#wp-22), [WP-25 (positional `field_mapping` target keys)](#wp-25), [WP-28 (positional source keys)](#wp-28), WP-42 (recipients.to string).

---

### WP-41: D-B18 `select` → `map` alias is syntactic, not semantic

**Severity:** P0 — fires whenever Phase 1 LLM emits `transform/select` to build a wrapper object from source-level references (a common pattern for "bundle the rows array with metadata so downstream filters can drill in via `{{wrapper.rows}}`"). Effect: step produces wrong-shape output silently; runtime resolves the downstream consumer path to undefined; cascade abort with a misleading "no input data" error several steps later.
**Encountered as:** Stage 1.2c live Phase E run on V2-UI-generated `gantt-urgent-tasks` agent (`dc04876c-…`), 2026-05-17, after both WP-39 and WP-40 fixes landed. step3 produces output type `array(57)` of identical copies of the literal config `{type:"map", input:"...", fields:{rows:<array>, row_count:..., ...}}` instead of a single wrapper object. step4's `{{sheet_rows_wrapper.rows}}` then resolves to undefined (`.rows` doesn't exist on the array), surfacing as `Transform step step4 has no input data. Available variables: sheet_read_result, sheet_read_result_objects, sheet_rows_wrapper`.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`) — chose Option A (restore `select` as runtime op). End-to-end Phase E now passes 7/7 steps on `gantt-urgent-tasks-v2ui` scenario.

**Problem:** D-B18 was introduced to bridge a schema change: `select` and `custom` transform types were removed from the IntentContract schema in favor of `map`. The compiler's alias (`ExecutionGraphCompiler.ts` D-B18 block) renames the type label so legacy IRs still compile. But the alias does NOT restructure the operation — and the two operations have fundamentally different semantics:

| Operation | Input semantics | Field expression semantics | Output shape |
|---|---|---|---|
| `select` | Reads from `transform.input` as a single source (object or array) | Each field's value is a reference to the **source** | ONE object containing the named fields |
| `map` | Iterates each ITEM of an array-typed `transform.input` | Each field's value is a reference to `item` (current row) or globals | An array, one element per input item |

Concretely, for the gantt scenario:

**LLM-emitted IR (intended `select` semantics):**
```json
{
  "type": "select",
  "input": "{{sheet_read_result}}",
  "fields": {
    "rows": "{{sheet_read_result.values}}",
    "row_count": "{{sheet_read_result.row_count}}",
    "range": "{{sheet_read_result.range}}"
  }
}
// expected output: { rows: [...], row_count: 58, range: "Gantt!A1:G997" }
```

**After D-B18 alias (broken `map` execution):**
```json
{
  "type": "map",  // ← only the label changed
  "input": "{{sheet_read_result_objects}}",  // ← compiler also auto-rewrote input
  "fields": {
    "rows": "{{sheet_read_result_objects}}",  // ← every field still references source-level vars
    "row_count": "{{sheet_read_result.row_count}}",
    ...
  }
}
// actual output: 57 copies of { type:"map", input:"...", fields:{...} } (the config itself)
//                because `map` runs the field-construction once per item in the input array,
//                but the field expressions don't reference `item` — they reference globals,
//                so every iteration produces the same shape.
```

The downstream filter step then does `{{sheet_rows_wrapper.rows}}` expecting the array-under-`.rows` (the singular-wrapper shape). On the array-of-57-copies shape, `.rows` is undefined.

**Why D-B18 was added:**

The IntentContract schema removed `select` (and `custom`) — presumably for grammar consolidation; both were "fold this into something else" candidates. D-B18 was the migration band-aid: relabel old IR emissions to `map` so the runtime (which only knows `map`) still accepts them. The author's intent was probably to handle the "list comprehension"-style `select` (per-item field projection), not the "object construction" `select` semantics the LLM is actually emitting. The current behavior is correct for the former interpretation and wrong for the latter.

**Three intervention points (Option A chosen, applied 2026-05-17):**

1. ✅ **Restore `select` as a runtime transform op (smallest surgery) — CHOSEN AND APPLIED.** New `case 'select'` in `StepExecutor.executeTransform()` (lines ~2471 area) builds a single output object from `effectiveConfig.fields`. Values are already resolved by `resolveAllVariables` at step entry (so the field expressions like `{{src.values}}` are post-resolution literal values by the time the case runs), so the implementation is a shallow clone: `result = { ...effectiveConfig.fields }`. The compiler's D-B18 alias was split: `select` is now preserved (no rename, `pilotOperation` stays `'select'`), `custom` still aliases to `map`. Net diff: ~12 lines runtime + alias split in compiler.

2. **Compile-time semantic translation (deferred — would be more architecturally correct).** Restructure `select` into `with_fields` or inline the wrapper into the consumer step's `transform.input`. Not pursued because Option A is sufficient for current scenarios; revisit if a future scenario surfaces a `select` shape that the runtime case can't handle.

3. **Phase 1 prompt steering (deferred).** No prompt change made. The runtime now accepts `select` natively, so there's no pressure to steer the LLM away from it. Worth a follow-up to make the formalization-system-v4 prompt document `select` semantics explicitly so the LLM emits it correctly more reliably.

**Why this wasn't caught earlier:**

- Regression scenarios use committed `phase4-pilot-dsl-steps.json` snapshots that pre-date D-B18 OR have been hand-edited; their `step.operation` and `config.type` are already `"map"` with per-item-correct `fields` definitions. Re-running them never re-exercises the alias path.
- The Phase D mock executor for `map` is permissive: it accepts the LLM's source-level field refs and resolves them once globally per the unit-of-work mocking strategy, producing data that "looks right" downstream. Real runtime iterates per-item and exposes the divergence.
- This is the first end-to-end live Phase E pass against fresh LLM-generated `select` output (Stage 1.2 of V6 ↔ V2 integration). Prior Phase E runs all used regression-scenario phase4 snapshots.
- The two operations diverged in semantics LONG before D-B18 — the alias just made the divergence invisible by removing the validation that would have caught a `select` IR at runtime.

**Compounding observation — anti-pattern: "syntactic alias for semantic redirection":**

D-B18 is shaped like a backward-compat alias (rename an old name to a new name). That works when the old and new names refer to the same underlying operation. It fails silently when the operations are different — which is exactly the case here. The same alias-mechanism is used for `deduplicate → dedupe` (lines 680-682) where the two ARE the same operation (runtime handles both), so it works. The lesson is: aliasing is only safe when the two labels are semantically equivalent. For non-equivalent labels, you need real translation logic, not a rename.

**Files (fix landed):**

- [`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) — D-B18 alias block split: `select` arm preserves the type label (just logs the preservation); `custom` arm still aliases to `map`.
- [`lib/pilot/StepExecutor.ts`](../../lib/pilot/StepExecutor.ts) — new `case 'select'` added in `executeTransform` (above `case 'map'`). Builds `{ ...effectiveConfig.fields }`; falls through to `data` passthrough when no fields object is present.

**Test coverage:**

Live Phase E on `tests/v6-regression/scenarios/gantt-urgent-tasks-v2ui/` confirmed the fix end-to-end: 7/7 steps pass, real email delivered to `meiribarak@gmail.com`. **Follow-up:** add a unit test that runs the runtime `case 'select'` against `effectiveConfig.fields = {rows: [...], row_count: 58}` and asserts the output is a single object `{rows: [...], row_count: 58}` (not an array). Track as a Stage 1 follow-up.

**Related observation — DESIGN_PRINCIPLES gap:**

This bug surfaces a new anti-pattern not yet covered by the 11 principles: **"Backwards-compat aliases must be semantic, not syntactic."** Worth adding as Principle 12 or extending Principle 11. Either way, the Evidence list for whichever principle covers this should cite WP-41.

---

### WP-40: IRFormalizer blind-guess auto-correction corrupts filter input paths

**Severity:** P0 — fires whenever the LLM emits a filter whose input variable is declared as non-array, which happens on every workflow that wraps an array inside an intermediate object (the W2/WP-17 "wrapper" pattern, very common after a `transform/map` produces `{rows, count, range, ...}`). Effect is silent data corruption masked by a "WARN: Auto-corrected" log line — the user sees "no data" or empty results despite real upstream data.
**Encountered as:** Stage 1.2c live Phase E run on V2-UI-generated `gantt-urgent-tasks` agent (`dc04876c-…`), 2026-05-17. After the WP-39 fix unblocked step3, step4 (`Transform: filter` to skip the sheet header row) failed with `Transform step step4 has no input data. Available variables: sheet_read_result, sheet_read_result_objects, sheet_rows_wrapper`. Trace: IRFormalizer's `validateIRStructure` saw `transform.input: {{sheet_rows_wrapper.rows}}`, decided `sheet_rows_wrapper` was type `"object"` (correct — step3 wraps the array), and "fixed" the path to `{{sheet_rows_wrapper.rows.attachments}}` — a field that doesn't exist anywhere in the data.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`)

**Problem:** The IR-structure validator at [`IRFormalizer.ts:1709-1843`](../../lib/agentkit/v6/semantic-plan/IRFormalizer.ts#L1709) includes an "auto-correction" branch for filter operations whose input variable is declared as non-array:

```ts
// Auto-correct: if input is object type, try to find array field to filter on
const inputVar = (node as any).inputs?.[0]?.variable
if (inputVar) {
  const varDecl = ir.execution_graph.variables?.find(v => v.name === inputVar)
  if (varDecl && varDecl.type !== 'array') {
    // Attempt auto-correction: look for common array field names
    const commonArrayFields = ['attachments', 'items', 'results', 'data', 'list', 'records']
    let corrected = false

    const inputRef = transform.input
    if (inputRef && typeof inputRef === 'string' && inputRef.startsWith('{{') && inputRef.endsWith('}}')) {
      const varName = inputRef.slice(2, -2).trim()

      // Try appending common array field names
      for (const fieldName of commonArrayFields) {
        const correctedInput = `{{${varName}.${fieldName}}}`
        transform.input = correctedInput
        corrected = true
        logger.warn({ ... }, 'Auto-corrected filter input to access nested array field')
        break // Use first match  ← misleading comment; there's no match check
      }
    }
    // ...
  }
}
```

Three compounding bugs:

1. **No actual match check.** The "Use first match" comment is aspirational — the loop ALWAYS picks `attachments`, the first field name in the list, regardless of whether the variable actually has that field. The schema is never consulted.
2. **Wrong variable inspected.** `inputVar` comes from `node.inputs[0].variable` (the bare name `sheet_rows_wrapper`); the check decides "this is type object, must be wrong" — but `transform.input` already navigates into a nested field (`{{sheet_rows_wrapper.rows}}`), so the wrapper-object type is *expected*, not erroneous.
3. **Path-compounding corruption.** When applying the "fix", the code appends to the FULL expression inside `{{...}}` (`varName = "sheet_rows_wrapper.rows"`), so the resulting path is `{{sheet_rows_wrapper.rows.attachments}}` — doubly wrong: the LLM already drilled into `.rows`, and now `.attachments` is bolted on top.

Cascading downstream:
- Runtime `ExecutionContext.resolveVariable("sheet_rows_wrapper.rows.attachments")` → `undefined` (no such field exists).
- `StepExecutor.executeTransform` throws `Transform step ${stepId} has no input data` and lists the available variables, which the user sees but can't reconcile because they wrote the right path originally.
- The actual error message they see has nothing to do with `attachments` — the corruption happened during formalization, log-buried as a `WARN`. The PILOT runtime knows nothing about the original input value.

**Compounding observation — log misleading just like WP-39:**

```
WARN: Auto-corrected filter input to access nested array field
  originalInput: "{{sheet_rows_wrapper.rows}}"
  correctedInput: "{{sheet_rows_wrapper.rows.attachments}}"
  reason: "Variable 'sheet_rows_wrapper.rows' is type 'object', not 'array'. Auto-corrected to access nested array field 'attachments'."
```

A reader looking at this log line would conclude "the validator corrected a malformed LLM output." Wrong: the validator CAUSED the malformation. Same Principle-11-violation shape as WP-39's D-B18 alias.

**Why this wasn't caught earlier:**

- Regression scenarios commit `phase4-pilot-dsl-steps.json` post-compile — the IR-level corruption never re-runs (the bad DSL is just frozen, not regenerated).
- The two scenarios that legitimately use `.attachments` (`po-monitor-supplier-confirmation`, `aliexpress-delivery-tracker`) work because the underlying email data DOES have `attachments` — so even though the "auto-correction" was the same shape, the path happened to resolve. The heuristic looked "smart" on those scenarios but was always a coincidence.
- This is the first scenario in the regression suite where `sheet_rows_wrapper` (an object-wrapper-around-rows-array) is the filter input. Stage 1.2 of the V6→V2 integration is the first end-to-end live Phase E pass where the corruption was visible in user-facing failure.

**Fix shape:**

Replace the blind-guess block with sane validation:

```ts
// Validate input variable is declared as array, unless transform.input
// accesses a nested field (in which case the LLM is being explicit
// about reaching into a wrapper object — trust it).
const inputVar = (node as any).inputs?.[0]?.variable
if (inputVar) {
  const varDecl = ir.execution_graph.variables?.find(v => v.name === inputVar)
  if (varDecl && varDecl.type !== 'array') {
    const inputRef = transform.input
    const expr = typeof inputRef === 'string' && inputRef.startsWith('{{') && inputRef.endsWith('}}')
      ? inputRef.slice(2, -2).trim()
      : null
    const accessesNestedField = expr !== null && expr.startsWith(`${inputVar}.`)
    if (!accessesNestedField) {
      errors.push(
        `Node '${nodeId}': filter operation requires array input, ` +
        `but variable '${inputVar}' is declared as type '${varDecl.type}'. ` +
        `Either change variable type to 'array', access a nested array field ` +
        `via transform.input (e.g. {{${inputVar}.some_array_field}}), ` +
        `or use a different operation type.`
      )
    }
  }
}
```

This keeps the legitimate purpose of the validator (catch filters that try to operate directly on a wrapper object) but removes the corruption mechanism. The schema-aware `autoFixFilterTransforms` (line 1846+) is unchanged — it uses skeleton `filter_hints` to make schema-informed fixes when those hints exist, which is the only legitimate auto-fix path.

**Files:**

- [`lib/agentkit/v6/semantic-plan/IRFormalizer.ts`](../../lib/agentkit/v6/semantic-plan/IRFormalizer.ts) — block at lines 1741-1782 replaced. Net delta: ~30 lines removed (the loop + commonArrayFields list + correction logic + `corrected` flag), ~12 lines added (nested-access check + error push).

**Test coverage:**

The fix is verified end-to-end by re-running the live execution on the `gantt-urgent-tasks-v2ui` regression scenario (Phase E now progresses past step4). **Follow-up:** add a unit test that runs `validateIRStructure` against a synthetic IR with `transform.type: "filter"`, `inputs[0].variable: "wrapper"`, `variables: [{name:"wrapper", type:"object"}]`, and either (a) `transform.input: "{{wrapper}}"` → asserts error pushed, or (b) `transform.input: "{{wrapper.rows}}"` → asserts NO error and `transform.input` unchanged. Track as a Stage 1 follow-up.

**Related observation — DESIGN_PRINCIPLES Principle 11 evidence:**

This is the same anti-pattern shape as WP-39: defense-in-depth heuristic that logs "I fixed it!" while silently corrupting data. Update Principle 11's Evidence list to include WP-40 alongside WP-39.

---

### WP-39: ExecutionGraphCompiler D-B18 alias updates `config.type` but not `step.operation`

**Severity:** P0 — every V6-pipeline-generated workflow emitting `transform/select` crashes at the first such step at runtime. No workaround at runtime; only the compiler fix unblocks the V6 → V2 migration.
**Encountered as:** Stage 1.2b live Phase E run on V2-UI-generated `gantt-urgent-tasks` agent (`dc04876c-ec1c-4e88-810a-7b5fe0999e09`), 2026-05-17. step3 (`Transform: select`) failed with `Unknown transform operation: select`. step1+step2 succeeded — real data was flowing. step4-step9 never ran because of the cascade abort.
**Status:** ✅ Fixed (2026-05-17, branch `feature/v6-v2-integration`)

**Problem:** The compiler at [`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) implements **D-B18 aliasing** — when the IR's `transform.type` is `"select"` or `"custom"` (both removed from the IntentContract schema in favor of WP-4 mapping), it aliases them to `"map"` so the runtime can handle them. The alias logic at lines 683-689 does:

```ts
} else if (transformConfig.type === 'select' || transformConfig.type === 'custom') {
  const originalType = transformConfig.type
  transformConfig.type = 'map'         // ← updates the IR-side config object
  transformedConfig.type = 'map'        // ← updates the DSL-side config object
  this.log(ctx, `  → D-B18: Aliased '${originalType}' → 'map' ...`)
}
```

But the compiled step's top-level `operation` field comes from a separate variable (`pilotOperation`, line 579) that flows through `finalOperation` (line 816) into `step.operation` (line 895). That variable is **never updated** by the alias block. Result:

```json
{
  "step_id": "step3",
  "type": "transform",
  "operation": "select",       ← runtime reads this — throws
  "input": "{{...}}",
  "config": {
    "type": "map",               ← alias only updated config.type
    ...
  }
}
```

At runtime, [`StepExecutor.executeTransform()`](../../lib/pilot/StepExecutor.ts) switches on `step.operation`. Its switch knows `map`, `filter`, `reduce`, `flatten`, etc. but **not** `select` — even though the codebase intentionally retired `select` at the IR layer. So the very alias logic designed to bridge the gap fails to fully bridge it.

**Compounding observation — D-B18 alias was visible in compiler logs:**

The bug was actively hidden by a misleading log message:

```
INFO:   → D-B18: Aliased 'select' → 'map' (select removed from IC schema)
```

The log SAID the alias happened, but it only happened halfway. Anyone reading the log would assume `select` → `map` was complete and look elsewhere for the failure cause. This is a V6_DESIGN_PRINCIPLES.md [Principle 11](./V6_DESIGN_PRINCIPLES.md#principle-11--defense-in-depth-must-not-hide-failures) violation — "Defense in depth must not hide failures." The defense-in-depth alias logged success while doing partial work.

Similar incomplete alias also exists for `deduplicate → dedupe` at lines 680-682 (updates both config types but not `pilotOperation`). It doesn't currently surface as a runtime failure because the runtime switch handles both `deduplicate` and `dedupe`. Still — same shape, same risk if runtime ever tightens. Worth a follow-up pass.

**Why this wasn't caught earlier:**

- The regression-scenario `phase4-pilot-dsl-steps.json` files are committed snapshots. They were produced PRE-D-B18 (or were hand-edited) and DON'T contain `operation: "select"` at the top level. So Phase D / Phase E runs of the regression scenarios never exercised this code path.
- The IRFormalizer's v4 prompt continues to emit `transform.type: "select"` for column-projection patterns (it's still the LLM's natural vocabulary for "project these fields"). The D-B18 alias was added to handle this, but its incomplete behavior was only visible when running on a LIVE LLM-generated DSL with a fresh agent — which is exactly Stage 1.2b of the V6→V2 integration.
- **This is the first time V6-pipeline-generated output has been run end-to-end via the actual V2 UI path on real data.** The regression suite uses pre-baked snapshots; the integration plan's Phase A6 test-page testing was never executed (per V6_AGENT_CREATION_INTEGRATION_PLAN.md status). So this gap was hiding until now.

**Fix shape:** one-line addition inside the alias block:

```ts
} else if (transformConfig.type === 'select' || transformConfig.type === 'custom') {
  const originalType = transformConfig.type
  transformConfig.type = 'map'
  transformedConfig.type = 'map'
  pilotOperation = 'map'          // WP-39: also update the field that ends up in step.operation
  this.log(ctx, `  → D-B18: Aliased '${originalType}' → 'map' ...`)
}
```

Since `pilotOperation` is declared with `let` (line 579), the assignment is in scope.

**Files:**

- [`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) — 1 line added at the D-B18 alias block + 5-line comment explaining the assignment chain

**Test coverage:**

No new unit test added yet — the surface area (writing a synthetic IR through the full compiler) is heavy and the fix is verified by re-running Stage 1.2b. **Follow-up:** add a regression unit test that compiles a minimal IR with `transform.type: "select"` and asserts the emitted `step.operation === "map"`. Track as Stage 1 follow-up.

**Related observation — DESIGN_PRINCIPLES gap:**

This bug strengthens [Principle 11 (Defense in depth must not hide failures)](./V6_DESIGN_PRINCIPLES.md#principle-11--defense-in-depth-must-not-hide-failures) — the D-B18 alias was meant as defense in depth for legacy IRs that still emit `select`, but its incomplete behavior actively misled debugging via a "success" log line. Update Principle 11's Evidence list to include WP-39.

---

### WP-38: Self-referential Gmail queries pick up the agent's own past confirmation emails

**Severity:** P3 — pipeline-correctness-wise nothing is broken (no fabrication, accurate "no data" output). But the unique-to-scenario logic (extraction, grouping, scatter delivery) NEVER gets exercised because the only "matching" email is the agent's own self-output from a prior run. Phase E "passes" without testing what the scenario is actually for.
**Encountered as:** Phase E on `po-monitor-supplier-confirmation` (2026-05-14). step1 (`google-mail.search_emails` with query `subject:Orders newer_than:7d`) returned 1 email — but it was the agent's OWN prior confirmation email from `orders-po-extractor-xlsx` ("Orders PO Extraction – Processing Complete"). That email has `attachments: []`, so step3 (flatten attachments) produced 0 items → cascade through with empty downstream → final email reports "no data."
**Status:** ⬜ Documented — prompt-level fix deferred (scenario-author concern, not pipeline bug)

**Problem:** Workflows that meet ALL three conditions create a self-referential feedback loop:

1. **Gmail search with a domain-keyword subject filter** (`subject:Orders`, `subject:Invoice`, `subject:PO`, etc.)
2. **Confirmation email at the end of the workflow** sent back to the same inbox the search reads
3. **The confirmation email's subject contains the keyword** (e.g., "Orders PO Extraction – Processing Complete" contains "Orders")

The next run's search matches the prior confirmation. The cascade processes the confirmation as if it were a real domain event, finds no attachments, sends another confirmation. The agent keeps confirming confirmations.

**Concrete cascade (po-monitor-supplier-confirmation, 2026-05-14):**

```
Prior run's confirmation email lands in inbox:
  Subject: "Orders PO Extraction – Processing Complete"
  Body: "Total vendors processed: 0. Total line-item rows extracted: 0..."
  Attachments: []

Current run:
  step1 search_emails(query="subject:Orders newer_than:7d") → 1 email (the prior confirmation)
  step2 filter has-attachments → 1 (passed through; possibly redundant filter bug — see below)
  step3 flatten attachments → 0
  step4 filter mime types → 0
  step5-11 (scatter over attachments) → all empty
  step12-15 (compose + send confirmation) → "no data" email delivered
```

Pipeline reports `success: true`, user receives accurate "no data" notification. But step5's scatter body (extraction, AI processing, reply-in-thread) — **the entire reason this scenario exists** — never ran on real data.

**Affected scenarios:**

- `orders-po-extractor-xlsx` — subject filter `Orders`, confirmation subject contains "Orders"
- `po-monitor-supplier-confirmation` — subject filter `Orders`, confirmation subject contains "Orders"
- Potentially any future scenario where the LLM emits both surface patterns

**Side observation — possible step2 filter inconsistency:**

In the canonical failure, step2 was described as "Keep only emails that have at least one attachment" but kept the email despite `attachments: []`. The filter's actual condition may check a different field (e.g., a `has_attachments` boolean from Gmail metadata) instead of `attachments.length > 0`. This is **defense-in-depth that didn't fire** — the workflow still produced the correct downstream "no data" because step3 (flatten) handled empty attachments cleanly. Worth investigating separately, but secondary to the self-referential query issue.

**Fix shape — prompt-level, not code**

The LLM's IntentContract emission needs to be steered toward queries that exclude the agent's own emails. Three options ranked by likely impact:

1. **Phase 1 prompt addition:** in the section that explains how to compose Gmail search queries, add a rule: *"Always exclude self-sent emails for inbox-monitor scenarios. Default to `-from:me` (or `-from:<current_user_email>` if available)."* This is the broadest fix.

2. **Confirmation-email subject change:** the LLM should be steered away from putting the domain keyword in the confirmation subject. E.g., "Orders PO Extraction – Processing Complete" should be "Daily PO Summary" or "Workflow Completed" — without "Orders" in the subject. The trade-off: less informative confirmation subjects.

3. **Per-scenario `enhanced-prompt.json` hint:** for affected scenarios, add a user-facing prompt hint like *"exclude self-sent emails when monitoring inbox for orders."* Most surgical, but per-scenario maintenance burden.

Recommended: option 1. The Phase 1 prompt is the natural place to encode "the agent should not read its own emails" — it's a general workflow design principle, not scenario-specific.

**Why this isn't a code bug:**

Every layer of the pipeline did the right thing:
- Gmail returned what the query asked for
- The flatten transform correctly handled empty attachments
- WP-13's no-fabrication guard fired (final email accurately reports "no data")
- The conditional reply-in-thread step correctly skipped (no supplier_email to reply to)

The failure is *semantic* — the workflow correctly produced an accurate report, but the report wasn't meaningful because the input was the agent's own past output.

**Why "documented but deferred":**

Fixing this requires Phase 1 prompt engineering and regen sweeps to validate the new query patterns across all 10 scenarios. That's a larger change than the runtime tolerance fixes we've been making. For now: document, accept that affected scenarios won't validate their unique extraction logic in Phase E without manual prompt fixes, and revisit when there's appetite for a Phase 1 prompt iteration.

**Workarounds for re-running affected scenarios:**

- Delete the agent's prior confirmation emails from the test inbox before re-running, OR
- Manually edit the phase4 search query to `subject:Orders newer_than:7d -from:me`, OR
- Send yourself a test email with the right shape (real PO subject, real XLSX attachment) and a confirmation-subject that doesn't contain "Orders."

**Cross-references:**

- [PD-1](#pd-1-realistic-plugin-mock-payloads-high-value) — Phase D realism gap. WP-38 is the Phase E parallel: Phase E uses real data but the "real" data is contaminated by prior agent runs.
- [PD-3](#pd-3-token-budget-warnings) — same family; both are "Phase E doesn't tell you when your test is meaningless."

---

### WP-37: `transformWithFields` rejects undefined expressions when `resolveAllVariables` pre-substituted an unresolvable template

**Severity:** P1 — scatter-gather aborts with "all N items failed" when any `with_fields` field references a path that doesn't resolve in the current scatter context. Cascades to no email / no downstream action.
**Encountered as:** Phase D on `po-monitor-supplier-confirmation` (2026-05-14). step8 (`transform/with_fields` building a normalized PO row) failed all 9 scatter items with `with_fields: invalid field declaration (expected {name, expression}): {"name":"thread_id"}`. The phase4 file has the correct `expression: "{{attachment_item.thread_id}}"` on disk.
**Status:** ⬜ Documented — fix to follow

**Problem:** Three-layer cascade of pre-existing components combining into a new failure mode.

#### Layer 1 — Phase4 stores template-string expression (WP-33 case)

The LLM emits a `with_fields` field as:

```json
{
  "name": "thread_id",
  "expression": "{{attachment_item.thread_id}}"
}
```

WP-33 added IR converter normalization to convert this to `{kind: "ref", ref: "item", field: "thread_id"}` at compile time, AND added runtime tolerance in `evaluateExpression`. But the IR converter normalization only fires on FRESH compiles — when the LLM emits this shape in a regen sweep, the converter rewrites it. For phase4 files compiled BEFORE that converter change (or for paths the converter doesn't traverse), the template-string survives into the saved DSL.

#### Layer 2 — `resolveAllVariables` pre-substitutes the template

[`ExecutionContext.resolveAllVariables`](../../lib/pilot/ExecutionContext.ts) recursively walks the step config before the transform runs:

```ts
if (typeof obj === 'string') {
  if (obj.match(/^\{\{.*\}\}$/)) {
    return this.resolveVariable(obj);   // ← returns undefined when path unresolvable
  }
  // ...
}
```

For `expression: "{{attachment_item.thread_id}}"`, it calls `resolveVariable`. The scatter's itemVariable is `attachment_item`, but the attachment item's actual data (post-step2 flatten) doesn't have `thread_id` directly — Gmail's `attachments` schema is `{filename, mimeType, size, attachment_id, message_id}`. The thread_id lives on the parent email, not the attachment. So `resolveVariable` returns `undefined`.

The whole-template branch writes `undefined` back to `field.expression`. `field` is now `{name: "thread_id", expression: undefined}`.

#### Layer 3 — `transformWithFields`'s `!field.expression` guard fires before WP-33 tolerance

[`StructuredTransforms.ts:97-102`](../../lib/pilot/transforms/StructuredTransforms.ts#L97):

```ts
for (const field of fields) {
  if (typeof field?.name !== 'string' || !field.expression) {
    throw new StructuredTransformError(
      `with_fields: invalid field declaration (expected {name, expression}): ${JSON.stringify(field)}`,
      'INVALID_CONFIG'
    );
  }
  augmented[field.name] = evaluateExpression(field.expression, item, context, evaluator);
}
```

`!undefined` is true → throws. WP-33's tolerance in `evaluateExpression` (which handles strings via `normalizeStringExpression`) is never reached because the guard short-circuits first.

`JSON.stringify({name: "thread_id", expression: undefined})` returns `{"name":"thread_id"}` — exactly the error message we saw.

#### Trigger scenarios

Any `transform/with_fields` step where the LLM:
1. Emits a template-string expression (instead of structured AST), AND
2. References a path that's unresolvable in the current scope.

Most common cause for (2): the per-item-nested flatten (WP-32) doesn't propagate parent metadata into the flattened items, so refs to parent fields fail. `po-monitor-supplier-confirmation` is the first scenario to combine both patterns:
- step2 flattens attachments per email (per-item-nested, WP-32)
- step8 with_fields tries to add `thread_id` from parent → unresolvable
- step9-10 then need `thread_id` to reply in-thread

#### Fix shape — runtime tolerance in `transformWithFields`

Mirror WP-33's "be liberal at runtime" philosophy. When `field.expression` is `undefined` (post-mangling), treat it as `{kind: "literal", value: undefined}`. The augmented row gets `field.name: undefined` — same semantic as the user explicitly writing a literal undefined.

```ts
for (const field of fields) {
  if (typeof field?.name !== 'string') {
    throw new StructuredTransformError(
      `with_fields: invalid field declaration (expected {name}): ${JSON.stringify(field)}`,
      'INVALID_CONFIG'
    );
  }
  // WP-37: tolerate `expression: undefined` (post-resolveAllVariables mangling
  // of a template that resolved to undefined). The output field gets undefined
  // value, matching what would happen if the user had written {kind: "literal",
  // value: undefined}. Surfaces the missing-data downstream rather than crashing
  // the whole scatter.
  if (field.expression === undefined) {
    augmented[field.name] = undefined;
    continue;
  }
  augmented[field.name] = evaluateExpression(field.expression, item, context, evaluator);
}
```

Note: keep the `name` check separate — a field with no name is genuinely invalid. Only `expression === undefined` gets the new tolerance.

**Why not also `null` or `''`?** A user could legitimately write `expression: {kind: "literal", value: ""}` — that's a non-empty expression object. The `expression === undefined` check is specifically targeting the resolveAllVariables-mangling case. `null` would be similar to undefined; we could add it too but undefined is the observed shape.

**Why this is safe:** the LLM's intent was "compute this field from a path." If the path doesn't resolve, the field is missing. Returning `undefined` in the augmented row preserves that — downstream sees the field is missing and can branch accordingly (e.g., step9's conditional check for `has_supplier_email` will correctly flag the row as needing review).

#### Long-term consideration

The deeper issue is that `resolveAllVariables` pre-substitutes template strings in places where the runtime evaluator should handle resolution. WP-33's IR converter normalization eliminates this for fresh regens (structured AST never gets pre-substituted), but cached/legacy phase4 files still have raw template strings. Two follow-ons worth considering (deferred):

- **A.** Make `resolveAllVariables` configurable to skip specific paths (e.g., `with_fields.fields[].expression`). Surgical exception that introduces a path-aware filter.
- **B.** One-time migration sweep over all committed phase4 snapshots to convert template-string expressions to structured AST, eliminating the legacy case.

Both deferred. Runtime tolerance in `transformWithFields` is sufficient for this scenario and any future legacy-file replays.

**Files:**

- `lib/pilot/transforms/StructuredTransforms.ts` (~5 lines: rework the guard + add undefined-tolerance branch)
- `lib/pilot/__tests__/StructuredTransforms.wp37.test.ts` (new — undefined expression, regression for invalid-name cases, end-to-end with_fields call with mixed valid/undefined fields)

**Test coverage to add:**

1. ✅ `transformWithFields` with `field.expression === undefined` produces row with `field.name: undefined` (no throw)
2. ✅ `transformWithFields` with `field.expression === undefined` AND other fields present — other fields evaluate correctly
3. ✅ Regression: `field.name` missing still throws
4. ✅ Regression: structured AST `{kind, ...}` still evaluates correctly
5. ✅ Regression: literal value `0`, `""`, `false` still evaluate correctly (they're not undefined)
6. ✅ End-to-end: canonical po-monitor pattern — scatter-item missing `thread_id`, with_fields produces row with `thread_id: undefined` instead of throwing

**Why this wasn't caught earlier:**

- WP-33's tolerance in `evaluateExpression` looked complete because the test stubs called `evaluateExpression` directly with various input shapes. The test suite never went through `transformWithFields`'s upstream guard with a `field.expression = undefined` input.
- Earlier scenarios didn't trigger because their `with_fields` expressions referenced paths that DID resolve in the mock data, OR they used structured AST (post-W3-prompt-update regens).
- po-monitor is the first scenario to combine: (a) per-item-nested flatten without parent propagation, (b) downstream `with_fields` referencing parent fields, (c) template-string emission style.

#### Compounding observation

WP-37 is the fifth runtime-tolerance fix in the "convention-mismatch" family (WP-22 / WP-30 / WP-32 / WP-33 / WP-37). The pattern keeps recurring: the LLM emits a syntactically valid form that's slightly off the strict runtime contract, and some layer of pre-processing fails ungracefully. Each fix is one-line surgical, but the cumulative pattern suggests the runtime contract is too strict for what the LLM actually emits. **Long-term:** consider auditing all `transform/*` runtime guards for similar "throws on shape mismatch" patterns vs "tolerates and continues" patterns — the latter is more aligned with how the LLM behaves.

---

### WP-36: Phase D stub generator emits generic `mock_name_NNN` that fails keyword filters

**Severity:** P2 — Phase D false-positive failures for scenarios using content-keyword filters on document/file names. Doesn't affect runtime; only the Phase D gate.
**Encountered as:** Phase D on `contract-enddate-summary` (2026-05-14). step3 (`transform/filter` with `field: "item.name"`, `operator: "contains_any"`, `value: ["Contract", "Agreement", "MSA", "SOW", "Order Form", "Statement of Work"]`) dropped all 3 mocked items because they were named `mock_name_001/002/003`. step3 fed step4 (scatter_gather) and `on_empty: "throw"` correctly aborted.
**Status:** ⬜ Documented — fix to follow

**Problem:** The Phase D stub generator's `name` field generator is the generic catch-all branch at [`stub-data-generator.ts:210`](../../scripts/test-dsl-execution-simulator/stub-data-generator.ts#L210):

```ts
// Generic string
return `mock_${fieldName}_${idx}`
```

For the `name` field this produces `mock_name_001`, `mock_name_002`, `mock_name_003`. These strings don't match any natural-language keyword the LLM would emit in a `contains_any` filter — so any keyword filter on `name` drops everything.

**Why this is a Phase D realism gap, not a runtime bug:**

- The pipeline's `on_empty: "throw"` guard fired *correctly* — feeding a scatter-gather an empty array is a real bug in production data flows, so the safety check is by design. We don't weaken it.
- Real `google-drive.list_files` output would contain real file names like `"MSA - Acme 2026"`, `"Vendor Service Agreement.docx"`, etc., which would match the filter.
- Only the Phase D mocks produce the all-generic shape that fails.

**Failure shape (contract-enddate-summary):**

```
step2 google-drive.list_files (mock) → 3 files: [mock_name_001, mock_name_002, mock_name_003]
step3 transform/filter contains_any ["Contract", "Agreement", "MSA", "SOW", "Order Form", "Statement of Work"]
        → 0 results from 3 input items
        → on_empty: throw (feeds scatter_gather at step4)
        → Aborting
```

**Trigger scenarios:**

Any scenario where:
1. A list/search action returns items with a generic `name` field, AND
2. A downstream filter checks for content-specific substrings in that name, AND
3. The filter result feeds a scatter_gather (or any step with `on_empty: throw`).

`contract-enddate-summary` is the first scenario in the regression suite that hits all three. Earlier scenarios filtered on enum fields (`labels`, `urgency`, `priority`) or compared against config refs — those happen to align with generic mock outputs.

**Fix shape — document-name bank**

Replace the generic fallback for the `name` field with a small bank of realistic document-style names that include common business-document keywords. Cycle through the bank by index suffix so each item gets a different name across an array.

```ts
const DOCUMENT_NAME_BANK = [
  "Contract Acme Corp 2026",          // Contract
  "MSA TechStart Inc",                // MSA
  "SOW Q3 Statement of Work",         // SOW, Statement of Work
  "Service Agreement Vendor 042",     // Agreement, Vendor
  "Order Form Q1 Renewal",            // Order Form
  "Invoice Acme 0142",                // Invoice
];

function generateName(opts: GeneratorOptions): string {
  const idx = parseInt(opts.indexSuffix || '001', 10);
  return DOCUMENT_NAME_BANK[(idx - 1) % DOCUMENT_NAME_BANK.length];
}
```

In the `generateStringByFieldName` switch, add a `name` case before the generic fallback that returns from the bank.

**Why a bank and not random Lorem-ipsum:** the bank is deterministic per index, so Phase D output is reproducible. The chosen names cover the common substring filter keywords for business-document scenarios (contract, agreement, MSA, SOW, order form, statement of work, invoice, vendor) without scenario-specific tuning.

**Trade-off accepted:** the bank is opinionated. If a future scenario filters on `name contains "Widget"`, Phase D will still fail because the bank doesn't include "Widget." That's a known limitation — the bank handles common business-doc terminology, not arbitrary content. Document this in the bank's comment.

**Why not extend to `subject`, `title`, etc.:** they already have realistic generators ([line 181](../../scripts/test-dsl-execution-simulator/stub-data-generator.ts#L181): `subject` returns `"Invoice #INV-${idx} from Acme Corp"`). Only `name` falls through to the generic fallback. If future scenarios surface gaps elsewhere, extend similarly per field.

**Files:**

- `scripts/test-dsl-execution-simulator/stub-data-generator.ts` (~15 lines: bank constant + `name` case in switch)
- `scripts/test-dsl-execution-simulator/__tests__/stub-data-generator.wp36.test.ts` (new — bank cycling, index-stable, regression for other fields)

**Test coverage to add:**

1. ✅ `name` field at indexSuffix `001` returns first bank entry
2. ✅ `name` field cycles through bank by indexSuffix
3. ✅ `name` field wraps when array longer than bank
4. ✅ Bank entries collectively cover canonical filter keywords (Contract, Agreement, MSA, SOW, Order Form, Statement of Work)
5. ✅ Regression: other string fields (`filename`, `subject`, `vendor`) still use their specific generators
6. ✅ Regression: non-`name` generic fields still use `mock_${fieldName}_${idx}`

**Why this wasn't caught earlier:**

PD-1 in the existing Phase D Hardening Roadmap section flagged "Realistic plugin mocks" as a known gap but never had a concrete reproducer in the regression suite. Contract-enddate-summary is the first scenario where the gap converts to a hard test failure (not just imprecise mocks).

**Compounding observation:**

WP-36 sits in the same conceptual family as WP-35 (Phase A array-index syntax not supported), WP-32 (validator over-corrects valid LLM emission), and WP-13 (silent fabrication on empty input) — all are "test infrastructure / safety checks don't model the runtime accurately." The recurring lesson: **whenever a Phase D / Phase A check fails on data the runtime would handle, fix the test-infrastructure side, not the runtime.**

---

### WP-35: Phase A simulator doesn't understand array-index syntax in template refs

**Severity:** P2 — false-positive Phase A failures on any scenario emitting `{{var.field[N].subfield}}`. Doesn't affect runtime correctness; only the Phase A gate.
**Encountered as:** Phase A on `contract-enddate-summary` (2026-05-14). 2/14 checks failed at step2 with `unresolved_ref` + `cross_step_field_ref` errors on `{{contracts_folder_results.files[0].id}}`. Same scenario, same step, same path documented as a known false positive 2026-04-10 — never fixed at source.
**Status:** ⬜ Documented — fix to follow

**Problem:** The Phase A DSL execution simulator at [`scripts/test-dsl-execution-simulator/`](../../scripts/test-dsl-execution-simulator) ships its own simplified path-resolution logic, which doesn't recognize the `field[N]` array-index syntax used in `{{...}}` templates.

#### Surface 1 — `VariableStore._lookupRef` (variable resolution)

[`variable-store.ts:131-162`](../../scripts/test-dsl-execution-simulator/variable-store.ts#L131):

```ts
private _lookupRef(ref: string): any {
  const parts = ref.split('.')
  // ...
  if (this.stepOutputs.has(parts[0])) {
    let value = this.stepOutputs.get(parts[0])
    for (let i = 1; i < parts.length; i++) {
      if (value === null || value === undefined) return undefined
      value = value[parts[i]]                       // ← literal property lookup
    }
    return value
  }
  return undefined
}
```

For `{{contracts_folder_results.files[0].id}}`:
- `parts = ["contracts_folder_results", "files[0]", "id"]`
- Step 1: `value = stepOutputs.get("contracts_folder_results")` (the stub object)
- Step 2: `value = value["files[0]"]` → `undefined` (literal `"files[0]"` is not a property name — the object has `files` as an array)
- Returns `undefined` → caller marks ref as unresolved

#### Surface 2 — `Validator.checkCrossStepFieldRefs` (schema validation)

[`validator.ts:322-356`](../../scripts/test-dsl-execution-simulator/validator.ts#L322):

```ts
for (const ref of allRefs) {
  const parts = ref.split('.')
  if (parts.length < 2) continue
  if (['config', 'input', 'inputs'].includes(parts[0])) continue
  const varName = parts[0]
  const fieldName = parts[1]                        // ← "files[0]" as literal field name
  // ...
  const knownFields = extractFieldNames(schema)
  if (knownFields.length > 0 && !knownFields.includes(fieldName)) {
    issues.push({
      severity: 'error',
      check: 'cross_step_field_ref',
      step_id: step.step_id,
      message: `Field "${fieldName}" does not exist in "${varName}" output_schema. Known fields: [${knownFields.join(', ')}]`,
    })
  }
}
```

Same problem — `fieldName = "files[0]"` checked against `["files", "file_count", ...]`. Fails.

#### Runtime does this correctly

[`ExecutionContext.resolveVariable`](../../lib/pilot/ExecutionContext.ts) and the production path-resolver understand `field[N]` syntax — they parse the segment, look up the property name, expect an array, index into it. So at Phase D / Phase E the workflow runs fine. **Only the simulator is strict.**

#### Concrete failure shape (contract-enddate-summary, 2026-05-14)

```
"validation": {
  "issues": [
    {
      "severity": "error",
      "check": "unresolved_ref",
      "step_id": "step2",
      "message": "Unresolved variable reference: {{contracts_folder_results.files[0].id}}"
    },
    {
      "severity": "error",
      "check": "cross_step_field_ref",
      "step_id": "step2",
      "message": "Field \"files[0]\" does not exist in \"contracts_folder_results\" output_schema. Known fields: [files, file_count, search_query, next_page_token, has_more, searched_at, message]"
    }
  ],
  "checks_passed": 12,
  "checks_failed": 2,
  "total_checks": 14
}
```

#### Trigger scenarios

Any scenario where the LLM extracts the Nth element from an array via template syntax:
- "First folder match from a search" → `{{search.files[0].id}}`
- "Use the first email's id" → `{{search_emails.emails[0].id}}`
- Any wrapper-with-array → first-element pattern

This is a natural LLM emission because:
- The grammar's structured `transform/project_column` requires emitting a whole separate step just to extract one element
- `{{}}` syntax is widely used elsewhere for sub-field navigation
- The runtime correctly handles it, so the pattern is "officially supported" in practice

#### Fix shape — surgical, one helper + two call-site updates

Add a shared helper that parses each path segment for the `<name>[<index>]` pattern, then use it from both surfaces.

**A. New helper in `variable-store.ts`:**

```ts
/**
 * Parse a single path segment for array-index syntax.
 * "files[0]"   → { name: "files", index: 0 }
 * "items"      → { name: "items", index: null }
 * "items[10]"  → { name: "items", index: 10 }
 */
function parsePathSegment(segment: string): { name: string; index: number | null } {
  const m = segment.match(/^([^[\]]+)\[(\d+)\]$/);
  if (m) return { name: m[1], index: parseInt(m[2], 10) };
  return { name: segment, index: null };
}
```

**B. Fix `_lookupRef`:**

```ts
for (let i = 1; i < parts.length; i++) {
  if (value === null || value === undefined) return undefined;
  const { name, index } = parsePathSegment(parts[i]);
  value = value[name];
  if (index !== null) {
    if (!Array.isArray(value)) return undefined;
    value = value[index];
  }
}
```

**C. Fix `checkCrossStepFieldRefs`:**

Strip the `[N]` suffix from each segment before checking against `knownFields`. When the schema field is an array and the next path segment exists, descend into `items.properties` for the next validation step.

```ts
const { name: fieldName } = parsePathSegment(parts[1]);  // "files[0]" → "files"
// ... existing check against knownFields ...
// Optional enhancement: if parts.length > 2 and schema.properties[fieldName].type === 'array',
// validate parts[2] against schema.properties[fieldName].items.properties
```

**Files:**

- `scripts/test-dsl-execution-simulator/variable-store.ts` (~15 lines: helper + `_lookupRef` fix)
- `scripts/test-dsl-execution-simulator/validator.ts` (~10 lines: import helper + strip in `checkCrossStepFieldRefs`)
- New unit tests covering `field[0]`, `field[10]`, multi-segment dotted-and-indexed paths, regression for non-indexed paths

**Test coverage to add:**

1. ✅ `_lookupRef` resolves `var.field[0].subfield` correctly when stub has `{field: [{subfield: "X"}]}`
2. ✅ `_lookupRef` returns undefined when index is out of bounds
3. ✅ `_lookupRef` returns undefined when field exists but isn't an array
4. ✅ `_lookupRef` regression: non-indexed paths still work
5. ✅ `checkCrossStepFieldRefs` accepts `field[0]` when schema has `field` as an array
6. ✅ `checkCrossStepFieldRefs` still errors when the base name doesn't exist (`bogus[0]`)
7. ✅ End-to-end: contract-enddate-summary's `{{contracts_folder_results.files[0].id}}` Phase A passes

**Why this wasn't caught earlier:**

- The pattern was documented as a known false positive on 2026-04-10 and tolerated via `verification_status` annotations. The verification_status block was removed in a working-tree edit just before the WP-32/33 commit, exposing the failure as a hard Phase A error in the regression runner.
- Most scenarios in the regression suite don't use `{{var.field[N].subfield}}` syntax — they either iterate via scatter_gather or extract single elements via `transform/project_column`. `contract-enddate-summary` is one of the few that picks the first folder from a search result inline.

**Compounding observation:**

This is the simulator-side equivalent of the recurring "runtime is lenient, validator is strict" mismatch we've seen in WP-22 (set_difference bare RefName), WP-30 (config bare path), WP-32 (flatten field validator), WP-33 (with_fields expression). The recurring lesson: **whenever the runtime accepts a more permissive form than the validator, the validator must be brought up to parity, not the other way around** — because the runtime is what users actually depend on.

---

### WP-34: `DeterministicExtractor` swallows PDF-parse exceptions and document-extractor silently fabricates "Unknown" defaults

**Severity:** P1 — silent data corruption. User receives an email with fabricated content that looks legitimate (vendor, type, etc. are stringified placeholders, not real extraction failures). WP-13 family ("LLM/extractor fabricates plausible-looking data when input is empty/broken").
**Encountered as:** Phase E on `vocabulary-pipeline` (2026-05-13, after WP-32 + WP-33 fixes landed). The full cascade ran end-to-end, an email was delivered, but every extracted field came through as `"Unknown <FieldName>"` — the document-extractor's missing-required-field default — and the user assumed real extraction had succeeded.
**Status:** ⬜ Documented — fix deferred (multi-component change)

**Problem:** Three coordinated failures combine into a silent-success cascade.

#### Layer 1 — `DeterministicExtractor.extract()` swallows exceptions

[`DeterministicExtractor.ts:69-251`](../../lib/extraction/DeterministicExtractor.ts#L69) wraps the entire extraction flow in a single `try/catch`. On ANY thrown exception (including PDF parsing failures from `pdfDetector.detect()` for image-based PDFs without a text layer), the catch returns:

```ts
return this.createFailureResult(error.message, startTime, config.outputSchema);
```

[`createFailureResult` at line 561-581](../../lib/extraction/DeterministicExtractor.ts#L561) hard-codes:

```ts
return {
  success: false,
  data: {},
  confidence: 0,
  metadata: {
    extractionMethod: 'text',           // ← misleading; says "text" when actually a failure path
    fieldsExtracted: 0,
    missingFields: outputSchema?.fields.map(f => f.name) || [],
    ...
  },
  errors: [error],
};
```

The error is logged but never re-thrown. From the workflow's perspective, the extractor "succeeded" (no exception bubbled up) — just produced an empty result with `success: false` quietly set in the metadata.

**Observed runtime evidence (vocabulary-pipeline, 2026-05-13):**

```json
"_extraction_metadata": {
  "confidence": 0,
  "method": "text",                  // ← failure path (createFailureResult)
  "processing_time_ms": 46,          // ← too fast to have called Textract (which is ~1-3s)
  "success": false,
  "missing_fields": ["type","vendor","date","amount","invoice_receipt_number","category"]
}
```

#### Layer 2 — AWS Textract fallback unavailable in dev

Even if the exception hadn't swallowed, image-based PDFs need OCR. [`TextractClient.ts:19-29`](../../lib/extraction/TextractClient.ts#L19) requires three env vars:

```ts
this.awsConfigured = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_REGION
);
```

Not set in dev → `analyzeDocument()` returns `{text: '', keyValuePairs: [], tables: []}`. The extractor's downstream `text+llm` fallback path runs but has nothing to work with (PDF text was already empty/garbage). Even though `VisionContentBuilder.ts` was restored in AUDIT-1 (2026-05-10), it's **not wired into `DeterministicExtractor`** — vision is never attempted as a fallback for failed text extraction.

#### Layer 3 — `document-extractor` plugin fabricates "Unknown" defaults

[`document-extractor-plugin-executor.ts:145-152`](../../lib/server/document-extractor-plugin-executor.ts#L145):

```ts
for (const fieldDef of outputSchema.fields) {
  if (fieldDef.required && (extractedData[fieldDef.name] === null || extractedData[fieldDef.name] === undefined || extractedData[fieldDef.name] === '')) {
    const fieldName = fieldDef.name;
    extractedData[fieldDef.name] = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
    this.logger.info({ field: fieldDef.name, fallback: extractedData[fieldDef.name] }, 'Applied fallback for missing required field');
  }
}
```

The rationale (per the comment): "prevent downstream 'field is required' errors when extraction fails." But the cure is worse than the disease — instead of a clear failure, downstream consumers receive `"Unknown Type"`, `"Unknown Vendor"`, etc. as if they were real extracted values. The AI generator at step14 dutifully renders an email body containing those Unknown values, and the user can't distinguish "extractor failed" from "the PDF actually said 'Unknown Vendor'".

#### Compound cascade (vocabulary-pipeline, 2026-05-13)

```
step1 ✅ search emails → 1 email with PDF attachment
step2 ✅ flatten attachments (WP-32 fix) → 1 attachment
step3 ✅ filter PDFs → 1
step4 ▶ scatter
  step5 ✅ download PDF (33KB) — Gmail extracted_text stub set as side effect
  step6 ❌ document-extractor:
    └─ DeterministicExtractor.extract():
        └─ pdfDetector.detect() throws on image-PDF (no text layer)
        └─ catch block → createFailureResult({}, [...all fields missing], method: "text")
    └─ Plugin applies "Unknown <Field>" defaults for required fields (type, vendor)
    └─ Returns {type: "Unknown Type", vendor: "Unknown Vendor", _extraction_metadata: {success: false, confidence: 0, ...}}
  step7 ✅ get_or_create_folder("Unknown Vendor") — creates a "Unknown Vendor" Drive folder! ❌
  step8 ✅ upload_file → puts PDF in the wrong folder
  step9 ✅ with_fields (WP-33 fix) builds digest_row with fabricated values
step10 conditional `digest_row.amount > threshold`:
  └─ amount is undefined (not a required field, no fallback applied) → fails `exists` check
  └─ else branch (no Sheets append)
step14 ✅ ai_processing generates email body with "Unknown" content
step15 ✅ send_email delivers fabricated digest to user
```

**Net result:** workflow reports success, email delivered, Drive has an "Unknown Vendor" folder containing the original PDF, and the user has zero indication that nothing was actually extracted.

#### Secondary cosmetic — Gmail PDF text-extraction stub

[`gmail-plugin-executor.ts:271-275`](../../lib/server/gmail-plugin-executor.ts#L271):

```ts
} else if (mimeType === 'application/pdf') {
  // PDF text extraction would require additional library
  // For now, indicate it's not extracted
  result.extracted_text = '(PDF text extraction not yet implemented)';
}
```

This 2026-02 stub mis-labels every PDF attachment as having no text. It's actually harmless because `document-extractor` ignores `extracted_text` and works off the base64 `data` field. But:

- Any future consumer that reads `extracted_text` (e.g. a simpler AI step asking "summarize this attachment") will receive the literal stub string instead of either real text or a clear null.
- The stub propagates through to debug logs, scatter contexts, and final outputs as visible noise.

Cosmetic but worth removing alongside the main fix.

#### Trigger scenarios

- Any image-based PDF (scanned receipts, photographed invoices, screenshots-as-PDFs)
- Any vector PDF that doesn't parse cleanly with pdfjs-dist
- Any workflow using `document-extractor.extract_structured_data` in dev (no AWS) for non-text-layer PDFs
- Specifically: `expense-invoice-email-scanner`, `vocabulary-pipeline`, `orders-po-extractor-xlsx`, and any future scenarios involving receipt/invoice extraction

#### Fix shape (deferred — multi-component change)

This isn't a single-line tolerance fix. The right fix spans multiple files and design decisions:

**A. Surface real failures instead of swallowing them.** `DeterministicExtractor.extract()` should let exceptions propagate up (or set a distinct error indicator). The plugin executor should detect `success: false && confidence: 0 && missingFields.length === fields.length` and decide whether to fail loudly, signal `_extraction_metadata.success: false` more prominently, or omit the fabricated-defaults entirely.

**B. Stop fabricating "Unknown <Field>" defaults at the plugin layer.** Either:
- Return real `null` for missing required fields and rely on downstream code to handle null (most explicit), OR
- Set the fallback value to a distinct sentinel like `__EXTRACTION_FAILED__` so downstream conditionals can branch on it, OR
- Surface the failure as a workflow-level error (`success: false` in step output, halt the scatter item) when ALL required fields are missing.

**C. Wire vision/LLM fallback into `DeterministicExtractor`.** AUDIT-1 (2026-05-10) restored `VisionContentBuilder.ts` (452 lines) but it's not invoked from the extractor. Add a path: when text-based extraction yields 0 fields AND Textract is unavailable/empty, send the PDF as image to GPT-4V or Claude Vision via the AI provider factory. The plugin's `use_ai` parameter is already declared but not wired — this is the natural place.

**D. Remove the Gmail PDF stub.** [`gmail-plugin-executor.ts:271-275`](../../lib/server/gmail-plugin-executor.ts#L271): either remove the `extracted_text` field for PDFs entirely (let downstream do extraction), or wire it to actually call pdfjs-dist / document-extractor's text path. Cosmetic but ought to go alongside the main fix.

**E. Add Phase D mock for failure cases.** Phase D doesn't currently simulate "extractor returns 0 fields → applies Unknown defaults → workflow continues with bad data." This blind spot is what allowed this bug to ship undetected.

#### Why this wasn't caught earlier

- Phase D plugin mocks return clean structured data (`{type: "Invoice", vendor: "Acme", ...}`), never the failure-with-defaults shape. The cascade looks correct in mock.
- Phase A static checks have no way to know the extractor will fail on image PDFs at runtime — it depends on the actual PDF content.
- Live runs through this scenario before WP-32/WP-33 fixes failed earlier in the pipeline (empty attachments / scatter crash), so the extraction-failure path never got tested.
- Once WP-32 + WP-33 unblocked the cascade, the bug surfaced immediately. **This is the first scenario in the regression suite where the extractor was actually hit with a real image-based PDF in a working pipeline.**

#### Compounding observation

WP-13 / WP-32 / WP-34 are all variants of "the system prefers to produce wrong-but-syntactically-valid output rather than fail loudly." The compiler validator over-correcting (WP-32), the AI fabricating tables on empty input (WP-13), and the extractor fabricating "Unknown <Field>" on failure (WP-34) all share the same root philosophy. Each one was added with good intent (don't crash workflows mid-execution) but compounds into the bigger systemic issue: **users can't tell when the system failed.**

Long-term: each fabrication site needs a clear signal-the-failure path. The "fail loudly OR clearly indicate failure to downstream" principle should override "don't crash."

**Files (for future fix):**

- `lib/extraction/DeterministicExtractor.ts` (~20 lines: exception handling + add vision-fallback hook)
- `lib/server/document-extractor-plugin-executor.ts` (~10 lines: remove or guard "Unknown <Field>" defaults; wire `use_ai` to vision path)
- `lib/server/gmail-plugin-executor.ts` (~5 lines: remove PDF stub)
- `lib/pilot/utils/VisionContentBuilder.ts` (already exists; wire into extractor)
- New unit tests covering: failure path returns clear error, vision fallback fires for image PDFs, no Unknown defaults applied when all required fields fail
- Phase D mock for `extract_structured_data` to optionally return failure shape

---

### WP-33: `with_fields.expression` accepts template strings but `evaluateExpression` requires structured form

**Severity:** P1 — scatter item fails, parent scatter fails as "all items failed", notify never runs → user receives no email at all.
**Encountered as:** Phase E on `vocabulary-pipeline` (2026-05-13, after WP-32 fix landed). step9 (`transform/with_fields` building a digest table row) failed with `evaluateExpression: invalid expression (must be {kind, ...}): "https://drive.google.com/..."`.
**Status:** ⬜ Documented — fix to follow

**Problem:** The W2 grammar requires `with_fields.fields[].expression` to be a structured `{kind: "...", ...}` AST node. The LLM is supposed to emit, e.g.:

```json
{
  "name": "drive_link",
  "expression": { "kind": "ref", "ref": "uploaded_file", "field": "web_view_link" }
}
```

But the LLM (in `vocabulary-pipeline/phase4-pilot-dsl-steps.json:637-641`) emits a **template string**:

```json
{ "name": "drive_link", "expression": "{{uploaded_file.web_view_link}}" }
```

The IR converter's `normalizeExpressionRefs` at [`IntentToIRConverter.ts:1537-1539`](../../lib/agentkit/v6/compiler/IntentToIRConverter.ts#L1537) early-returns on non-object expressions:

```ts
if (expr == null || typeof expr !== 'object' || typeof expr.kind !== 'string') {
  return expr   // string passes through unchanged
}
```

So phase4 stores the raw template string. At runtime, [`StepExecutor`'s `resolveAllVariables`](../../lib/pilot/StepExecutor.ts) walks the step config (recursive Object/Array/string traversal) and replaces `{{var.field}}` placeholders with their resolved values. By the time `transformWithFields` runs, `field.expression = "https://drive.google.com/..."` — the resolved literal URL string.

`transformWithFields` calls:

```ts
augmented[field.name] = evaluateExpression(field.expression, item, context, evaluator);
```

`evaluateExpression` ([`StructuredTransforms.ts:289`](../../lib/pilot/transforms/StructuredTransforms.ts#L289)) is strict:

```ts
if (expr == null || typeof expr !== 'object' || typeof expr.kind !== 'string') {
  throw new StructuredTransformError(
    `evaluateExpression: invalid expression (must be {kind, ...}): ${JSON.stringify(expr)?.slice(0, 200)}`,
    'INVALID_EXPRESSION'
  );
}
```

A bare string fails this gate. Inside a scatter, this propagates as `SCATTER_ALL_FAILED` and the workflow halts before the downstream conditional send-email branch ever runs.

**Why this is the WP-22 / WP-30 / WP-32 family:**

| WP | Surface | Mismatch |
|---|---|---|
| WP-22 | `set_difference.reference` | LLM emits bare RefName, runtime needs `{{varname}}` |
| WP-30 | `case 'config'` / `case 'ref'` | runtime called `resolveVariable` with bare path, needs `{{}}` |
| WP-32 | `transform/flatten` | LLM correctly emits per-item-nested field, validator over-corrects to root-level |
| **WP-33** | **`with_fields.fields[].expression`** | **LLM emits `"{{var.field}}"` template, runtime needs `{kind, ...}` structured AST** |

All four are "LLM emits one valid-looking form, runtime/validator strictly requires another." The pattern recurs because the surface is wider than the grammar's enforcement gate — the LLM can drift to template-string emission especially for cross-slot refs (since `step.input`, `condition.value`, and many other surfaces *do* accept `{{}}` templates).

**Why `resolveAllVariables` makes this worse:** in many other surfaces the LLM's `{{}}` template emission "works" because resolveAllVariables substitutes the value in-place and the consumer takes a primitive value (e.g. a recipient email, a condition RHS). `with_fields` is unusual in expecting a *typed AST node*, not a primitive — so resolveAllVariables transforms an originally-wrong-but-syntactic emission into a definitely-wrong primitive that crashes.

**Concrete cascade (vocabulary-pipeline, 2026-05-13):**

```
step1 ✅ search emails → 1 email with 1 PDF attachment
step2 ✅ flatten attachments (WP-32 fixed) → 1 attachment
step3 ✅ filter (PDFs only) → 1 attachment
step4 ▶ scatter over [1 attachment]
  step5 ✅ download PDF (33KB)
  step6 ✅ document-extractor → mostly-empty fields (vendor "Unknown")
  step7 ✅ get_or_create_folder "Unknown Vendor"
  step8 ✅ upload PDF → returns {file_id, web_view_link, ...}
  step9 ❌ with_fields: evaluateExpression INVALID_EXPRESSION on resolved URL
step4 ❌ SCATTER_ALL_FAILED (1/1 items)
step10 (conditional) ⏭ skipped
step14 (ai_processing) ⏭ skipped
step15 (send_email) ⏭ skipped
```

User receives nothing.

**Fix shape (two layers, mirroring WP-22 / WP-30):**

#### A. Runtime tolerance in `evaluateExpression` — defense in depth

When `expr` is a string, normalize it before the structured-form check:

```ts
function normalizeStringExpression(s: string): any {
  // Match {{<ref>}} or {{<ref>.<field>}} (single-segment ref + optional one field)
  const m = s.match(/^\s*\{\{\s*([\w$]+)(?:\.([\w$]+(?:\.[\w$]+)*))?\s*\}\}\s*$/);
  if (m) {
    const ref = m[1];
    const fieldPath = m[2];
    if (ref === 'input' && fieldPath) {
      // First segment "input" is the config namespace
      return { kind: 'config', key: fieldPath };
    }
    // Single field segment → standard ref shape
    if (fieldPath && !fieldPath.includes('.')) {
      return { kind: 'ref', ref, field: fieldPath };
    }
    if (!fieldPath) {
      return { kind: 'ref', ref };
    }
    // Multi-segment field path — keep as ref with dotted field; resolver handles dotted paths.
    return { kind: 'ref', ref, field: fieldPath };
  }
  // Plain string (no template syntax) — already-resolved literal. Wrap as literal.
  return { kind: 'literal', value: s };
}

export function evaluateExpression(expr: any, currentItem, context, evaluator): any {
  // WP-33: tolerate template-string and already-resolved-string expressions.
  if (typeof expr === 'string') {
    expr = normalizeStringExpression(expr);
  }
  // ... existing structured-form check and switch
}
```

This handles both cases:
- **Pre-resolution path** (LLM template still intact): `"{{uploaded_file.web_view_link}}"` → `{kind: "ref", ref: "uploaded_file", field: "web_view_link"}` → evaluated per-iteration via context.
- **Post-resolution path** (resolveAllVariables already substituted): `"https://drive.google.com/..."` → `{kind: "literal", value: "https://drive.google.com/..."}` → returned as-is. Correct for cross-slot refs (the resolved value is the same for every iteration anyway).

#### B. IR converter normalization in `normalizeExpressionRefs`

Convert string expressions to structured form at compile time so phase4 has the correct shape (matches the W2 grammar contract; avoids relying on the runtime tolerance):

```ts
private normalizeExpressionRefs(expr: any, ctx, inputVar: string): any {
  // WP-33: parse string-form expressions into structured AST nodes.
  if (typeof expr === 'string') {
    const m = expr.match(/^\s*\{\{\s*([\w$]+)(?:\.([\w$]+(?:\.[\w$]+)*))?\s*\}\}\s*$/);
    if (m) {
      const ref = m[1];
      const fieldPath = m[2];
      if (ref === 'input' && fieldPath) {
        return { kind: 'config', key: fieldPath };
      }
      // Apply the same `ref === inputVar → "item"` rewrite the structured path does.
      const normalizedRef = ref === inputVar ? 'item' : ref;
      return fieldPath
        ? { kind: 'ref', ref: normalizedRef, field: fieldPath }
        : { kind: 'ref', ref: normalizedRef };
    }
    // Plain non-template string → literal
    return { kind: 'literal', value: expr };
  }

  if (expr == null || typeof expr !== 'object' || typeof expr.kind !== 'string') {
    return expr;
  }
  // ... existing switch
}
```

#### C. `resolveAllVariables` skip for structured expressions (deferred / optional)

Once (A) + (B) are in place, the IR converter emits `{kind: "ref", ref: "uploaded_file", field: "web_view_link"}` and `resolveAllVariables` doesn't touch it (it's an object, not a `{{}}` string). The runtime evaluator resolves cross-slot refs via context. This is the cleanest end state.

**Defer (C)** — `resolveAllVariables` traversal is generic and used by many step types. Changing its traversal to skip `with_fields.fields[].expression` would be a surgical exception that doesn't generalize. (B) achieves the same outcome.

**Files:**

- `lib/pilot/transforms/StructuredTransforms.ts` (~25 lines: `normalizeStringExpression` helper + 3-line guard in `evaluateExpression`)
- `lib/agentkit/v6/compiler/IntentToIRConverter.ts` (~20 lines: string-handling branch in `normalizeExpressionRefs`)
- `lib/pilot/__tests__/StructuredTransforms.wp33.test.ts` (new — template parsing, resolved-literal handling, with_fields integration, regression guards for `{kind, ...}` path)
- `lib/agentkit/v6/compiler/__tests__/IntentToIRConverter.wp33.test.ts` (new — converter normalizes string `expression` to structured AST)

**Test coverage to add:**

1. ✅ `evaluateExpression("{{X.Y}}", item, ctx, ev)` → resolves X.Y via context (post-WP-30 wrap)
2. ✅ `evaluateExpression("{{input.K}}", item, ctx, ev)` → resolves to ctx.inputs.K
3. ✅ `evaluateExpression("https://example.com", item, ctx, ev)` → returns the string as literal
4. ✅ `evaluateExpression(123, item, ctx, ev)` → throws (only strings + structured pass)
5. ✅ Regression: existing structured-form refs continue to work
6. ✅ IR converter: `with_fields` with `expression: "{{var.field}}"` produces `{kind: "ref", ref: "var", field: "field"}` in phase4
7. ✅ IR converter: `with_fields` with `expression: "{{inputVar.X}}"` produces `{kind: "ref", ref: "item", field: "X"}` (per-iteration rewrite)
8. ✅ IR converter: `with_fields` with `expression: "plain-literal"` → `{kind: "literal", value: "plain-literal"}`

**Why this wasn't caught earlier:**

The W2 (WP-16) primitive suite was tested with hand-written structured expressions matching the grammar exactly. LLM-emitted phase4 files for the regression scenarios in CP-D didn't exercise `with_fields` with cross-slot refs to non-loop slots (which is where template-string emission is most natural for the LLM — "just use the same `{{}}` syntax that works everywhere else"). The bug is invisible to Phase A/D mocks because the field's "resolved" value (a URL string) is also a valid stringification — only at runtime, when the typed evaluator expects an AST node, does the type mismatch surface.

---

### WP-32: `StructuralRepairEngine` rewrites flatten `field` from per-item-nested to root-level

**Severity:** P1 — silently corrupts correct LLM emission for the "extract attachments per email" pattern (and any similar wrapper→nested-array→per-item-array flow). User receives empty email; Phase E reports success.
**Encountered as:** Phase E on `expense-invoice-email-scanner` (2026-05-13) — Gmail search returned 1 matching invoice email with 1 PDF attachment, but step2 (`transform/flatten` over attachments) returned `[]`. User received an empty notification email.
**Status:** ⬜ Documented — fix to follow

**Problem:** Two coordinated emission/validator points disagree on what "flatten field" means.

**The LLM correctly emits** (in `phase4-pilot-dsl-steps.json`):

```json
{
  "step_id": "step2",
  "type": "transform",
  "input": "{{matching_emails.emails}}",
  "config": {
    "type": "flatten",
    "input": "matching_emails.emails",
    "field": "attachments"
  }
}
```

Semantically: "for each email in the emails array, extract its `attachments` sub-array; flatten all per-email arrays into one combined array." The runtime `transformFlatten` in [`StepExecutor.ts`](../../lib/pilot/StepExecutor.ts) implements exactly this: when `field` is set and `data` is an array, it does `data.reduce((acc, item) => acc.concat(item[field]), [])`.

**`StructuralRepairEngine.scanWorkflow`** ([`shadow/StructuralRepairEngine.ts:520-602`](../../lib/pilot/shadow/StructuralRepairEngine.ts#L520)) runs at the top of `WorkflowPilot.execute()` ([`WorkflowPilot.ts:266-294`](../../lib/pilot/WorkflowPilot.ts#L266)), validates the workflow, and **persists fixes back to the `agents.pilot_steps` DB column** — so subsequent runs see the rewritten value too.

```ts
// StructuralRepairEngine.ts line 531
const varMatch = inputStr.match(/\{\{(\w+)(?:\.data)?(?:\.(\w+))?\}\}/);
// For "{{matching_emails.emails}}" → varMatch[1] = "matching_emails", varMatch[2] = "emails"

if (varMatch) {
  const varName = varMatch[1];
  const sourceStep = allSteps.find(s => s.output_variable === varName || ...);

  if (sourceStep?.output_schema) {
    if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
      // Source returns an object - flatten field must be at ROOT level    ← WRONG ASSUMPTION
      const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
        key => sourceStep.output_schema.properties[key].type === 'array'
      );

      // Check if the flatten field is a root-level array
      if (!rootArrayFields.includes(field)) {
        // ...
        issues.push({ type: 'invalid_flatten_field', ... });
      }
    }
  }
}
```

The bug: when `step.input` itself navigates into a sub-field via `{{var.subfield}}`, the input flowing into `transformFlatten` is the *sub-field's* value (an array of items), not the whole source output. The validator captures `varMatch[2] = "emails"` from the regex but then ignores it and validates `config.field` against the **root keys** of the source output_schema. So `field: "attachments"` is rejected (not a root key of `{emails, total_found, ...}`).

The autoFix at [line 951-996](../../lib/pilot/shadow/StructuralRepairEngine.ts#L951) then picks from the root-level priority list `['emails', 'items', 'files', 'results', 'data', 'records', 'rows']` — `emails` is first, so `attachments` → `emails`. The fix is persisted to DB (`WorkflowPilot.ts:284-287`).

**Concrete log evidence (expense-invoice-email-scanner, 2026-05-13):**

```
[WP-32 DEBUG] transformFlatten entry
  field: "emails"                    ← AT RUNTIME (rewritten)
  data: array[1] itemKeys=id,thread_id,subject,from,to,date,snippet,labels,body,attachments
  field[emails]=missing               ← because no email has an `.emails` field
```

But `phase4-pilot-dsl-steps.json` on disk still has `field: "attachments"` — the rewrite is only on the DB-stored `agents.pilot_steps`, which is what WorkflowPilot uses at execution time.

**Why the assumption is wrong:** the validator was designed for the canonical Sheets-style pattern where `step.input` is `{{produce_step}}` (the whole wrapper) and `field` names the root array to flatten. That's a valid pattern. But it's not the *only* valid pattern — when the LLM (or compiler O23) has already navigated into a sub-array via `step.input = {{produce_step.X}}`, the meaning of `field` shifts from "the root array to flatten" to "the per-item sub-field to extract before flattening." The validator must distinguish the two cases.

**Trigger scenarios:**

- Gmail attachments: `{{search.emails}}` → flatten `attachments` (today's failure case)
- Sheets rows with nested cells: `{{read.rows}}` → flatten `tags`
- Drive folder contents with nested children: `{{list.folders}}` → flatten `files`
- Any plugin returning `{<key>: array<{<nested-key>: array<...>}>, ...}` shape with a per-item nested-array unwrap

**Fix:** in the "type === 'object'" branch, if `varMatch[2]` is set and `output_schema.properties[varMatch[2]]` is an array schema with `items.properties`, validate `field` against the **array items' properties** instead of root-level keys.

```ts
if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
  const subField = varMatch[2];

  if (subField && sourceStep.output_schema.properties[subField]?.type === 'array') {
    // Input navigates into a sub-array. Validate `field` against the array items' properties.
    const itemProps = sourceStep.output_schema.properties[subField].items?.properties;
    if (itemProps) {
      const itemArrayFields = Object.keys(itemProps).filter(k => itemProps[k].type === 'array');
      // If field is a per-item array sub-field → VALID, no issue
      if (itemArrayFields.includes(field)) {
        // explicitly do nothing — this is the per-item-nested flatten pattern
      } else if (itemArrayFields.length > 0) {
        // field is wrong, but suggest from per-item array fields
        issues.push({
          type: 'invalid_flatten_field',
          // ... "Available per-item array fields in <subField>[]: ..."
        });
      }
      // else: subField items have no nested arrays → field can't be anything meaningful, skip validation
    }
    // If subField is an array but items have no properties → skip validation (can't reason)
    return;  // do NOT fall through to root-level validation
  }

  // Original root-level validation (only fires when no navigation in step.input)
  const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
    key => sourceStep.output_schema.properties[key].type === 'array'
  );
  if (!rootArrayFields.includes(field)) { /* existing issue push */ }
}
```

For the autoFix `case 'invalid_flatten_field'` at line 951, also extend the priority list with a per-item-nested pattern when the description matches the new "per-item array fields" wording — but this is secondary; once detection is correct, autoFix won't fire for valid emissions.

**Files:**

- `lib/pilot/shadow/StructuralRepairEngine.ts` (~30 lines: scan logic + autoFix wording)
- `lib/pilot/shadow/__tests__/StructuralRepairEngine.wp32.test.ts` (new — canonical expense-invoice pattern, regression guards for Sheets-style root-level pattern, no-source-schema fallback, no-navigation fallback)

**Test coverage to add:**

1. ✅ Canonical: `input: {{x.emails}}` + `field: attachments` where source schema has `emails: array<{attachments: array, ...}>` → **NO issue raised**, no rewrite.
2. ✅ Regression: `input: {{x}}` (no navigation) + `field: nonexistent` where source has `emails: array, others: array` → issue raised, rewrite to `emails` (existing behavior preserved).
3. ✅ Regression: `input: {{x.emails}}` + `field: "wrong"` where items have `attachments: array, files: array` → issue raised, suggest from per-item fields.
4. ✅ Edge: `input: {{x.emails}}` but source's `emails` items have no array sub-fields → no issue raised (can't validate meaningfully).
5. ✅ Edge: no source schema available → existing skip behavior.

**Why this wasn't caught earlier:**

- The existing regression scenarios for `transform/flatten` over per-item-nested data (`aliexpress-delivery-tracker`, `expense-invoice-email-scanner`) likely had been emitting `field: "emails"` (the wrong-but-validator-friendly form) historically, OR were emitting field-less flatten (depth-only) which doesn't trigger this branch.
- Phase D uses mock plugin outputs that may not include the wrapper-object shape that triggers the validator's object-branch.
- The validator's "fix" silently mutates the DSL and persists it, so a subsequent run with the rewritten DSL just produces an empty result that looks like "no matching data" rather than a validator error.

**Compounding observation:** the validator at this point is acting as a "structural truth" enforcer but its truth is plugin-pattern-specific. As long as the LLM's emission is internally consistent (input navigation matches field semantics), the validator should **let it pass**. WP-32 is the third instance of "validator over-corrects valid LLM emissions" (WP-22 was `set_difference.reference` bare-RefName; WP-30 was `config` bare-path) — the recurring theme is **validators that assume a single canonical form rather than detecting which of several valid forms the LLM emitted**.

---

### WP-31: `today` + `date_diff` use time-difference instead of calendar-day difference

**Severity:** High (silent off-by-one drops the most-urgent items in time-window filters)
**Encountered as:** Phase E on `gantt-urgent-tasks` after WP-29 + WP-30 fixes landed (2026-05-11) — user expected 3 urgent tasks in summary email; received 1.
**Status:** ⬜ Documented — fix to follow

**Problem:** The W2 expression runtime treats "days between" as `(timestamp_a − timestamp_b) / 86_400_000` floored, not as calendar-day difference.

```ts
case 'today':
  return new Date().toISOString();          // ← current moment, includes time

case 'date_diff': {
  ...
  const ms = dLeft.getTime() - dRight.getTime();
  if (expr.unit === 'days') return Math.floor(ms / (1000 * 60 * 60 * 24));
}
```

For a workflow run at 11:30 local (8:30 UTC), `today` = May 11 08:30 UTC. `parseDate("12/5/2026")` = May 12 00:00 UTC (via WP-29's `buildDate`). Then:

```
ms = May 12 00:00 UTC − May 11 08:30 UTC = 15.5h = 55_800_000 ms
Math.floor(55_800_000 / 86_400_000) = Math.floor(0.65) = 0
```

So `days_until_finish` for a May-12 task is **0** instead of the expected **1**. The downstream filter `1 ≤ days_until_finish ≤ 3` drops it.

**Concrete cascade (gantt-urgent-tasks, post-WP-29/30):**

| Task | finish_date | days_until_finish (actual) | days_until_finish (expected) | Filter `1≤x≤3` |
|---|---|---|---|---|
| Employee signature | "12/5/2026" | 0 | 1 | DROPPED ❌ |
| Global market research | "12/5/2026" | 0 | 1 | DROPPED ❌ |
| Define account sender | "13/5/2026" | 1 | 2 | kept ✓ |

The May-13 task happened to land far enough out that even with the floor-truncation, it still got 1 ≥ 1 → passes filter. So **exactly 1 task** survives, not 3.

The bug is worst at noon (12:00 UTC, fractional = 0.5) and best at midnight (fractional = 0, integer math gives the right answer). User happened to run at 11:30 → 2 of 3 tasks dropped.

**Three-part fix:**

#### A. `today` returns calendar day at UTC midnight

```ts
case 'today': {
  const tz = context.getUserTimezone?.();
  if (tz) {
    // Compute today's date in the user's local timezone, return midnight UTC of that date.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const [y, m, d] = fmt.format(new Date()).split('-').map(s => parseInt(s, 10));
    return new Date(Date.UTC(y, m - 1, d)).toISOString();
  }
  // Server UTC fallback
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
```

#### B. `date_diff` defensively normalizes both sides

```ts
case 'date_diff': {
  const dLeft = parseDate(...);
  const dRight = parseDate(...);
  if (dLeft == null || dRight == null) return null;
  if (expr.unit === 'days') {
    // Normalize both to UTC midnight before computing diff.
    const a = Date.UTC(dLeft.getUTCFullYear(), dLeft.getUTCMonth(), dLeft.getUTCDate());
    const b = Date.UTC(dRight.getUTCFullYear(), dRight.getUTCMonth(), dRight.getUTCDate());
    return Math.round((a - b) / 86_400_000);  // round, not floor — both at midnight UTC so should be integer
  }
  ...
}
```

`Math.round` (instead of `floor`) handles any DST or leap-second weirdness — both sides at UTC midnight, so the result is always an integer, but `round` is safer.

#### C. `date_add` preserves midnight semantics

`date_add(today, 3, 'days')` should produce a midnight-UTC date 3 calendar days later. Today returns midnight UTC, plus `3 * 86_400_000` ms = exactly midnight UTC 3 days later. Already works after (A). No code change needed for `date_add` itself.

**Files:** `lib/pilot/transforms/StructuredTransforms.ts` (~30 lines: `today` + `date_diff` updates), `lib/pilot/__tests__/StructuredTransforms.wp29-wp30.test.ts` extended with WP-31 tests (or new file).

**Why this wasn't caught earlier:** the W2 unit tests use contrived datetimes (often the same moment for both sides) that happen to floor to the correct integer. Real-world inputs where one side is a date-only string and the other is "now" surface the fractional-days bug.

---

### WP-30: `config` expression resolves to literal string instead of config value

**Severity:** High (silent null cascade through `with_fields` / `date_add` / `date_diff`)
**Encountered as:** Phase E on `gantt-urgent-tasks` (2026-05-11) — every row's `window_end` field came out null even though `workflow_config.date_window_days = 3`.
**Status:** ⬜ Documented — fix to follow with WP-29

**Problem:** The W2 Expression evaluator at [`StructuredTransforms.ts:307-312`](../../lib/pilot/transforms/StructuredTransforms.ts):

```ts
case 'config': {
  if (typeof expr.key !== 'string' || !expr.key) {
    throw new StructuredTransformError('config expression requires `key` string', 'INVALID_EXPRESSION');
  }
  return context.resolveVariable(`input.${expr.key}`);   // ← bare path, no {{}}
}
```

Production [`ExecutionContext.resolveVariable`](../../lib/pilot/ExecutionContext.ts) requires `{{...}}` template syntax:

```ts
if (!reference.includes('{{')) {
  return reference;   // bare strings returned as literal!
}
```

So `evaluateExpression({kind: "config", key: "date_window_days"}, ...)` returns the literal string `"input.date_window_days"` instead of the actual value `3`.

**Concrete cascade (gantt-urgent-tasks):**

```
step6 with_fields expression:
  { kind: "date_add", date: {kind: "today"}, days: {kind: "config", key: "date_window_days"} }

evaluateExpression(days) → "input.date_window_days"   (literal string)
Number("input.date_window_days") → NaN
date_add: !Number.isFinite(NaN) → return null
window_end: null in every row
```

Downstream step7 filter on `days_until_finish <= {{input.date_window_days}}` then fails for entirely separate reasons (WP-29's date parsing bug) — but even if WP-29 were fixed, `window_end: null` would still produce wrong results in any downstream consumer.

**Why this wasn't caught before:** W2 unit tests use a permissive stub context that strips `{{}}` equivalently for both `{{X}}` and bare `X`. The strict production behavior was never exercised in the W2/W3 measurement. Same blind spot as WP-22 — fingerprint measurement and unit tests with permissive stubs miss runtime convention mismatches.

**Fix:** wrap the path in `{{}}` before calling `resolveVariable`. Same shape as WP-22's runtime defensive wrap. One line.

```ts
case 'config': {
  if (typeof expr.key !== 'string' || !expr.key) {
    throw new StructuredTransformError('config expression requires `key` string', 'INVALID_EXPRESSION');
  }
  return context.resolveVariable(`{{input.${expr.key}}}`);   // ← wrapped
}
```

**Sibling audit needed:** the `ref` case in the same `evaluateExpression` function also calls `context.resolveVariable(path)` with a bare path for non-`item` refs. Likely broken for cross-slot refs but not yet exercised in our scenarios (most refs are to `item`). Should apply the same wrap.

```ts
case 'ref': {
  if (expr.ref === 'item') { ...special-cased correctly... }
  const path = expr.field ? `${expr.ref}.${expr.field}` : expr.ref;
  return context.resolveVariable(`{{${path}}}`);   // also needs wrap
}
```

**Files:** `lib/pilot/transforms/StructuredTransforms.ts` (~2 lines), unit test using a strict stub mirroring production `resolveVariable` (same pattern as WP-22 tests).

---

### WP-29: `parseDate` is locale-sensitive — misinterprets DD/MM/YYYY as MM/DD/YYYY

**Severity:** High (silent date corruption in `date_diff` / `date_add` expressions)
**Encountered as:** Phase E on `gantt-urgent-tasks` (2026-05-11) — `days_until_finish` came out as `207` instead of `1` for `finish_date: "12/5/2026"`, and as `null` for `"13/5/2026"`.
**Status:** ⬜ Documented — fix to follow

**Problem:** [`parseDate` in `StructuredTransforms.ts:398`](../../lib/pilot/transforms/StructuredTransforms.ts):

```ts
export function parseDate(value: any): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);   // ← locale-sensitive parsing
  return isNaN(d.getTime()) ? null : d;
}
```

JavaScript's `Date` constructor parses slash-format strings via implementation-defined logic:
- `"2026-05-12"` (ISO) → always May 12 ✓
- `"12/5/2026"` (slash) → Dec 5 (MM/DD/YYYY interpretation) on most engines

The user's Google Sheet (locale `Asia/Jerusalem`) stores dates as DD/MM/YYYY. The runtime misinterprets them.

**Concrete cascade (gantt-urgent-tasks):**

| Sheet cell | `new Date()` interpretation | `days_until_finish` (today = May 11) | Expected (DD/MM) |
|---|---|---|---|
| `"12/5/2026"` | Dec 5, 2026 | 207 | 1 (May 12) |
| `"13/5/2026"` | Invalid (no month 13) | null | 2 (May 13) |

Downstream filter `1 <= days_until_finish <= 3` drops both → "no data" cascade.

**Three-tier fix design**

#### Tier 1 — Unambiguous detection (no user signal needed)

If the date string is `X/Y/Z` (or `X-Y-Z` non-ISO), check whether either `X` or `Y` is `> 12`:

| Date string | `X > 12`? | `Y > 12`? | Unambiguous? |
|---|---|---|---|
| `"13/5/2026"` | Yes (13 is not a month) | No | Yes → DD/MM/YYYY |
| `"5/13/2026"` | No | Yes (13 is not a month) | Yes → MM/DD/YYYY |
| `"12/5/2026"` | No | No | Ambiguous → falls to Tier 2 |
| `"5/5/2026"` | No | No | Ambiguous → falls to Tier 2 |

Tier 1 alone fixes `"13/5/2026"` without user signal — the format is forced.

#### Tier 2 — User-timezone-driven locale (your suggestion)

For Tier-1-ambiguous cases (both parts ≤ 12), use the user's timezone to infer locale:

| Timezone bucket | Examples | Preferred format |
|---|---|---|
| US/Canada/Mexico | `America/New_York`, `America/Los_Angeles`, `America/Chicago` | MM/DD/YYYY |
| East Asia | `Asia/Tokyo`, `Asia/Seoul`, `Asia/Shanghai` | YYYY/MM/DD (uncommon in slash form, usually ISO) |
| Everywhere else (default) | `Asia/Jerusalem`, `Europe/*`, `Africa/*`, `Australia/*`, most of `Asia/*` | DD/MM/YYYY |

Plumbing: extend `IExpressionContext` with an optional `getUserTimezone(): string | undefined` method. Returns whatever the platform exposes (from `lib/user-context/`, the user's profile, or the workflow_config's `_user_timezone` if set). `parseDate` consults it for ambiguous cases.

If `getUserTimezone()` returns undefined, default to DD/MM/YYYY (covers ~85% of world population).

#### Tier 3 — workflow_config explicit hint (deferred follow-up)

Future enhancement: the LLM can emit an explicit `date_format` key in workflow_config when the user's prompt mentions the format. E.g.:

```
User: "the Due Date column is in DD/MM/YYYY format"
LLM emits: workflow_config.date_format: "DD/MM/YYYY"
```

`parseDate` consults this hint first (highest priority). Deferred to a separate WP — requires Phase 1 prompt steering.

**Implementation sketch (Tier 1 + Tier 2):**

```ts
export function parseDate(value: any, context?: IExpressionContext): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const trimmed = value.trim();

  // Try ISO first (always unambiguous)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // Slash-format parsing
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    const y = parseInt(slashMatch[3], 10);
    const year = y < 100 ? 2000 + y : y;

    // Tier 1: unambiguous detection
    if (a > 12 && b <= 12)      return new Date(year, b - 1, a);  // DD/MM
    if (b > 12 && a <= 12)      return new Date(year, a - 1, b);  // MM/DD

    // Tier 2: ambiguous — use user timezone
    if (a <= 12 && b <= 12) {
      const tz = context?.getUserTimezone?.();
      const prefersMMDD = tz != null && /^America\/(?!Sao_Paulo|Argentina|Asuncion|Bogota|Caracas|Cuiaba|Guyana|La_Paz|Lima|Manaus|Montevideo|Paramaribo|Recife|Santiago)/.test(tz);
      return prefersMMDD
        ? new Date(year, a - 1, b)   // MM/DD
        : new Date(year, b - 1, a);  // DD/MM (default)
    }
  }

  // Fallback: hand off to JS engine (ISO, RFC2822, etc.)
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}
```

The America/* timezone check excludes South American zones (which use DD/MM despite being in the Americas). Conservative — false positives on this rule produce DD/MM which is the safer default.

**Files:** `lib/pilot/transforms/StructuredTransforms.ts` (~40 lines: extended `parseDate`, optional `getUserTimezone` parameter), `lib/pilot/types.ts` or wherever `IExpressionContext` lives (~2 lines: add optional method), unit tests for all 4 patterns + Tier 1 + Tier 2 + regression guards.

---

### WP-28: Bare numeric SOURCE keys in `field_mapping` not recognized as positional

**Severity:** High (silent data loss — user receives "no data" email despite real Sheet data)
**Encountered as:** Phase E on `leads-email-summary` (2026-05-11) — step3 produced `[{}, {}, {}, {}, {}]`, step4 filter returned `[]`, step6 AI emitted "No data available."
**Status:** ✅ Fixed — runtime tolerance + prompt steering

**Problem:** Step3's `field_mapping`:

```json
{
  "Date": "0",
  "Lead Name": "1",
  "Company": "2",
  "Email": "3",
  "Phone": "4",
  "Stage": "5",
  "Notes": "6",
  "Sales Person": "7"
}
```

Target keys are real field names; **source keys are bare numeric strings** — the LLM's expression of "for each named target, pluck column N from the input row." Semantic intent: identical to WP-SR's `column_<digit>` pattern, but with the `column_` prefix stripped.

The existing source-side check (added in WP-SR) only matches `^column_(\d+)$`:

```ts
const COLUMN_N = /^column_(\d+)$/;
const colMatch = sourceField.match(COLUMN_N);
if (colMatch) { /* positional access via Object.values(item)[idx] */ }
else { value = item[sourceField]; }    // bare "0" hits this branch
```

With item = `{Date: "14/12/2025", "Lead Name": "Lead 1", ...}` (post-rows_to_objects with `preserve_case: true`), `item["0"]` is undefined. Every target field gets undefined → step3 emits empty objects → step4 filter on `item.Stage === "4"` finds nothing → step6 AI sees empty input and emits "No data available." (WP-13 anti-fabrication guard, working as designed) → step7 sends an empty-state email.

**Variant catalog (source-key positional)**

| Pattern | Example source key | Pre-WP-28 handling |
|---|---|---|
| `column_<digit>` | `"column_0"` | ✅ WP-SR regex |
| **Bare numeric** | `"0"` | ❌ Falls through → bug |
| `column_<letter>` | `"column_A"` | ❌ Falls through |
| Excel letter | `"A"` | ❌ Falls through |

The 4 variants mirror WP-25's target-key positional catalog. The LLM is creative on both sides of the mapping.

**Fix (runtime, layer A):**

Reuse the `parsePositionalKey()` helper that already exists from WP-25 (recognizes all 4 patterns and maps to a 0-indexed column position via Excel-style letter conversion). Apply it on the source side:

```ts
const applyMapping = (item: any) => {
  const mapped: Record<string, any> = {};
  for (const [targetField, sourceField] of Object.entries(mapping)) {
    let value: any;
    const posIdx = typeof sourceField === 'string' ? parsePositionalKey(sourceField) : null;
    if (posIdx !== null) {
      if (Array.isArray(item)) {
        value = item[posIdx];
      } else if (item && typeof item === 'object') {
        value = Object.values(item)[posIdx];   // post-rows_to_objects path
      }
    } else {
      value = item ? item[sourceField] : undefined;
    }
    mapped[targetField] = value;
  }
  return mapped;
};
```

Now source-side is consistent with target-side (WP-25): both accept the same 4 positional patterns.

**Fix (prompt, layer B):**

Extend section 6.11 (DELIVER `mapping`) — or wherever `transform/map` `field_mapping` is documented — with source-key canonical guidance. Recommended form: use the actual field names from the producer's output schema (`{Date: "Date"}` style), not positional descriptors. If positional must be used (e.g., when the producer schema isn't known), prefer bare numeric strings (`{Date: "0"}`) over `column_*` variants.

**Files:** `lib/pilot/StepExecutor.ts` (~5 lines: swap `COLUMN_N` regex for `parsePositionalKey()`), `lib/agentkit/v6/intent/intent-system-prompt-v2.ts` (~10 lines prompt extension), unit tests for all 4 source patterns.

**Sibling failure note:** the same source-positional emission can also occur with object input that already has numeric-string keys (uncommon but possible — e.g., output of a previous numeric-keyed `transform/map`). In that case, `item["0"]` succeeds directly without needing the positional fallback. The `parsePositionalKey()` check should fire only when the literal key lookup fails — or always, with `Object.values` being a safe equivalent when item is an indexed object.

---

### WP-26: O23 doesn't recognize `project_column.by_index` as a positional consumer

**Severity:** High (silent dedup failure → duplicate rows on every run for sheets without a header row)
**Encountered as:** Phase E on `complaint-email-logger` (2026-05-11) — second consecutive run appended duplicate rows because dedup against existing sheet data silently produced an empty reference list.
**Status:** ⬜ Future — user workaround applied (add header row); compiler fix tracked here

**Problem:** The compiler's [`normalizeDataFormats`](../../lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts) Phase 3.5 includes an "O23" optimization: when a fetch action produces a 2D array (Sheets `read_range`), check whether ALL downstream consumers use positional column access. If yes, skip auto-injecting `rows_to_objects` and rewrite consumer inputs to point at the raw `.values` field instead.

The check (~line 2497):

```ts
const allUseColumnIndex = downstreamConsumers.length > 0 && downstreamConsumers.every(s =>
  s.config?.column_index !== undefined || s.config?.column_index === 0
)
```

This looks for a flat `step.config.column_index` property. But the modern `project_column` (introduced in W2 / WP-16) declares positional access as:

```ts
config: { column: { kind: "by_index", index: 4 } }
```

The check doesn't see `column_index` at the top level → returns `false` → `rows_to_objects` auto-inject fires.

**Cascade observed on `complaint-email-logger`:**

User's `UrgentEmails` sheet has NO header row — data starts at A1 directly. step3 returns:

```json
"values": [
  ["Barak Meiri <meiribarak@gmail.com>", "Fwd: ...", "Sun, 10 May ...", "", "19e132ee6f2eb226"]
]
```

That's 1 row of data. The auto-injected `rows_to_objects` consumes this single row as a header → output is `[]` (empty array). Downstream:

- step5 `project_column.by_index: 4` on `[]` → `[]` (existing_message_ids is empty)
- step8 `set_difference` reference is `[]` → no items get filtered out
- All candidate emails appear to be "new" → duplicates appended on every run

**Why this didn't appear in unit tests:** all our `rows_to_objects` tests use input arrays with at least 2 rows (header + data). The single-row edge case wasn't exercised.

**Fix:**

Extend the O23 `allUseColumnIndex` check to also recognize:

1. `project_column.by_index`: `step.config?.column?.kind === 'by_index'`
2. WP-25 positional `field_mapping` on `transform/map`: all target keys parse as positional via `parsePositionalKey()` (numeric / column_N / Excel letter / column_letter)

When ALL downstream consumers are positional under either form, skip the `rows_to_objects` insertion and rewrite consumer inputs to `{{producer_var.<arrayField>}}` (today done only when `column_index` matches).

```ts
const isPositionalConsumer = (s: WorkflowStep): boolean => {
  // Existing column_index path
  if (s.config?.column_index !== undefined) return true;
  // WP-26 project_column.by_index
  if (s.operation === 'project_column' && s.config?.column?.kind === 'by_index') return true;
  // WP-26 transform/map with positional field_mapping (WP-25 patterns)
  if (s.operation === 'map' && s.config?.field_mapping && typeof s.config.field_mapping === 'object') {
    const keys = Object.keys(s.config.field_mapping);
    if (keys.length > 0 && keys.every(k => parsePositionalKey(k) !== null)) return true;
  }
  return false;
};
const allUsePositional = downstreamConsumers.length > 0 && downstreamConsumers.every(isPositionalConsumer);
```

When true, skip the rows_to_objects insertion and apply the existing consumer-rewrite path. The runtime `project_column.by_index` (WP-20) and `transform/map` positional (WP-23/25) already handle raw 2D arrays correctly.

**Files:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (~25 lines: extended check + reuse existing rewrite path). Unit test: compiler integration covering 3 cases — (a) positional only → no rows_to_objects, (b) named-field consumer → rows_to_objects fires, (c) mix → rows_to_objects fires (conservative).

**Sibling failure note:** even with WP-26 fixed, the underlying "sheet has no header row" semantic mismatch remains an open question. The LLM's mental model often assumes a header row because the user's prompt names columns. Documented as "user must add header row OR pipeline must be configured to skip header detection." Could be a future prompt-steering or compiler heuristic improvement (track row count in data_schema and warn when downstream rows_to_objects on single-row data).

---

### WP-27: Sheets `append_rows` shifts to non-A column when existing data has empty cells

**Severity:** High (rows append at the wrong column, visually misaligned)
**Encountered as:** Phase E on `complaint-email-logger` (2026-05-11) — step10 succeeded but `updated_range: "UrgentEmails!E2:I3"` instead of A2:E3.
**Status:** ⬜ Future — user workaround applied (add header row); compiler fix tracked here

**Problem:** Google Sheets `append_rows` API uses a "logical table" auto-detection algorithm. Given `range: "UrgentEmails!A:E"`, the API scans the range for the bottom of any contiguous data table and appends after it.

When existing data has **column discontinuity** (e.g., column D empty between A-C and E with data — as can happen when an earlier run wrote rows without the body cell), the API may detect the non-empty trailing column (E) as the "table" rather than the full A-E row.

Observed payload:

```
input.range: "UrgentEmails!A:E"
existing row: ["A val", "B val", "C val", "", "E val"]   ← D empty
output.table_range: "UrgentEmails!E1"      ← Sheets thinks table is at E
output.updated_range: "UrgentEmails!E2:I3" ← appended at E2 (rows × 5 cols)
```

The data shape was correct (5-column 2D array). Only placement shifted. Result: sheet has data in two disjoint column ranges (A-E for the original row, E-I for the new rows).

**Why this is sensitive to WP-24:** before WP-24 fixed `content_level: 'full'` auto-application, the `full_email_text` cell came through empty. Rows written in that state had empty D cells. After WP-24, new rows have populated D cells. The discontinuity exists only because of the historical pre-WP-24 row(s).

**Fix:**

Compiler-side normalization of the `range` parameter for `append_rows`. Currently the LLM tends to emit `range: "<sheet>!A:E"` (column range). The Sheets API behaves better when `range` is:

- `"<sheet>"` (bare sheet name — defaults to A1) — **recommended**
- `"<sheet>!A1"` (point start) — alternative

Both force Sheets to anchor the table-walker at A1 regardless of existing cell sparsity.

Heuristic: in `IntentToIRConverter` or `ExecutionGraphCompiler`, when binding `google-sheets.append_rows` (and similar `append`-intent actions on other plugins with the same quirk), normalize `params.range`:

```ts
// Strip A:Z column range and any explicit row range; collapse to "<sheet>!A1"
if (typeof params.range === 'string' && params.range.includes('!')) {
  const [sheetName] = params.range.split('!');
  params.range = `${sheetName}!A1`;
}
```

Or simpler — emit just the sheet name (the plugin executor can default to A1).

**Alternative (less compiler-coupled):** plugin-side normalization in `google-sheets-plugin-executor.ts` for `append_rows`: rewrite the `range` parameter at execution time. Pro: contained to plugin. Con: doesn't apply to other plugins with similar quirks (BigQuery, Airtable, etc.).

**Files (compiler approach):** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` Phase 4.5 normalization (~15 lines) + plugin-executor unit test verifying the rewrite.

**Sibling check (operational):** the underlying Sheets quirk affects any plugin that wraps `append`-style writes. Audit other "append" actions for similar emission patterns when WP-27 is implemented.

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
| 2026-06-08 | WP-56 filed + partial fix — Phase 1 emits a container's id field name (`folder_id`) for items of a different resource (Drive files use `id`) on a scatter/loop iteration variable → `undefined` at runtime → Docs API 400. Same incident agent as WP-49/53/54/55 (`8c7caa01`). | Root-cause prompt steering: new **FIELD FIDELITY (WP-56)** rule in § 6.9 LOOP "CRITICAL LOOP RULES" of `intent-system-prompt-v2.ts` — `item_ref.<field>` names must come from the iterated collection's element schema, never reused from a container/other step; plugin-agnostic (container-vs-items framing), also covers scatter-gather iteration vars. Still open: deterministic reconciliation for iteration-variable field refs (calibration-side detector tracked as P3 in CALIBRATION_FALSE_SUCCESS_FIX_WORKPLAN.md), and pinning the `id`→`folder_id` data_schema mutation (now recoverable via WP-55 persistence). WP-2 reconciliation does NOT cover scatter/loop item-refs. |
| 2026-06-01 | WP-55 implemented (commit `4a8c410`) — Phase 1 IntentContract + Phase 2 data_schema now persist on `agents.agent_config.ai_context` | Pipeline A endpoint extended to return both artifacts in the response body; V2 UI's `mapV6ResponseToAgent` forwards them into `agent_config.ai_context.intent_contract` / `.data_schema`; `CreateAgentAIContext` interface extended with the two new optional `unknown \| null` fields for backwards-compat. `/api/create-agent` needed no code change — Zod schema already accepts arbitrary keys via `z.record(z.unknown()).nullish()` (WP-48). 107 LOC across 4 files, no schema migration. Diagnosis SQL pattern documented in V6_DEVELOPER_GUIDE under "Diagnosing a Production Agent's Phase 1 Emission" with a checklist of bug fingerprints linking back to WP-44 / WP-49 / WP-53. Pre-WP-55 agents carry both fields = null; backfill not possible. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-06-01 | WP-55 documented (planned, not yet implemented) — persist Phase 1 IntentContract + Phase 2 data_schema on `agents.agent_config.ai_context` | Observability gap surfaced during the contracts-googledocs-v2ui-pipeline-a investigation (commit `49b631b`). The agent's Phase 1 LLM emission (where the bug originated) wasn't recoverable post-hoc — a re-run of the same EP produced a CORRECT emission that didn't reproduce the bug, blocking root-cause analysis. Pino logs do carry the full IntentContract via `[IntentGen] ✅ Intent Contract generated successfully` ([generate-intent.ts:296](../../lib/agentkit/v6/intent/generate-intent.ts#L296)) but (a) the `correlationId → agent_id` mapping isn't persisted anywhere, and (b) prod log retention isn't a guarantee for forensic-level diagnosis weeks later. The `agents.agent_config` JSONB column already exists ([types.ts:52](../../lib/repositories/types.ts#L52)) and already carries `creation_metadata` + `ai_context.enhanced_prompt`/`reasoning` — the natural home for these two additional artifacts. Fix shape: (i) extend Pipeline A endpoint response to include `intent_contract` + `data_schema`; (ii) V2 UI captures them; (iii) `/api/create-agent` writes them to `agent_config.ai_context.intent_contract` and `agent_config.ai_context.data_schema`; (iv) document the diagnosis lookup pattern in V6_DEVELOPER_GUIDE. ~80 LOC across 4 files, no schema migration. Implementation following this commit. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-31 | WP-54 fixed at runtime layer — `scatter.continueOnError?: boolean` opt-in honoured by `ParallelExecutor.executeScatterItem` | Type field added to `ScatterGatherStep.scatter` in `lib/pilot/types.ts` (+18 LOC of doc-comment); production-mode re-throw at `ParallelExecutor.executeScatterItem:712` now checks `scatterStep.scatter?.continueOnError === true` and skips the throw when set, falling through to the calibration/batch swallow-and-tag path. Default `false` — zero behaviour change for existing workflows. WP-10 (2026-03-31) gather-phase error-filtering already separates success/error results, so when `continueOnError: true` items fail, downstream consumers only see good items (no need for a separate `_skipped[]` companion at this layer; the gather output handles it). **Deferred follow-ups:** (i) IntentContract LOOP grammar field `loop.continueOnError` + Phase 3 prompt rule for "emit on heterogeneous-input scatters" (Drive folder scans, broad searches); (ii) `ExecutionGraphCompiler.ts:1170-1185` plumbing of `loop.continueOnError` → `scatter.continueOnError`. Both easy follow-ups; bundled separately to keep this commit focused on the runtime hatch. **Immediate user-value:** the failed Contract Expiration Monitor agent (`8c7caa01-e328-4b0a-ae04-afbcd10add45`) can be remediated via a DB patch that adds `continueOnError: true` to step3's scatter (the WP-53 incident response's Step D). Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-31 | WP-53 fixed — Phase 3 prompt now instructs the LLM to scan EP for filter/format/recipient constraints and emit each as a matching plugin param | New **§ 5.5 EP FIDELITY** section in `intent-system-prompt-v2.ts` (+74 lines). Pattern table covers type/format filters ("only Google Docs" → `file_types`), resource IDs, search query language, date filters, body format (HTML/plain), recipients (to/cc/bcc), and language. Anti-example block uses the WP-53 incident (Contract Expiration Monitor, agent `8c7caa01-e328-4b0a-ae04-afbcd10add45`) — EP said "only Google Docs", plugin schema exposed `file_types: ["document"]`, IR dropped it, scatter then fanned out to `google-docs.read_document` on DOCX files and 400'd. Cross-referenced from § 6.1 (data_source decision tree) and § 6.12 (notify) — the notify cross-ref also closes the prompt-side of WP-44 (HTML format) and WP-49 (cc/bcc). Token cost: ~400-500 per Phase 3 call. **WP-54 (ParallelExecutor `continueOnError`) still planned as next step** to harden against any future Phase 3 fidelity misses that slip past the prompt. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-31 | WP-53 + WP-54 documented (fixes planned, not yet implemented) | Surfaced together on a failed execution of agent `8c7caa01-e328-4b0a-ae04-afbcd10add45` ("Contract Expiration Monitor"). The user's EP said "Consider only Google Docs documents in that folder" but the Phase 3 IR-author authored step2's `google-drive.list_files` params as `{ folder_id }` only — no `file_types: ["document"]` filter, despite the plugin's parameter schema explicitly exposing it. Result: step2 returned all 7 files (3+ DOCX uploaded Word docs alongside native Google Docs); scatter step3 fanned out to `google-docs.read_document`; Google Docs API 400'd on the DOCX files (Hebrew error HTML from `docs.google.com` — dev.log L11813, L11840); `ParallelExecutor` `runMode: production` fail-fast threw → whole-run failure. **Two separate WPs because two separate layers:** (1) **WP-53 (root cause, P0).** Phase 3 IR-author drops EP-level filter constraints when authoring `step.params`. Same family as WP-44 (HTML format) and WP-49 (cc/bcc) — *"EP says X, plugin supports X as a param, IR drops X."* The actual fix is a prompt change to the Pipeline A intent-system prompt: instruct the LLM to scan EP sections for filter language (*"only X"*, *"in folder Y"*, *"from sender Z"*) and map each to the bound action's parameter schema. Bundle with WP-44's Phase 3 prompt-fidelity work. (2) **WP-54 (defence-in-depth, P1).** ParallelExecutor's production-mode fail-fast on any per-item scatter failure amplifies *any* future Phase 3 fidelity miss into a hard execution error. Add opt-in `scatter.continueOnError: true` so heterogeneous-input scatters (Drive folder scans, Gmail searches, web research) survive bad items with a `_skipped[]` companion array. Distinct from WP-53 but addresses the same incident's amplification. WP-10's earlier scatter error-filtering was gather-phase only; doesn't change the production-mode re-throw policy. **Why neither is fixed in this commit:** documenting first per user's explicit sequencing (document → root-cause fix → resilience fix → DB patch + re-run). Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-30 | WP-52 documented + fixed — `StructuralRepairEngine` no longer false-flags `{{input.X}}` and `{{config.X}}` as broken variable references | `findBrokenVariableReferences()` checked the root var of every `{{X.Y}}` template against (a) step IDs / output_variable names and (b) a hardcoded `builtins` set (loop-context names like `current_item`, `current_email`, `current_row`, `index`, `context`). The `'input'` namespace was missing — even though `{{input.X}}` is the primary templating form for every workflow's configuration parameters. Every config reference therefore false-positived as `broken_variable_reference` and showed up in the WARN "Structural auto-repair fired on workflow before execution" log. No data corruption today because `suggestVariableCorrection` returned `null` (no fuzzy step-ID match within edit-distance 2), so `autoFixable: false` and `will_persist: false` — runtime resolves `input.X` correctly regardless. **Latent risk fixed alongside:** the fuzzy-match path would have silently rewritten `{{input.X}}` → `{{wrong_step.X}}` in `will_persist: true` mode if any workflow ever had a step ID within edit-distance 2 of `'input'` (e.g. `inputs`, `init`) — same blind-guess auto-correction anti-pattern as WP-40. **Surfaced 2026-05-30** on agent `22da09f7-d697-4072-8eaf-e1ef83df5a2e` post-WP-50 fix: warning fired with `issue_count: 3, fixed_count: 0, failed_count: 3, will_persist: false` against `input.research_topic`, `input.recipient_to`, `input.recipient_cc`. **Fix:** added `'input'` and `'config'` to the `builtins` set in `findBrokenVariableReferences`. `'config'` included because older Pipeline-B output occasionally emitted `{{config.X}}` and the file's separate `findConfigReferences` check (L403-419) already runs a normalisation pass that rewrites `config.X` → `input.X` regardless of whether the root-var check skipped, so no behaviour change there. Same validator-vs-runtime contract-mismatch family as WP-32 (validator pulled wrong level on `flatten.field`). **Why this wasn't caught earlier:** the engine's design intent is purely *informational* warnings unless `will_persist: true` (which would only fire if `autoFixable: true`). Since `suggestion` was `null` for `'input'` across every regression scenario, the warnings logged but never modified workflows — looked like benign noise rather than a structural validator bug. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-30 | WP-51 documented (architectural, fix deferred) — `DataPreprocessor` shape-heuristic routing into lossy specialized preprocessors | Companion to WP-50. WP-50 fixed the specific `summary`-alone-matches-event false positive; WP-51 documents the family of which WP-50 is one instance. The same anti-pattern exists in the other three `detectDataType()` clauses (`subject`+sender → email, `amount`+currency → transaction, `email`+name → contact) — each routes to a destructive specialized preprocessor that drops items not matching the type's validators. Today no regression scenario trips them, but the WP-50 incident is a proof of concept. Three intervention directions documented (A: schema-driven routing, B: non-destructive preprocessor contract, C: hybrid auto-fallback on data-shrink threshold) — bundling deferred until a second family member surfaces. Same "silent data loss masked by a downstream guardrail" family as WP-13 / WP-32 / WP-40. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-30 | WP-50 documented + fixed — `DataPreprocessor.detectDataType()` no longer classifies any object with a `summary` field as a calendar event | Surfaced on agent `22da09f7-d697-4072-8eaf-e1ef83df5a2e` ("Top AI App Releases — Weekly Blog Table Email"): step1 returned a real `chatgpt-research.research_topic` result with `summary` (research overview), `sources[5]`, and `key_points[]`. step2 (`ai_processing`) ran in 337ms with `tokensUsed: 0` (no LLM call); input collapsed `11221 → 2 chars` in preprocessing (`savingsPercent: "100.0"`, dev.log L9482-9485); WP-13 then correctly detected the now-empty input and short-circuited with `{items: []}` (dev.log L9486-9490, `reason: "input is null/undefined"`). step3 built an empty "no data" HTML body from the empty `top_items`; step4 emailed it. Trace: `DataPreprocessor.detectDataType()` matched `data.summary` at the `'event'` branch (DataPreprocessor.ts L199-207) — the clause was added for Google Calendar event titles but had no co-field guard, so any object with `summary` got routed to EventPreprocessor. `EventPreprocessor.validateEvents()` (L138-150) requires `startTime`/`start.dateTime` to keep an item; the research object has neither, so all "events" were filtered out and `cleanedInput` collapsed to ~2 chars. **Fix:** the `summary` clause now requires co-occurrence with a real event co-field (`start`, `end`, `startTime`, `organizer`, `attendees`). Google Calendar events always carry one of these, so detection is preserved; research/AI/extractor/summary outputs no longer false-positive. Same "silent data loss masked by a downstream guardrail" family as WP-13 / WP-32 / WP-40 — fix root cause (preprocessor false positive), not the symptom (the WP-13 short-circuit is doing its job). **Why this wasn't caught earlier:** the chatgpt-research plugin is recent enough that no regression scenario in `tests/v6-regression/scenarios/` exercises it; the AI summary / document-summarizer plugins that would have hit this earlier weren't combined with `ai_processing` downstream in any scenario. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-30 | WP-49 documented + fixed — `IntentToIRConverter.convertNotify()` now emits `cc` and `bcc` alongside `to` in `params.recipients` | Surfaced on agent `b4bda055-4f6d-403d-b5e5-52a143905fdf` ("Gantt Critical/High Tasks Due Soon — Email Summary"): user's Enhanced Prompt specified `recipients.to: meiribarak@gmail.com` AND `recipients.cc: offir.omer@gmail.com, eomer3@gmail.com`. Phase 1 IntentContract correctly carried both (`step.notify.recipients.cc[]` present in IR with `{kind:"config", key:"email_cc"}` — dev.log L7669–7674), but `IntentToIRConverter.ts` at both L1045-1054 (schema-aware branch) and L1095-1105 (fallback `isSendAction` branch) constructed `params.recipients = { to: ... }` with no projection of `cc`/`bcc`. Compiler's `[O11] Config key "email_cc" declared but never referenced in workflow` warning (dev.log L8361) correctly diagnosed the orphaned config key but didn't surface the upstream lossy projection. Compiled pilot_steps step11 had `recipients: { to: ["{{input.email_to}}"] }`; runtime `transformedParams` to Gmail (dev.log L28315–28329) had only TO; CC recipients silently never received the email. **Fix:** at both call sites, the existing `to: toList.map(...)` was extended with conditional spreads for `cc` and `bcc`, each guarded by `step.notify.recipients.cc?.length` / `.bcc?.length`. Workflows without CC/BCC produce identical output to pre-fix (no behavioural drift on existing scenarios); workflows that specify CC/BCC now have those recipients carried through to the plugin call. Sister to WP-1 (same `convertNotify` function — schema-driven binding) and WP-44 (Pipeline B's `formalization-system-v4.md` dropping `html_body` — same "EP fidelity loss" family). **Why this wasn't caught earlier:** none of the 10 active regression scenarios in `tests/v6-regression/scenarios/` specify CC or BCC recipients in their EP — every scenario's `notify.recipients` has only a `to[]`. Branch: `feature/v2-agent-creation-r2r3-toned-single-question`. |
| 2026-05-19 | WP-48 fixed — `/api/create-agent` migrated from direct supabase.insert to AgentRepository; auth hardened with getUser(); Zod validation added; Pino structured logging; supabase client per SUPABASE_CLIENTS.md; explicit created_at/updated_at timestamps | Pre-existing tech-debt violation surfaced during a code review prompted by the Pipeline A migration. The route violated five CLAUDE.md mandatory rules at once: direct supabase insert (rule #1), x-user-id header trust (rule #5), no Zod validation (rule #2), unconditional service-role client (rule #4), ~40 `console.*` calls instead of structured logging (rule #3 / `docs/SYSTEM_LOGGING_GUIDELINES.md`). Refactor: (a) extended `CreateAgentInput` in `lib/repositories/types.ts` from 7 fields → ~25 fields (covers the full agent persistence shape); (b) switched the insert to `new AgentRepository().create(...)`; (c) replaced `getUserIdFromRequest` with `getUser()` from `@/lib/auth` (Supabase SSR session cookie); (d) added `CreateAgentSchema` Zod validator with `.passthrough()` on the inner agent object; (e) migrated all `console.*` to Pino — module-scoped `createLogger`, per-request correlation ID + child logger, structured `(context, msg)` calls, `{ err: error }` error pattern, `duration` performance metrics on completion + error paths, child logger for the AIS subsystem block, dropped the emoji-laced ASCII separators that obscured the actual flow; (f) replaced the ad-hoc `createClient(... SUPABASE_SERVICE_ROLE_KEY ...)` with the documented `supabaseServer` singleton import per `docs/SUPABASE_CLIENTS.md` — the route now uses the canonical service-role server client for the `token_usage` SELECT and the AIS service call; (g) `AgentRepository.create()` now explicitly stamps `created_at` AND `updated_at` to the same `Date.now()` ISO timestamp so the two columns match exactly on creation (DB defaults could otherwise compute them at slightly different times under load). **Behaviour change worth flagging:** expired sessions now correctly return 401 instead of silently succeeding with a stale x-user-id header. **Why this wasn't caught earlier:** the violation predated the V2 UI integration and never failed a test because every test happened with a valid logged-in user; the security gap was latent. Branch: `feature/v6-v2-integration`. |
| 2026-05-19 | WP-47 fixed — V2 UI now pre-populates `resolvedInputs` from `v6Data.ir.config_defaults` (eliminates Pipeline A re-prompting) | User reported on 2026-05-19: after the Pipeline A migration, the V2 UI was re-prompting for input values the user had already provided in the conversational EP-build phase. Investigation traced this to a naming mismatch — Pipeline A's IC LLM uses its own keys for `config[]` (`spreadsheet_id`, `tab_name`) while EP `resolved_user_inputs` uses EP-Key-Hint format (`google-sheets__table/get__spreadsheet_id`). The V2 UI's `resolvedInputs` map was built from the EP keys, and the `requiredParams` filter (line 1190) used strict `input.name in resolvedInputs` lookup — so DSL-ref names (Source 1 of `extractInputSchema`) never matched. Pipeline B sidestepped this because its compiler inlines values into DSL params at compile time, leaving no `{{input.X}}` refs in `workflow_steps` for Source 1 to surface. **Fix:** ~12 LOC in `app/v2/agents/new/page.tsx` to merge `v6Data.ir.config_defaults` entries into `resolvedInputs` before the filter runs. IC LLM transcribed EP values into `config[].default` keyed by the same names the DSL's `{{input.X}}` refs use → exact match → filter correctly recognizes all IC keys as already-provided → user transitions directly to scheduling. Pipeline B unaffected (its response doesn't carry `ir.config_defaults` in a comparable shape; if it did, B's DSL has no `{{input.X}}` refs anyway). **New anti-pattern:** when two layers in a pipeline use different naming conventions for the same logical value, one bears the bridging cost — design the cheaper side to be the bridge. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-46 fixed — `transform/with_fields` with constants-only emits singleton object instead of per-item array | Surfaced at Stage P4 of the Pipeline A migration right after WP-45 was applied. step5 (priority filter) returned 4 rows; step6 (date filter using WP-45-resolved refs) STILL returned 0. Inspection: step4 (`with_fields` to compute `date_window`) produced an array of 57 row copies each augmented with the same constant `window_start`/`window_end`, not the singleton object the downstream filter expected. Same anti-pattern shape as WP-41 — LLM picked a transform whose runtime semantics don't match the intended use (`with_fields` is per-item augmentation; LLM intended singleton-constants). **Runtime tolerance fix:** new `isConstantExpression()` walks each field's expression tree; if ALL field expressions are constants (no `kind: "ref"` targeting `item.*`), evaluate once and return a singleton `{[fieldName]: value, ...}` object regardless of input array length. Per-item behavior unchanged when ANY field references `item.*`. **Validation:** end-to-end Phase E on `gantt-urgent-tasks-v2ui-pipeline-a` now produces step4 singleton `{window_start: "2026-05-18T00:00:00.000Z", window_end: "2026-05-21T00:00:00.000Z"}`, step6 filter returns 3 of 4 rows, real HTML email delivered with 3 tasks. **Compounding insight from WP-41 + WP-46:** when LLM picks a transform that's "almost right" but a different output shape, runtime tolerance is usually cleaner than IR rewriting or prompt steering. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-45 fixed — `ConditionalEvaluator` now resolves bare RefNames for all comparison operators + is date-aware for `gte`/`lte`/`gt`/`lt` | Surfaced at Stage P4 of the Pipeline A migration. Pipeline A's IntentContract LLM generated a date-range filter via direct `gte`/`lte` against `date_window.window_start` / `window_end` (the cleaner shape — Pipeline B routed through AI). Two compounding gaps in `ConditionalEvaluator.ts`: (a) bare-string variable refs only resolved for `in`/`not_in` (WP-22's narrow O26 fix) — `gte`/`lte` saw `"date_window.window_start"` as a literal; (b) `gte`/`lte`/`gt`/`lt` did raw `>=`/`<=`/`>`/`<` without calling `parseDate` — even resolved values would compare lexicographically. **Compounding root cause:** two `parseDate` implementations diverged — WP-29 (2026-05-11) hardened the W2 expression evaluator's parser but `ConditionalEvaluator` had its own private, weaker parser that never got the locale-aware DD/MM/YYYY support. **Three-part fix:** (a) `looksLikeBareVariableRef()` helper generalizes the defensive wrap to all comparison operators; (b) `compareAsDates()` helper makes `gte`/`lte`/`gt`/`lt` date-aware when both sides parse as dates, with fallback to native operators (numeric / string comparisons unchanged); (c) private `parseDate` now delegates to the shared WP-29 parser — eliminates the duplicate parser, makes `before` / `after` / `within_last_days` also benefit from locale awareness. **Validation:** end-to-end Phase E on `gantt-urgent-tasks-v2ui-pipeline-a` confirmed 3 real tasks delivered in HTML email. **New anti-pattern surfaced:** "runtime helpers that look the same should BE the same" — duplicate `parseDate` implementations diverging in hardening is the helper-library-level shape of the WP-21/22/25/28 runtime-tolerance family. Worth a V6_DESIGN_PRINCIPLES Principle 12 candidate. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-44 documented — V6 formalization drops EP HTML/format requirements | Surfaced at Stage 1.2f on `gantt-urgent-tasks-v2ui` after WP-39/40/41/42/43 fixed the runtime cascade and AI extraction. User received an email with the 3 correct tasks but formatted as a plain-text ASCII-pipe table — despite the EP saying "HTML" 6 times and naming `html_body` explicitly. Root cause: V6 IRFormalizer (using `formalization-system-v4.md`) authored step8's AI prompt as "Create a concise **plain-text** email body" and step9's send params as `content.body` instead of `content.html_body`. The previous `gantt-urgent-tasks` scenario (via the old IntentContract pipeline) handled this correctly — V6 regressed. Same anti-pattern family as WP-43 (Phase 3 LLM dropping EP-level user requirements). **Fix deferred** — bundle with WP-43 Option A in a "Phase 3 prompt-fidelity audit" follow-up session. Two angles documented: (A) extend `formalization-system-v4.md` to teach the LLM to scan EP for format keywords + plugin-param names and preserve them; (B) compiler-side rewrite (less attractive — brittle compensation). New WP-44 added to V6_OPEN_ITEMS.md P1. |
| 2026-05-17 | WP-43 fixed — ai_processing prompts now include named-key shape hint + current date anchor | Surfaced after WP-39/40/41/42 fixed all runtime errors on the V2-UI `gantt-urgent-tasks` agent — pipeline ran 7/7 steps but sent a "no tasks matched" email despite 3 visible tasks in the data. **Two compounding gaps** in `ai_processing` prompt context: (a) the Phase 3 LLM authored the AI instruction using column-letter references inherited from the user's EP wording ("Use column A as task_name…") but the data had been auto-converted to named-key objects by upstream `rows_to_objects`; (b) the instruction said "due_date within the next 3 days relative to now" but no concrete "now" was ever provided to the model, so it had no reference for date filtering and conservatively returned empty. **Option B (runtime preamble) chosen and applied:** ~30 LOC in `StepExecutor.executeLLMDecision` prepends two short anchors to every `ai_processing` prompt when input is an array of objects — `INPUT DATA SHAPE` (named keys + positional aliases) and `CURRENT DATE` (ISO + human form with DD/MM/YYYY locale hint). **Validation:** end-to-end Phase E re-run extracted 3 real tasks (`Employee signature - Marketing mail` / `Social – linkedin and Facebook pages - AgentsPilot` / `Global market research / Product & Competitive Analysis`), email routed to the have-tasks branch with real content. **Option A (formalization-system-v4.md prompt extension)** queued as a follow-up — the runtime preamble is defense in depth; ideally the Phase 3 LLM never authors column-letter language in `ai_processing.instruction` to begin with. **Surfaces a new anti-pattern:** "prompt-context completeness is a platform responsibility" — LLMs need deterministic anchors (today's date, data shape, etc.) injected by the runtime; relying on the model to infer them from training context is unreliable. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-42 fixed — Gmail plugin tolerates string `recipients.to/cc/bcc` from LLM emission; `countRecipients` no longer counts characters | Surfaced at Stage 1.2d live Phase E run, the final step9 (`google-mail.send_email`) blocker after WP-39 + WP-40 + WP-41 fixes unblocked the cascade. `recipients.to: "meiribarak@gmail.com"` (string) → `.map()` threw `TypeError: recipients.to.map is not a function`. **Two-part fix:** (a) new `toEmailArray()` helper at the top of `buildEmailMessage()` coerces string → `[string]` and passes arrays through unchanged; applied uniformly to to/cc/bcc. (b) `countRecipients()` in `base-plugin-executor.ts` patched with typed counter (array → length, non-empty string → 1, else → 0) — was previously counting string LENGTH (returning ~20 for a single email), silently inflating the `total_recipients > 10` validation rule. Same runtime-tolerance pattern as WP-21/22/25/28 — plugin-executor-boundary coercion for LLM emission styles that don't match strict schema contracts. **Validation:** end-to-end Phase E on `gantt-urgent-tasks-v2ui` now passes 7/7 steps with real email delivered to meiribarak@gmail.com. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-41 fixed — `select` restored as a runtime transform op (Option A); compiler D-B18 alias split so `select` is preserved | Chose Option A from the three intervention points documented in the original WP body. **Runtime:** new `case 'select'` in `StepExecutor.executeTransform` (lines ~2471 area) that builds a single object from `effectiveConfig.fields` (values already resolved by `resolveAllVariables` at step entry — implementation is a shallow clone). **Compiler:** D-B18 alias block split into two arms — `select` is preserved (no rename, just a logging breadcrumb); `custom` still aliases to `map` for now. Net runtime diff: ~12 lines; net compiler diff: ~6 lines refactor of the existing alias block. **Validation:** Phase E on `gantt-urgent-tasks-v2ui` step3 now emits a single wrapper object `{rows, range, row_count, column_count, retrieved_at}` (was 57 copies of literal config); cascade runs cleanly through steps 1-8. Step9 then failed with WP-42 (gmail string-recipient bug), which was fixed in a separate runtime-tolerance pass — see WP-42 row above. **Anti-pattern surfaced:** "backwards-compat aliases must be semantic, not syntactic" — added to DESIGN_PRINCIPLES Principle 11 Evidence alongside WP-39 and WP-40. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-41 documented — D-B18 `select` → `map` alias is syntactic, not semantic | Surfaced during Stage 1.2c live Phase E run, immediately after both WP-39 and WP-40 fixes landed. step3 in the gantt-urgent-tasks-v2ui scenario still fails downstream because the LLM emitted `transform.type: "select"` (object construction from source-level refs) and D-B18 only relabels the type to `"map"` (per-item iteration over an array). The two operations have different semantics: `select` produces ONE wrapper object; `map` produces an array. Result: step3 emits 57 copies of the literal config object instead of a single wrapper; downstream `{{sheet_rows_wrapper.rows}}` resolves to undefined. **Three intervention options** documented in the WP body: (A) restore `select` as a runtime transform op (smallest surgery), (B) compile-time semantic translation to `with_fields` or input inlining (most architecturally correct), (C) Phase 1 prompt steering away from `select` emission (most fragile). Choice deferred to a focused follow-up session. **New anti-pattern observation:** "Backwards-compat aliases must be semantic, not syntactic" — worth a new V6_DESIGN_PRINCIPLES principle or an extension of Principle 11. Same alias mechanism works correctly for `deduplicate → dedupe` (lines 680-682) because those ARE semantically equivalent. **Why not caught earlier:** regression-scenario phase4 snapshots pre-date D-B18 or were hand-edited; Phase D mock executor is permissive on `map`'s per-item semantics. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-40 fixed — `IRFormalizer.validateIRStructure` no longer corrupts filter input paths via blind-guess auto-correction | Surfaced during Stage 1.2c of V6 ↔ V2 integration, the next failure after the WP-39 fix unblocked step3 on the V2-UI `gantt-urgent-tasks` agent. The validator's "auto-correction" for filter operations whose input variable is declared as non-array blindly appended field names from a hardcoded list `['attachments', 'items', 'results', 'data', 'list', 'records']` and broke on the FIRST one — without checking the schema. The LLM had correctly emitted `transform.input: {{sheet_rows_wrapper.rows}}` (an array nested in a wrapper object); the validator looked up the bare `sheet_rows_wrapper`, saw type `object`, and "fixed" the path to `{{sheet_rows_wrapper.rows.attachments}}`. Runtime resolved to `undefined` → "Transform step has no input data" → cascade abort. **Fix:** replaced the blind-guess loop with a check that bypasses the type validation when `transform.input` already accesses a nested field of the input variable (i.e. trust the LLM when it's being explicit). Filters that pass a bare wrapper as input still throw a clear validation error pointing at the right shape. The schema-aware `autoFixFilterTransforms` (line 1846+, which uses skeleton `filter_hints`) is unchanged — that's the legitimate auto-fix path. **Hidden by misleading log:** the validator emitted `WARN: Auto-corrected filter input` as if it had fixed something — actually CAUSED the corruption. Same Principle-11 anti-pattern shape as WP-39. **Why not caught earlier:** the two scenarios that legitimately use `.attachments` (`po-monitor-supplier-confirmation`, `aliexpress-delivery-tracker`) operate on email data that genuinely has an `attachments` field, so the heuristic happened to resolve correctly — looked "smart" but was always coincidence. **No unit test yet** (validator's surface area requires a synthetic IR); tracked as Stage 1 follow-up. Branch: `feature/v6-v2-integration`. |
| 2026-05-17 | WP-39 fixed — `ExecutionGraphCompiler` D-B18 alias now updates `pilotOperation` in addition to `transformConfig.type`/`transformedConfig.type` | Surfaced during Stage 1.2b of V6 ↔ V2 integration: V2-UI-generated `gantt-urgent-tasks` agent failed at runtime step3 with `Unknown transform operation: select`. Root cause: the compiler's `select`/`custom` → `map` alias (lines 683-689) only updated the IR-side and DSL-side `config.type` fields, not the `pilotOperation` variable (line 579) that flows into `step.operation` (line 895). Result: compiled step had `operation: "select"` at top level despite `config.type: "map"`, runtime's transform switch rejected it. **Fix:** one-line `pilotOperation = 'map'` inside the alias block + 5-line comment explaining the variable-flow chain that makes this necessary. **Hidden by misleading log:** the alias log message said "Aliased 'select' → 'map'" but only did half the work — violates V6_DESIGN_PRINCIPLES Principle 11 (Defense in depth must not hide failures). **Related observation:** `deduplicate → dedupe` alias has the same incomplete-update pattern (lines 680-682); runtime currently handles both so it doesn't surface, but worth a follow-up pass. **Why not caught earlier:** regression scenarios use committed phase4 snapshots that don't contain `operation: "select"` — this is the first end-to-end LLM-generated DSL run from the V2 UI. **No unit test yet** (heavy setup for the compiler); tracked as Stage 1 follow-up. Branch: `feature/v6-v2-integration`. |
| 2026-05-11 | WP-31 fixed — `today` returns UTC-midnight calendar day; `date_diff` measures whole calendar-day deltas | Phase E on `gantt-urgent-tasks` after WP-29/30 landed produced only 1 of 3 expected tasks in the summary email because `today` returned `new Date().toISOString()` (current moment) and `date_diff(date_only, today, 'days')` computed fractional-days floor → tasks finishing "tomorrow" rounded to `days_until_finish = 0`, failing the `1 ≤ days_until_finish ≤ 3` filter. **Three-part fix:** (A) `case 'today'` returns midnight UTC of the current calendar day (optionally in user's local timezone via WP-29's `getUserTimezone()` hook). (B) `case 'date_diff'` with `unit: 'days'` defensively normalizes both sides to UTC midnight before computing diff (uses `Math.round` for DST-safety). (C) `case 'date_add'` keeps existing semantics; combined with the new midnight `today`, `today + N days` is exactly N×24h later. 12 new unit tests covering `today` semantics, midnight-normalization, time-of-day edge cases (00:01 vs 23:59 of prev day → 1 day, not 0), and integration with `date_add` / DD/MM input. **251/251 known-good tests passing** (was 239 before WP-31). User confirmed Phase E now produces 3 tasks as expected. |
| 2026-05-11 | WP-29 + WP-30 fixed — date parsing locale-aware + config/ref expressions wrap path in `{{}}` | Both bugs surfaced during gantt-urgent-tasks Phase E "no data" cascade. **WP-29:** new three-tier disambiguation in `parseDate` — ISO → unambiguous (day or month > 12) → user-timezone-driven (via new `IExpressionContext.getUserTimezone()` hook) → DD/MM default. `ExecutionContext` populates from `inputValues._user_timezone` (or `user_timezone`) — WorkflowPilot can wire from the user-context system. New `buildDate()` validates day/month overflow. **WP-30:** one-line wrap of bare paths in `{{}}` before `resolveVariable` for both `config` AND non-`item` `ref` cases (audit found `ref` had the same convention mismatch). Mirrors WP-22's runtime defensive wrap. **Tests:** 34 new tests in `StructuredTransforms.wp29-wp30.test.ts` — Tier 0/1/2 disambiguation, 6 timezones, edge cases, canonical gantt scenario, config/ref resolution with strict stub mirroring production `resolveVariable`. **239/239 known-good tests passing** (was 205 before WP-29/30). |
| 2026-05-11 | WP-29 + WP-30 documented — gantt-urgent-tasks Phase E "no data" cascade from date parsing + config-expression bugs | Phase E on `gantt-urgent-tasks` succeeded structurally (11/11 steps) but produced an empty-state email despite real Sheet data. Two compounding W2 Expression-evaluator bugs identified: (a) **WP-29** — `parseDate` uses `new Date()` which interprets `"12/5/2026"` (user's DD/MM/YYYY Sheet) as Dec 5 → `days_until_finish` returns 207 instead of 1. (b) **WP-30** — `case 'config'` in `evaluateExpression` calls `resolveVariable('input.X')` with a bare path; production runtime requires `{{...}}` so it returns the literal string → `Number()` = NaN → `date_add` returns null → `window_end` null in every row. Cascade: step7 filter on `days_until_finish` (wrong values) AND `<= date_window_days` (config ref broken) drops all rows. Both bugs likely silently broken since W2 (WP-16) shipped — W2 unit tests use a permissive stub that hides both. **WP-29 design:** three-tier — (1) unambiguous detection (day or month > 12 self-resolves), (2) user-timezone-driven locale via new `IExpressionContext.getUserTimezone()` hook (per user suggestion — more principled than a fixed default), (3) explicit `date_format` workflow_config hint (deferred). Tier 1+2 bundled in fix. **WP-30 design:** one-line wrap path in `{{}}` before `resolveVariable`, mirroring WP-22's fix. Audit also identified the `ref` case (non-`item` slot refs) has the same bare-path bug — same wrap fix applies. Fix to follow as one commit bundle. |
| 2026-05-11 | WP-28 fixed — `parsePositionalKey()` now handles SOURCE keys in `field_mapping` (mirrors WP-25 target-side) | Phase E on `leads-email-summary` succeeded structurally (7/7 steps) but produced an empty-state email despite real Sheet data. step3 emitted `field_mapping: {Date: "0", "Lead Name": "1", ...}` — bare numeric SOURCE keys, the LLM's "give me column N from each row" emission. WP-SR's source-side regex only matched `column_<digit>`; bare `"0"` fell through to literal property access on the post-`rows_to_objects` object → undefined → empty objects → empty filter → "No data available." Two-layer fix mirroring WP-25: (a) runtime — replaced `COLUMN_N` regex with `parsePositionalKey()` on source side, recognizing all 4 patterns (numeric, column_N, Excel letter, column_letter); literal key lookup still wins when it succeeds for backward compat. (b) prompt — extended TRANSFORM section's MAP guidance with "Mapping `from` field — canonical form" subsection: use named source fields when producer emits objects; positional descriptors are tolerated but discouraged. 9 new unit tests in `transformMap.numeric-keys.test.ts` covering canonical leads-email-summary pattern, all 4 source patterns + WP-SR regression guard + literal-key-wins backward compat + raw-2D-array path + out-of-range. **205/205 known-good tests passing** (was 196 before WP-28). |
| 2026-05-11 | WP-26 + WP-27 documented — Sheets append failure modes on header-less / sparse-data sheets | Phase E re-run on `complaint-email-logger` after WP-25 succeeded structurally (no errors, 10/10 steps), but two operational issues surfaced: (a) duplicate rows appended because `set_difference` dedup silently failed — root cause: O23 optimization in `normalizeDataFormats` doesn't recognize `project_column.by_index` config shape, so `rows_to_objects` gets auto-injected unnecessarily and consumes the only data row as a header when the sheet has no header row → empty `existing_message_ids` reference → no dedup. (b) rows shifted to column E because Sheets `append_rows` table-detection found a discontinuity at the empty D column in legacy pre-WP-24 row(s). Documented as WP-26 (O23 detection gap) and WP-27 (range normalization for append_rows). Both deferred — user workaround: add header row to the destination sheet (resolves both symptoms operationally). Compiler-side fix tracked for the next iteration. |
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
