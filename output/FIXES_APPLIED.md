# Intent System Prompt Fixes - 2026-02-25

## Problem Identified by OpenAI

The Intent Contract system prompt had **contradictions** that caused the LLM to generate invalid contracts:

1. **Prompt Contradiction**: Canonical step shape required `inputs` but ref grammar banned step input alias refs
2. **Implicit Schemas**: Transform expressions referenced fields not declared in upstream outputs
3. **Flatten Misuse**: Templates returned entire objects instead of extracting array fields
4. **Shape Mismatch**: Map templates created objects with `{row:[...]}` instead of 2D arrays for Sheets
5. **Invalid Aggregate Metrics**: Count metric used with field parameter (not allowed)

---

## Solution Implemented: Option A (Add Pattern 5)

Added **step input alias refs** as pattern 5 to the ref grammar, while **recommending inputs={}** for clarity.

---

## Changes Made to `intent-system-prompt.ts`

### 1. Updated Section 2: Reference & Scope Rules

**ADDED Pattern B - Step Input Aliases:**
```
B) Step input aliases (local to that step only):
   { "ref": "$.<input_key>" }
   Where input_key exists in that step's inputs object.
   SCOPING: Only valid within the step that declares the input.
```

**ADDED Critical Rule:**
- Step input aliases ($.inputKey) can ONLY be used within the step that declares them in inputs
- Transform expr can ONLY reference fields that exist in the source step's output schema

### 2. Updated CRITICAL PARAM REF SCOPING

**ADDED Pattern 2:**
```
2. Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in that step's inputs
```

### 3. Updated CRITICAL TRANSFORM SCOPING RULES

**Rule 1 - Allow step input aliases:**
```
1. transform.source MUST be:
   - Global step output: { "ref": "$.stepId.outputKey" }
   - Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in step.inputs
   - NEVER invent bare aliases like { "ref": "$.items" }
```

**Rule 3 - Prevent implicit schemas (NEW):**
```
3. Transform expr can ONLY reference fields that were declared in the source step's outputs:
   - If downstream transform needs $.item.fieldX, then source step.outputs must describe fieldX
   - Do NOT reference implicit fields that weren't explicitly declared upstream
   - Declare all required fields in the source step's output schema description
```

**Rule 4 - Strengthen flatten semantics:**
```
4. For kind="flatten":
   - If source is array-of-arrays: NO template, flatten returns 1D array
   - If source is array-of-objects with nested arrays: USE template to extract nested array field
   - Template MUST extract an array: { "items": { "ref": "$.item.nestedArrayField" } }
   - BANNED: flatten with template that returns non-array like { "items": { "ref": "$.item" } }
```

**Rule 5 - Fix Sheets 2D array output (NEW):**
```
5. For kind="map" when output needs to be 2D array (e.g., for Sheets):
   - Template must be ARRAY directly: [{ "ref": "$.item.field1" }, { "ref": "$.item.field2" }]
   - NOT wrapped in object: ❌ { "row": [...] } ← this creates array-of-objects
   - Direct array template produces proper 2D array: [[val1, val2], [val3, val4]]
```

### 4. Updated CRITICAL LOOP SCOPING RULES

**Rule 1 - Allow step input aliases:**
```
1. loop.iterate_over ref MUST be:
   - Global step output: { "ref": "$.stepId.outputKey" }
   - Step input alias: { "ref": "$.<inputKey>" } where inputKey exists in loop step's inputs
   - NEVER invent bare aliases like { "ref": "$.emails" }
```

**Rule 4 - Changed from BANNED to RECOMMENDED:**
```
4. RECOMMENDED: Use inputs={} and reference step outputs directly for clarity
```

### 5. Updated AGGREGATE - Add Critical Rules (NEW)

**ADDED after AGGREGATE shape:**
```
CRITICAL AGGREGATE RULES:
- metric="count" has NO "field" parameter: { "metric": "count", "as": "total" }
- metric="sum"|"min"|"max"|"avg" REQUIRES "field": { "metric": "sum", "field": "amount", "as": "total_amount" }
- To count with condition, use "where" expr: { "metric": "count", "as": "over_50", "where": {...} }
- BANNED: { "metric": "count", "field": "amount" } ← count doesn't take field
```

### 6. Updated Section 7: Complete Ref Grammar

**Changed from 4 to 5 patterns:**
```
ALL refs in the entire contract MUST match ONE of these 5 patterns:

1. GLOBAL STEP OUTPUT: { "ref": "$.<step_id>.<output_key>" }
2. STEP INPUT ALIAS (local to that step only): { "ref": "$.<input_key>" }
3. LOOP ITEM (only inside loop.body): { "ref": "$.<item_var>" } or { "ref": "$.<item_var>.<field>" }
4. QUESTION ANSWER: { "ref": "$.answers.<question_id>" }
5. TRANSFORM ITEM (ONLY in transform expr/template): { "ref": "$.item" } or { "ref": "$.item.<field>" }
```

