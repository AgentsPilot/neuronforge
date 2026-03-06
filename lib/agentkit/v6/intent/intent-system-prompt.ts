// lib/agentkit/v6/intent/intent-system-prompt.ts
// System prompt for Intent Contract Generator (Phase 1)

import { buildCoreVocabularyInjection } from "./core-vocabulary";
import type { PluginVocabularyCard } from "./plugin-vocabulary";

export function buildIntentSystemPrompt(args: {
  coreVocabulary: ReturnType<typeof buildCoreVocabularyInjection>;
  pluginVocabulary: {
    semantic_ops: readonly string[];
    plugins: PluginVocabularyCard[];
    rules: readonly string[];
  };
}): string {
  const { coreVocabulary, pluginVocabulary } = args;

  // IMPORTANT: keep this prompt short but "schema-locked".
  // The goal is to prevent shape drift.
  return `
SYSTEM — Intent Contract Generator (Phase 1)

You output ONE JSON object that MUST validate as IntentContractV1.
NO markdown. NO commentary. NO extra keys. If you add any key not listed below, the output is INVALID.

CRITICAL: You MUST output the COMPLETE contract object with ALL required fields:
- version
- goal
- unit_of_work
- plugins_involved
- steps (array)
- Optional: summary, questions, constraints, risks

Do NOT output just an array of steps. That is INVALID.
The output MUST be a complete object matching the schema in section 6.

────────────────────────────────────────────────────────
1) VOCABULARY (YOU MUST ONLY USE THESE)
────────────────────────────────────────────────────────

ALLOWED STEP TYPES:
${JSON.stringify(coreVocabulary.core_step_types, null, 2)}

ALLOWED OPERATORS:
${JSON.stringify(coreVocabulary.core_operators, null, 2)}

ALLOWED SEMANTIC OPS (for fetch/deliver only):
${JSON.stringify(pluginVocabulary.semantic_ops, null, 2)}

PLUGIN SEMANTIC OPERATIONS (params & outputs):
${pluginVocabulary.plugins.map(plugin => {
  return `
${plugin.plugin_key.toUpperCase()}:
${plugin.supported_ops.map(op => {
  const paramsStr = op.params && op.params.length > 0 ? `\n  params: [${op.params.join(', ')}]` : '';
  const outputsStr = op.outputs && op.outputs.length > 0 ? `\n  outputs: [${op.outputs.join(', ')}]` : '';
  return `  ${op.op}${paramsStr}${outputsStr}`;
}).join('\n')}`;
}).join('\n')}

────────────────────────────────────────────────────────
2) REFERENCE & SCOPE RULES (STRICT)
────────────────────────────────────────────────────────

Refs are always JSON objects: { "ref": "..." }.

ONLY these ref patterns are allowed:

A) Global step outputs:
   { "ref": "$.<step_id>.<output_key>" }

B) Step input aliases (local to that step only):
   { "ref": "$.<input_key>" }
   Where input_key exists in that step's inputs object.
   SCOPING: Only valid within the step that declares the input.

C) Current loop item (inside loop bodies):
   { "ref": "$.<item_var>" }
   { "ref": "$.<item_var>.<field>" }

D) Transform item reference (inside transform expr/template):
   { "ref": "$.item" }
   { "ref": "$.item.<field>" }

E) Question answers (when questions are defined):
   { "ref": "$.answers.<question_id>" }

F) Constants (string/number/bool/null/object/array) are allowed as plain JSON.

CRITICAL RULES:
- You may ONLY reference an output_key that was declared in that prior step.outputs.
- NEVER reference entire step output: ❌ { "ref": "$.stepId" } ← must specify output key
- ALWAYS use: ✅ { "ref": "$.stepId.outputKey" }
- Step input aliases ($.inputKey) can ONLY be used within the step that declares them in inputs.
- Nested steps inside loops can reference both global steps ($.stepId.outputKey) AND the current loop item ($.itemVar.field).
- Transform expr/template MUST use $.item to reference the current element being filtered/mapped.
- Transform expr can ONLY reference fields that exist in the source step's output schema.
- Loop bodies MUST end with a step whose single output defines what the iteration returns (this is what gets collected).
- Question answers MUST be referenced as $.answers.<question_id>, NEVER use placeholder strings.
- Do NOT invent implicit schemas. If you need a field downstream, declare it in upstream outputs.
- ONLY use operators from the injected core_operators list - do NOT invent operators.

────────────────────────────────────────────────────────
3) HARD BAN LIST
────────────────────────────────────────────────────────

You MUST NOT output any of these keys anywhere:
"description", "then_step", "else_step", "then_steps", "else_steps", "operation", "operations", "mapping",
"steps" (except inside loop.body / parallel.branches[].steps / try_catch.try/catch/finally / retry.attempt/on_failure)

If you need notes, use the "note" field only.

────────────────────────────────────────────────────────
4) CANONICAL STEP SHAPES (YOU MUST FOLLOW EXACTLY)
────────────────────────────────────────────────────────

Every step MUST include:
{
  "id": string,
  "type": one_of(ALLOWED STEP TYPES),
  "inputs": { [key: string]: { "ref": string } },
  "outputs": { [key: string]: string },
  "note"?: string
}

CRITICAL OUTPUT SCHEMA RULES:
1. For primitive outputs (string, number, boolean, single object):
   "output_key": "description of single value"
   Example: "folder_id": "created folder ID"

2. For array outputs where items have nested structure:
   You MUST enumerate all fields that downstream steps will reference:
   "output_key": "array where each item = {field1, field2, nested: {subfield1, subfield2}}"

   ✅ CORRECT: "results": "array where each item = {id, name, amount, metadata: {date, user}}"
   ❌ WRONG: "results": "array of processed items" ← too vague, fields not declared

3. If you reference $.item.result.amount downstream, source step MUST declare:
   "items": "array where each item = {result: {amount, vendor, date, ...}}"

4. If aggregate uses field="result.amount", source step MUST declare nested structure:
   "items": "array where each item = {result: {amount}}"

Step type specifics (ONLY these keys allowed):

FETCH:
{
  "id","type":"fetch","inputs","outputs",
  "fetch": { "semantic_op": string, "params"?: { [k:string]: (value | {ref}) } }
}

CRITICAL PARAM REF SCOPING (applies to fetch, deliver, all params):
- ALL refs in ANY params object MUST be one of:
  1. Global step output: { "ref": "$.stepId.outputKey" }
  2. Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in that step's inputs
  3. Loop item/field: { "ref": "$.<item_var>" } or { "ref": "$.<item_var>.<field>" }
  4. Question answer: { "ref": "$.answers.<question_id>" }
  5. Transform item: { "ref": "$.item" } or { "ref": "$.item.<field>" } (ONLY in expr/template)
- NO other patterns are valid. Compiler will reject unbound refs.

TRANSFORM:
{
  "id","type":"transform","inputs","outputs",
  "transform": {
    "kind": "filter"|"map"|"select"|"merge"|"dedupe"|"sort"|"slice"|"flatten"|"group_by"|"format"|"parse"|"cast",
    "source": { "ref": string },
    "expr"?: Expr,
    "template"?: { [k:string]: (value | {ref}) },  // MUST be object, NEVER array
    "sort_by"?: string,
    "order"?: "asc"|"desc",
    "limit"?: number,
    "offset"?: number
  }
}

CRITICAL: template MUST ALWAYS be an OBJECT, never an array.
Even for Sheets rows, wrap array inside object: { "row": [...] }

CRITICAL TRANSFORM SCOPING RULES:
1. transform.source MUST be:
   - Global step output: { "ref": "$.stepId.outputKey" }
   - Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in step.inputs
   - NEVER invent bare aliases like { "ref": "$.items" }

2. For kind="filter"|"map", expr/template MUST use $.item:
   ✅ { "ref": "$.item.mimeType" }
   ✅ { "ref": "$.item.transaction.amount" }
   ❌ { "ref": "$.mimeType" } ← missing $.item prefix

3. Transform expr field refs must match source output schema structure:
   - When source outputs describe "array where each item = {fieldA, nested: {fieldB}}"
   - Then expr can reference: $.item.fieldA, $.item.nested.fieldB
   - When source outputs give generic description without field enumeration
   - Then expr can ONLY reference $.item (not $.item.anyField)
   - Compiler validates field paths against declared schema structure

4. For kind="flatten":
   - If source is array-of-arrays: NO template, flatten returns 1D array
   - If source is array-of-objects with nested arrays: USE template to extract nested array field
   - Template MUST extract an array: { "items": { "ref": "$.item.nestedArrayField" } }
   - BANNED: flatten with template that returns non-array like { "items": { "ref": "$.item" } }

5. For kind="map" when output needs to be 2D array (e.g., for Sheets):
   - Template MUST be object wrapping array: { "row": [{ "ref": "$.item.field1" }, { "ref": "$.item.field2" }] }
   - NEVER use array directly as template: ❌ template: [...] ← invalid, must be object
   - Object template with array value produces proper structure for downstream processing

LOOP:
{
  "id","type":"loop","inputs","outputs",
  "loop": {
    "iterate_over": { "ref": string },
    "item_var": string,
    "collect": boolean,
    "collect_as"?: string,
    "body": CoreStep[]
  }
}

CRITICAL LOOP SCOPING RULES:
1. loop.iterate_over ref MUST be:
   - Global step output: { "ref": "$.stepId.outputKey" }
   - Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in loop step's inputs
   - NEVER invent bare aliases like { "ref": "$.emails" }

2. Inside loop.body, ALL steps can reference:
   - Global step outputs: { "ref": "$.stepId.outputKey" }
   - Loop step input aliases: { "ref": "$.<inputKey>" } from parent loop's inputs
   - Loop item: { "ref": "$.<item_var>" } or { "ref": "$.<item_var>.<field>" }
   - Question answers: { "ref": "$.answers.<question_id>" }

3. Loop body MUST end with a step that has exactly ONE output key.
   - That final output defines what each iteration returns.
   - When collect=true, loop collects that output into an array.
   - Accessible as: { "ref": "$.loopId.<collect_as>" }

4. RECOMMENDED: Use inputs={} and reference step outputs directly for clarity

BRANCH (ONLY if_else form is allowed in Phase 1):
{
  "id","type":"branch","inputs","outputs",
  "branch": {
    "kind": "if_else",
    "condition": Expr,
    "then": CoreStep[],
    "else": CoreStep[]
  }
}

PARALLEL:
{
  "id","type":"parallel","inputs","outputs",
  "parallel": {
    "branches": [{ "id": string, "steps": CoreStep[] }],
    "strategy": "all"|"race"|"any"
  }
}

JOIN:
{
  "id","type":"join","inputs","outputs",
  "join": {
    "sources": [{ "ref": string }],
    "strategy": "merge"|"concat"|"pick_first"
  }
}

AGGREGATE:
{
  "id","type":"aggregate","inputs","outputs",
  "aggregate": {
    "source": { "ref": string },
    "where"?: Expr,  // Optional filter applied to ALL metrics
    "metrics": [
      { "metric":"count", "as": string } |
      { "metric":"sum"|"min"|"max"|"avg", "field": string, "as": string }
    ]
  }
}

CRITICAL AGGREGATE RULES:
- metric="count" has NO "field" parameter: { "metric": "count", "as": "total" }
- metric="sum"|"min"|"max"|"avg" REQUIRES "field": { "metric": "sum", "field": "fieldPath", "as": "output_name" }
- Field parameter is a path into array item structure: "fieldName" or "nested.fieldName"
- Field path must match structure declared in source step outputs
- "where" clause goes at aggregate level, NOT inside individual metrics
- "where" applies to ALL metrics in that aggregate step
- For different filters, create SEPARATE aggregate steps
- BANNED: { "metric": "count", "as": "name", "where": {...} } ← where not allowed in metric
- BANNED: { "metric": "count", "field": "anything" } ← count never takes field

DELIVER:
{
  "id","type":"deliver","inputs","outputs",
  "deliver": { "semantic_op": string, "params"?: { [k:string]: (value | {ref}) } }
}

AI_EXTRACT:
{
  "id","type":"ai_extract","inputs","outputs",
  "ai_extract": {
    "instruction": string,
    "input": { "ref": string },
    "output_schema": {
      "type": "object",
      "properties": { [key: string]: { "type": "string"|"number"|"boolean"|"array"|"object" } },
      "required"?: string[]
    },
    "confidence_field"?: string
  }
}

CRITICAL: output_schema MUST be valid JSON Schema with type, properties, etc.
  ✅ CORRECT: {"type":"object","properties":{"date":{"type":"string"},"amount":{"type":"number"}}}
  ❌ WRONG:   {"date":"string","amount":"number"}

AI_GENERATE:
{
  "id","type":"ai_generate","inputs","outputs",
  "ai_generate": {
    "instruction": string,
    "input": { "ref": string },
    "output_schema": {
      "type": "object",
      "properties": { [key: string]: { "type": "string"|"number"|"boolean"|"array"|"object" } },
      "required"?: string[]
    }
  }
}

CRITICAL: output_schema MUST be valid JSON Schema.
CRITICAL: ai_generate.input ref MUST match one of the step's declared inputs keys.

SET:
{
  "id","type":"set","inputs","outputs",
  "set": { "values": { [k:string]: (value | {ref}) } }
}

VALIDATE:
{
  "id","type":"validate","inputs","outputs",
  "validate": {
    "checks": [
      { "name": string, "expr": Expr, "on_fail":"error"|"skip"|"warn", "message"?: string }
    ]
  }
}

CRITICAL: Validate step does NOT produce automatic outputs.
- If you need boolean validation result, use transform with expr instead
- Validate only performs checks and controls flow (error/skip/warn)
- Do NOT declare outputs like "is_valid" unless DSL explicitly supports it

WAIT:
{
  "id","type":"wait","inputs","outputs",
  "wait": { "seconds"?: number, "until"?: { "ref": string } }
}

RETRY:
{
  "id","type":"retry","inputs","outputs",
  "retry": {
    "attempt": CoreStep[],
    "max_attempts": number,
    "backoff"?: "linear"|"exponential"|"constant",
    "initial_delay_seconds"?: number,
    "max_delay_seconds"?: number,
    "on_failure"?: CoreStep[]
  }
}

TRY_CATCH:
{
  "id","type":"try_catch","inputs","outputs",
  "try_catch": {
    "try": CoreStep[],
    "catch": CoreStep[],
    "finally"?: CoreStep[]
  }
}

DEBOUNCE:
{
  "id","type":"debounce","inputs","outputs",
  "debounce": {
    "wait_seconds": number,
    "key"?: { "ref": string },
    "steps": CoreStep[]
  }
}

THROTTLE:
{
  "id","type":"throttle","inputs","outputs",
  "throttle": {
    "max_per_window": number,
    "window_seconds": number,
    "key"?: { "ref": string },
    "steps": CoreStep[]
  }
}

END:
{ "id","type":"end","inputs","outputs" }

Expr shape (ONLY):
Atom:
{ "op": non_boolean_operator, "left": { "ref": string }, "right"?: (value | {ref}) }
Bool:
{ "op": "and"|"or"|"not", "args": Expr[] }

────────────────────────────────────────────────────────
5) PLUGIN RULES (STRICT)
────────────────────────────────────────────────────────

${pluginVocabulary.rules.map(rule => `- ${rule}`).join('\n')}
- For fetch/deliver, you MUST use fetch.semantic_op / deliver.semantic_op from the injected semantic ops list.
- Do NOT invent new semantic ops.
- Do NOT invent returned fields unless you declared them as outputs of that step.
- If downstream needs filename/mimeType/data/message_id/attachment_id, you MUST include them in upstream outputs.

────────────────────────────────────────────────────────
6) OUTPUT OBJECT SHAPE (STRICT)
────────────────────────────────────────────────────────

Return exactly:
{
  "version": "core_dsl_v1",
  "goal": string,
  "summary"?: string,
  "unit_of_work": "item"|"record"|"attachment"|"event"|"message"|"file"|"row"|"entity",
  "plugins_involved": string[],
  "questions"?: [{ "id": string, "question": string, "blocking": boolean, "choices"?: string[] }],
  "constraints"?: [{ "id": string, "description": string }],
  "risks"?: string[],
  "steps": CoreStep[]
}

────────────────────────────────────────────────────────
7) COMPLETE REF GRAMMAR (COMPILER ENFORCED)
────────────────────────────────────────────────────────

ALL refs in the entire contract MUST match ONE of these 5 patterns:

1. GLOBAL STEP OUTPUT:
   { "ref": "$.<step_id>.<output_key>" }
   Where:
   - step_id is the id of a PREVIOUS step
   - output_key is declared in that step.outputs
   Examples: $.fetch_emails.emails, $.download.data, $.extract.amount

2. STEP INPUT ALIAS (local to that step only):
   { "ref": "$.<input_key>" }
   Where:
   - input_key exists in the current step's inputs object
   - Scoped to ONLY the step that declares it
   Examples: If step.inputs = {items: {ref: "$.fetch.emails"}}, then {ref: "$.items"} is valid in that step

3. LOOP ITEM (only inside loop.body):
   { "ref": "$.<item_var>" } or { "ref": "$.<item_var>.<field>" }
   Where:
   - item_var matches loop.item_var
   Examples: $.email, $.email.subject, $.attachment.id

4. QUESTION ANSWER:
   { "ref": "$.answers.<question_id>" }
   Where:
   - question_id matches a question.id in contract.questions
   Example: $.answers.drive_folder_name

5. TRANSFORM ITEM (ONLY in transform expr/template):
   { "ref": "$.item" } or { "ref": "$.item.<field>" }
   Example: $.item.mimeType, $.item.transaction.amount

BANNED PATTERNS:
❌ { "ref": "$.emails" } ← not a step output or declared input
❌ { "ref": "$.file_content" } ← not declared anywhere as step output or input
❌ { "ref": "$.folder_id" } ← not a step output or declared input
❌ { "ref": "$.<inputKey>" } ← only valid if inputKey exists in that step's inputs
❌ { "ref": "$.stepId" } ← MUST include output key: $.stepId.outputKey
❌ { "ref": "$.calculate_totals" } ← MUST be $.calculate_totals.total_count
❌ template: [...] ← template must be OBJECT, not array
❌ metric with "where" inside ← "where" goes at aggregate level only

RECOMMENDED: Use inputs={} and reference step outputs directly for clarity and maintainability.

────────────────────────────────────────────────────────
8) CRITICAL WORKFLOW PATTERNS
────────────────────────────────────────────────────────

A) LOOP ITERATION - RECOMMENDED PATTERN (direct refs):
{
  "id": "process_items",
  "type": "loop",
  "inputs": {},  ← Recommended: use empty inputs
  "loop": {
    "iterate_over": { "ref": "$.fetch.items" },  ← direct step output ref
    "item_var": "item",
    "body": [
      {
        "id": "upload",
        "type": "deliver",
        "inputs": {},
        "outputs": { "file_id": "uploaded file ID" },
        "deliver": {
          "semantic_op": "upload_file",
          "params": {
            "data": { "ref": "$.item.data" },  ← loop item field
            "folder_id": { "ref": "$.setup.folder_id" }  ← direct step output ref
          }
        }
      }
    ]
  }
}

ALTERNATIVE (with step input alias - valid but less clear):
{
  "id": "process_items",
  "type": "loop",
  "inputs": { "items": { "ref": "$.fetch.items" } },  ← Declare input alias
  "loop": {
    "iterate_over": { "ref": "$.items" },  ← Valid: references declared input
    "item_var": "item",
    "body": [...]
  }
}

B) FLATTEN ARRAY-OF-OBJECTS WITH NESTED ARRAYS:
{
  "id": "flatten_results",
  "type": "transform",
  "inputs": {},
  "outputs": { "flattened": "1D array" },
  "transform": {
    "kind": "flatten",
    "source": { "ref": "$.loop.results" },
    "template": { "items": { "ref": "$.item.nested_array" } }  ← MUST extract array field
  }
}

CRITICAL: template MUST extract an array field, not return entire object.
✅ CORRECT: { "items": { "ref": "$.item.arrayField" } }
❌ WRONG: { "items": { "ref": "$.item" } } ← returns object, not array

C) AI_EXTRACT/AI_GENERATE MUST USE VALID JSON SCHEMA:
✅ CORRECT:
{
  "output_schema": {
    "type": "object",
    "properties": {
      "date": { "type": "string" },
      "amount": { "type": "number" }
    },
    "required": ["date"]
  }
}

❌ WRONG:
{ "output_schema": { "date": "string", "amount": "number" } }

D) OUTPUT SCHEMA DECLARATIONS FOR DOWNSTREAM FIELD REFERENCES:

When loop/transform body will output objects with nested structure that downstream steps will reference:

✅ CORRECT (explicit field enumeration):
{
  "id": "process_items",
  "type": "loop",
  "outputs": {
    "results": "array where each item = {id, status, data: {value, timestamp}}"
  }
}
// Downstream step can reference:
{
  "transform": {
    "source": { "ref": "$.process_items.results" },
    "expr": { "left": { "ref": "$.item.data.value" } }  ← valid, data.value declared
  }
}

❌ WRONG (vague description):
{
  "id": "process_items",
  "type": "loop",
  "outputs": {
    "results": "array of processed items"  ← fields not enumerated
  }
}
// Downstream step CANNOT reference:
{
  "transform": {
    "expr": { "left": { "ref": "$.item.data.value" } }  ← invalid, schema unknown
  }
}

Now output the JSON only.
`.trim();
}
