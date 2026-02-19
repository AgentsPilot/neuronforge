# Loop Wrapped Output Fix - Plugin Output Schema Navigation

**Date:** February 17, 2026
**Severity:** 🔴 CRITICAL
**Type:** Prompt Engineering Fix
**Impact:** Prevents loops from failing when plugins return wrapped outputs (object with nested array)

---

## Problem Statement

Workflows were failing at runtime with error:

```
Scatter-gather step step4: input must resolve to an array, got object.
Input: {{emails}}, Available variables: emails, existing_sheet_data, existing_sheet_data_objects
```

**Root Cause:** Many plugins return an **object with metadata** instead of just an array:

```json
// Gmail search_emails returns:
{
  "emails": [...],      // ← Array is nested here
  "total_found": 10,
  "total_available": 10,
  "search_query": "...",
  "searched_at": "..."
}
```

But the LLM was generating loops that try to iterate over the **whole object** instead of the **array inside**:

```json
{
  "type": "loop",
  "loop": {
    "iterate_over": "emails"  // ❌ References object, not array inside
  }
}
```

**User Feedback:** Workflow executes fetch successfully, but loop fails because it can't iterate over an object.

---

## Solution

Updated the formalization prompt to include explicit instructions on handling wrapped plugin outputs in loop nodes.

### File Modified

**Path:** `/Users/yaelomer/Documents/neuronforge/lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`

**Location:** After line 491 (in Loop Node section)

**Lines Added:** ~200 lines of comprehensive loop input navigation guidance

---

## What Was Added

### 1. Critical Bug Pattern Warning

Added section: **"🔴 CRITICAL: Loop Node - Handling Wrapped Plugin Outputs"**

Explicitly shows the WRONG pattern:

```markdown
#### ❌ WRONG - Loop Over Object Variable

```json
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "records"  // ❌ WRONG - records is an object!
  }
}
```

**Runtime Error:** `"Loop input must be an array, got object"`
```

### 2. Correct Patterns with Explanations

Shows TWO correct approaches:

**Option 1 - Use Path Navigation:**
```json
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "records",
    "item_variable": "current_record",
    "body_start": "process_record"
  },
  "inputs": [
    { "variable": "records", "path": "items" }  // ✅ Navigate to array field
  ]
}
```

**Option 2 - Add Transform to Extract Array:**
```json
{
  "id": "extract_items_array",
  "type": "operation",
  "operation": {
    "operation_type": "transform",
    "transform": {
      "type": "map",
      "input": "{{fetch_result.items}}",
      "expression": "item"
    }
  },
  "outputs": [{ "variable": "items_array" }],
  "next": "loop_records"
}
```

### 3. Detection Rules

Added clear rules for when to use path navigation:

```markdown
**ALWAYS check the plugin's `output_schema` before creating a loop:**

1. **If `output_schema.type === "array"`** → Variable IS the array
   - Use: `"iterate_over": "variable_name"`

2. **If `output_schema.type === "object"` with array property** → Variable is OBJECT
   - Use: `inputs: [{ "variable": "variable_name", "path": "array_field_name" }]`
```

### 4. Real-World Examples

Provided examples from actual plugins:

**Gmail plugin:**
```json
"output_schema": {
  "type": "object",
  "properties": {
    "emails": { "type": "array" }  // ← Nested
  }
}
// Loop must use: inputs: [{ "variable": "result", "path": "emails" }]
```

**Generic list operations:**
```json
"output_schema": {
  "type": "object",
  "properties": {
    "items": { "type": "array" }  // ← Common pattern
  }
}
// Loop must use: inputs: [{ "variable": "result", "path": "items" }]
```

### 5. Step-by-Step Checklist

Added checklist for creating loop nodes:

1. Identify the source variable
2. Check that operation's output_schema
3. Determine the schema type
4. Add appropriate inputs with path if needed
5. Set iterate_over to variable name

### 6. Common Plugin Patterns

Documented typical patterns:

- **Search/Query** → `{items: [...], metadata}`
- **List operations** → `{data: [...], pagination}`
- **Fetch operations** → `{results: [...], stats}`
- **Transform operations** → Direct array `[...]`
- **File operations** → `{files: [...], folder_info}`

---

## Why This Approach Works

### 1. Explicit Schema-Based Detection

The prompt now tells the LLM to **check output_schema.type** before creating loops, preventing the guess-based approach that was failing.

### 2. Visual Contrast

Using ❌ WRONG and ✅ CORRECT markers with clear examples makes it obvious which pattern to use.

### 3. Multiple Solution Paths

Provides both `path` navigation (preferred) and transform extraction (alternative), giving the LLM flexibility.

### 4. Real Plugin Examples

Uses actual Gmail plugin schema as example, not hypothetical scenarios, making it directly applicable.

### 5. Default Safe Behavior

States: "Unless you see `type: array` at top level, assume nested and use path parameter" - encourages defensive coding.

---

## Expected IR Change

### Before Fix (Broken)

```json
{
  "id": "fetch_emails",
  "type": "operation",
  "operation": {
    "operation_type": "fetch",
    "fetch": {
      "plugin_key": "google-mail",
      "action": "search_emails"
    }
  },
  "outputs": [{ "variable": "emails" }],
  "next": "loop_emails"
},
{
  "id": "loop_emails",
  "type": "loop",
  "loop": {
    "iterate_over": "emails",  // ❌ WRONG - emails is {emails: [...], total_found: 10}
    "item_variable": "current_email",
    "body_start": "process_email"
  }
}
```

**Runtime Error:** Loop fails because `emails` is an object, not an array.

### After Fix (Correct)