**Updated BANNED PATTERNS:**
```
BANNED PATTERNS:
❌ { "ref": "$.emails" } ← not a step output or declared input
❌ { "ref": "$.file_content" } ← not declared anywhere as step output or input
❌ { "ref": "$.folder_id" } ← not a step output or declared input
❌ { "ref": "$.<inputKey>" } ← only valid if inputKey exists in that step's inputs

RECOMMENDED: Use inputs={} and reference step outputs directly for clarity and maintainability.
```

### 7. Updated Section 8: Critical Workflow Patterns

**Example A - Changed from BANNED to ALTERNATIVE:**
```
A) LOOP ITERATION - RECOMMENDED PATTERN (direct refs):
{
  "inputs": {},  ← Recommended: use empty inputs
  "loop": {
    "iterate_over": { "ref": "$.fetch.items" },  ← direct step output ref
    ...
  }
}

ALTERNATIVE (with step input alias - valid but less clear):
{
  "inputs": { "items": { "ref": "$.fetch.items" } },  ← Declare input alias
  "loop": {
    "iterate_over": { "ref": "$.items" },  ← Valid: references declared input
    ...
  }
}
```

**Example B - Strengthen flatten rules:**
```
B) FLATTEN ARRAY-OF-OBJECTS WITH NESTED ARRAYS:
{
  "transform": {
    "kind": "flatten",
    "source": { "ref": "$.loop.results" },
    "template": { "items": { "ref": "$.item.nested_array" } }  ← MUST extract array field
  }
}

CRITICAL: template MUST extract an array field, not return entire object.
✅ CORRECT: { "items": { "ref": "$.item.arrayField" } }
❌ WRONG: { "items": { "ref": "$.item" } } ← returns object, not array
```

---

## Test Results

### Before Fixes (OpenAI Identified Issues)

1. ❌ **filter_with_attachments**: Referenced `$.item.attachments` and `$.item.attachment_count` not declared in outputs
2. ❌ **flatten_attachments**: Template `{ "items": { "ref": "$.item" } }` returned entire object, not array
3. ❌ **prepare_sheet_rows**: Template `{ "row": [...] }` created objects instead of 2D array
4. ❌ **calculate_totals**: Used `{ "metric": "count", "field": "amount" }` - count doesn't take field

### After Fixes (Test Output)

1. ✅ **flatten_enriched**: Template `{ "items": { "ref": "$.item.attachments_with_context" } }` correctly extracts array field
2. ✅ **prepare_sheet_rows**: Template is direct array `[{ref: "$.item.result.date"}, ...]` producing 2D array
3. ✅ **count_over_50**: Uses `{ "metric": "count", "as": "over_50_count" }` without field parameter
4. ✅ **All refs valid**: 87/87 refs match valid patterns
5. ✅ **All semantic ops valid**: All 4 semantic ops used are in vocabulary
6. ✅ **All loops use "body"**: 3/3 loop steps use correct "body" key

---

## Key Architectural Decision

**Choice: Option A (Add Pattern 5)**

- ✅ Unlocks flexibility for complex steps that need to alias multiple inputs
- ✅ Maintains backwards compatibility with empty inputs pattern
- ✅ Provides clear scoping rules (input aliases are local to that step only)
- ✅ **Recommended pattern remains inputs={}** for clarity and maintainability
- ✅ Allows advanced users to use step input aliases when beneficial (e.g., ai_generate with many inputs)

---

## Impact

1. **Eliminates prompt contradictions**: System prompt is now internally consistent
2. **Prevents implicit schemas**: Forces LLM to declare all fields upstream
3. **Fixes flatten semantics**: Templates must extract array fields
4. **Fixes Sheets output**: Map templates produce proper 2D arrays
5. **Fixes aggregate metrics**: Count cannot have field parameter
6. **Enables flexible aliasing**: Step input aliases available when needed, but not required

---

## Files Modified

- ✅ `lib/agentkit/v6/intent/intent-system-prompt.ts` - All fixes applied

---

## Next Steps

1. ✅ Test with invoice extraction workflow - PASSED
2. Monitor Phase 2 capability binding for reduced unbound steps
3. Consider adding validation in TypeScript schema to enforce these rules at compile time
4. Update documentation to explain the 5 ref patterns clearly

---

**Generated:** 2026-02-25
**Status:** ✅ ALL FIXES APPLIED AND TESTED