```json
{
  "id": "fetch_emails",
  "type": "operation",
  "operation": {
    "operation_type": "fetch",
    "fetch": {
      "plugin_key": "google-mail",
      "action": "search_emails"
    }
  },
  "outputs": [{ "variable": "emails" }],
  "next": "loop_emails"
},
{
  "id": "loop_emails",
  "type": "loop",
  "loop": {
    "iterate_over": "emails",
    "item_variable": "current_email",
    "body_start": "process_email"
  },
  "inputs": [
    { "variable": "emails", "path": "emails" }  // ✅ CORRECT - Navigate to array field
  ]
}
```

**Runtime Success:** Loop correctly iterates over `emails.emails` array.

---

## DSL Compilation Impact

The DSL compiler (Phase 4) will see:

```json
{
  "scatter": {
    "input": "{{emails}}",  // Variable reference
    "itemVariable": "current_email"
  }
}
```

But with the `inputs` binding specifying `path: "emails"`, the executor knows to access `emails.emails` instead of `emails` directly.

This is the correct approach because:
- IR stays declarative (just references variable)
- Executor handles navigation (runtime concern)
- Works with any nested structure

---

## Testing Strategy

### Test Case 1: Gmail Workflow
**Scenario:** Fetch emails and loop over them

**Expected IR:**
```json
{
  "id": "loop_emails",
  "type": "loop",
  "loop": {
    "iterate_over": "emails",
    "item_variable": "current_email",
    "body_start": "filter_complaints"
  },
  "inputs": [
    { "variable": "emails", "path": "emails" }  // ✅ Navigate to nested array
  ]
}
```

**Verification:**
- LLM checks Gmail's output_schema
- Sees `type: "object"` with `emails` property of type array
- Adds `inputs` with `path: "emails"`
- Loop executes successfully at runtime

### Test Case 2: Direct Array Output
**Scenario:** Transform returns array directly

**Expected IR:**
```json
{
  "id": "loop_items",
  "type": "loop",
  "loop": {
    "iterate_over": "items",
    "item_variable": "current_item",
    "body_start": "process_item"
  },
  "inputs": [
    { "variable": "items" }  // ✅ No path needed - already array
  ]
}
```

**Verification:**
- LLM checks transform's output_schema
- Sees `type: "array"` at top level
- No `path` parameter needed
- Loop executes successfully

### Test Case 3: Nested List Operation
**Scenario:** API returns `{data: [...], meta: {...}}`

**Expected IR:**
```json
{
  "id": "loop_records",
  "type": "loop",
  "loop": {
    "iterate_over": "api_result",
    "item_variable": "current_record",
    "body_start": "validate_record"
  },
  "inputs": [
    { "variable": "api_result", "path": "data" }  // ✅ Navigate to data field
  ]
}
```

---

## Success Criteria

| Criterion | Status | Verification Method |
|-----------|--------|---------------------|
| Prompt includes loop output handling section | ✅ | Lines 467-660 in formalization-system-v4.md |
| Shows WRONG pattern with explanation | ✅ | Lines 489-514 |
| Shows CORRECT pattern (path navigation) | ✅ | Lines 516-530 |
| Shows CORRECT pattern (transform extraction) | ✅ | Lines 532-559 |
| Detection rules for output_schema.type | ✅ | Lines 561-583 |
| Real-world plugin examples | ✅ | Lines 585-619 |
| Step-by-step checklist | ✅ | Lines 621-641 |
| Common plugin patterns documented | ✅ | Lines 643-653 |
| LLM generates correct loop inputs | 🧪 | Needs end-to-end test |
| Workflows execute without loop failures | 🧪 | Needs runtime test |

---

## Expected Impact

### Before Fix
- ❌ Loops fail at runtime with "input must be array" error
- ❌ Workflows stop executing after successful fetch
- ❌ Non-technical users can't fix the issue
- ❌ Every plugin with wrapped output breaks loops

### After Fix
- ✅ LLM checks output_schema before creating loops
- ✅ Correct `inputs` with `path` parameter generated
- ✅ Loops execute successfully with nested arrays
- ✅ Works for any plugin regardless of output structure
- ✅ Self-documenting (IR shows navigation intent)

---

## Related Files

1. [DUPLICATE-DETECTION-PROMPT-FIX.md](DUPLICATE-DETECTION-PROMPT-FIX.md) - Previous fix for duplicate detection
2. [formalization-system-v4.md](lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md) - Updated prompt with loop guidance
3. [google-mail-plugin-v2.json](lib/plugins/definitions/google-mail-plugin-v2.json) - Gmail plugin output schema
4. [V6-REQUIREMENTS-PROPAGATION-IMPLEMENTATION-COMPLETE.md](V6-REQUIREMENTS-PROPAGATION-IMPLEMENTATION-COMPLETE.md) - Base architecture

---

## Next Steps

### Immediate (Testing)
1. Re-run Gmail complaints workflow
2. Verify IR contains `inputs: [{ "variable": "emails", "path": "emails" }]`
3. Confirm loop executes without "must be array" error
4. Test with other plugins that return wrapped outputs

### Short-Term (Monitoring)
1. Monitor loop failure rate across all workflows
2. Check if LLM correctly identifies output_schema.type
3. Verify path navigation is used when needed
4. Track which plugins cause issues

### Long-Term (Hardening)
1. Add compiler validation to detect missing path navigation
2. Add unit tests for loop input generation
3. Update all plugin definitions with clear output_schema
4. Consider runtime helper to auto-detect array fields

---

**Status:** Production Ready - Prompt Updated
**Risk:** Low - Additive prompt change, backward compatible
**Recommendation:** Test with Gmail workflow, monitor LLM compliance, deploy to production

**Implementation completed:** February 17, 2026
**Total time:** ~30 minutes (prompt engineering + documentation)
