# OpenAI Feedback - Critical Structural Fixes
**Date:** 2026-02-26
**Status:** 🔴 CRITICAL VIOLATIONS - Must Fix Before Binding

---

## OpenAI Identified 7 Critical Structural Issues

These are **Intent Phase** violations, not compiler or binding issues. They must be fixed in the system prompt to ensure valid Intent Contract generation.

---

## Issue #1: Top-Level Contract Violation

### ❌ **WRONG** (Array of steps only):
```json
[
  { "id": "step1", ... },
  { "id": "step2", ... }
]
```

### ✅ **CORRECT** (Complete contract object):
```json
{
  "version": "core_dsl_v1",
  "goal": "...",
  "unit_of_work": "...",
  "plugins_involved": [...],
  "questions": [...],
  "constraints": [...],
  "risks": [...],
  "steps": [...]
}
```

### **Fix Applied:**
Added to system prompt header:
```
CRITICAL: You MUST output the COMPLETE contract object with ALL required fields:
- version
- goal
- unit_of_work
- plugins_involved
- steps (array)
- Optional: summary, questions, constraints, risks

Do NOT output just an array of steps. That is INVALID.
```

---

## Issue #2: Invalid map.template Shape

### ❌ **WRONG** (Array template):
```json
{
  "transform": {
    "kind": "map",
    "template": [
      { "ref": "$.item.field1" },
      { "ref": "$.item.field2" }
    ]
  }
}
```

### ✅ **CORRECT** (Object template):
```json
{
  "transform": {
    "kind": "map",
    "template": {
      "row": [
        { "ref": "$.item.field1" },
        { "ref": "$.item.field2" }
      ]
    }
  }
}
```

### **Violation in Current JSON:**
Step `prepare_sheet_rows` (line 505-544) uses array template directly.

### **Fix Applied:**
1. Updated TRANSFORM schema definition:
```
"template"?: { [k:string]: (value | {ref}) },  // MUST be object, NEVER array

CRITICAL: template MUST ALWAYS be an OBJECT, never an array.
Even for Sheets rows, wrap array inside object: { "row": [...] }
```

2. Updated rule #5:
```
5. For kind="map" when output needs to be 2D array (e.g., for Sheets):
   - Template MUST be object wrapping array: { "row": [{ "ref": "$.item.field1" }, ...] }
   - NEVER use array directly as template: ❌ template: [...] ← invalid
```

3. Added to BANNED PATTERNS:
```
❌ template: [...] ← template must be OBJECT, not array
```

---

## Issue #3: Invalid Aggregate Metric Structure

### ❌ **WRONG** (where inside metric):
```json
{
  "aggregate": {
    "source": { "ref": "..." },
    "metrics": [
      {
        "metric": "count",
        "as": "over_50_count",
        "where": { "op": "gt", ... }  // ← NOT ALLOWED HERE
      }
    ]
  }
}
```

### ✅ **CORRECT** (where at aggregate level):
```json
{
  "aggregate": {
    "source": { "ref": "..." },
    "where": { "op": "gt", ... },  // ← Here, applies to ALL metrics
    "metrics": [
      { "metric": "count", "as": "total_count" }
    ]
  }
}
```

### **Violation in Current JSON:**
Step `calculate_totals` (lines 568-616) has where clauses inside metrics #3 and #4.

### **Fix Applied:**
Updated AGGREGATE schema:
```json
{
  "aggregate": {
    "source": { "ref": string },
    "where"?: Expr,  // Optional filter applied to ALL metrics
    "metrics": [...]
  }
}
```

Updated CRITICAL AGGREGATE RULES:
```
- "where" clause goes at aggregate level, NOT inside individual metrics
- "where" applies to ALL metrics in that aggregate step
- For different filters, create SEPARATE aggregate steps
- BANNED: { "metric": "count", "as": "name", "where": {...} } ← where not allowed in metric
```

Added to BANNED PATTERNS:
```
❌ metric with "where" inside ← "where" goes at aggregate level only
```

---

## Issue #4: Invalid Step-Level References

### ❌ **WRONG** (Referencing entire step):
```json
{
  "inputs": {
    "totals": { "ref": "$.calculate_totals" }  // ← Missing output key
  }
}
```

### ✅ **CORRECT** (Must specify output key):
```json
{
  "inputs": {
    "total_count": { "ref": "$.calculate_totals.total_count" },
    "total_amount": { "ref": "$.calculate_totals.total_amount" }
  }
}
```

### **Violation in Current JSON:**
Step `generate_summary_email` (line 632) has:
```json
"totals": { "ref": "$.calculate_totals" }
```

### **Fix Applied:**
Updated CRITICAL RULES:
```
- NEVER reference entire step output: ❌ { "ref": "$.stepId" } ← must specify output key
- ALWAYS use: ✅ { "ref": "$.stepId.outputKey" }
```

Added to BANNED PATTERNS:
```
❌ { "ref": "$.stepId" } ← MUST include output key: $.stepId.outputKey
❌ { "ref": "$.calculate_totals" } ← MUST be $.calculate_totals.total_count
```

---

## Issue #5: Validate Step Producing Undeclared Output

### ❌ **WRONG** (Validate with output):
```json
{
  "id": "check_amount_exists",
  "type": "validate",
  "outputs": {
    "is_valid": "whether amount was successfully extracted"  // ← NOT SUPPORTED
  },
  "validate": {
    "checks": [...]
  }
}
```

### ✅ **CORRECT** (Use transform with expr instead):
```json
{
  "id": "check_amount_exists",
  "type": "transform",
  "outputs": {
    "is_valid": "boolean indicating if amount exists"
  },
  "transform": {
    "kind": "map",
    "source": { "ref": "$.extract_transaction_data" },
    "template": {
      "is_valid": {
        "op": "and",
        "args": [
          { "op": "exists", "left": { "ref": "$.item.amount" } },
          { "op": "not", "args": [{ "op": "is_null", "left": { "ref": "$.item.amount" } }] }
        ]
      }
    }
  }
}
```

### **Violation in Current JSON:**
Step `check_amount_exists` (lines 340-378) declares output `is_valid` but validate doesn't produce outputs.

### **Fix Applied:**
Added to VALIDATE section:
```
CRITICAL: Validate step does NOT produce automatic outputs.
- If you need boolean validation result, use transform with expr instead
- Validate only performs checks and controls flow (error/skip/warn)
- Do NOT declare outputs like "is_valid" unless DSL explicitly supports it
```

---

## Issue #6: Loop Return Semantics Must Be Consistent

### **Current JSON Structure:**
```json
{
  "id": "process_emails",
  "loop": {
    "body": [
      ...
      {
        "id": "return_enriched",
        "outputs": {
          "result": "array where each item = {message_id, ...}"
        }
      }
    ]
  },
  "outputs": {
    "all_attachments": "array where each item = {message_id, ...}"
  }
}
```

**Issue:** Loop collects final step's single output key `result`, so actual collected structure is:
```
[{result: [...]}, {result: [...]}, ...]
```

But loop outputs say: `"array where each item = {message_id, ...}"`

**Downstream flatten step correctly uses:** `$.item.result`

### **Status:**
This is technically working (flatten handles it correctly) but the schema description is misleading.

### **Fix Applied:**
Existing rule in CRITICAL LOOP SCOPING RULES already covers this:
```
3. Loop body MUST end with a step that has exactly ONE output key.
   - That final output defines what each iteration returns.
   - When collect=true, loop collects that output into an array.
   - Accessible as: { "ref": "$.loopId.<collect_as>" }
```

**No additional fix needed** - the rule is clear, LLM just needs to follow it.

---

## Issue #7: Operator Safety

### **Rule:**
All operators used inside `expr` must exist in the injected `core_operators` list.

### **Fix Applied:**
Added to CRITICAL RULES:
```
- ONLY use operators from the injected core_operators list - do NOT invent operators.
```

---

## Summary of Fixes Applied

| Issue | Status | Lines Modified |
|-------|--------|----------------|
| #1: Top-level contract violation | ✅ Fixed | Added warning in header |
| #2: Invalid map.template shape | ✅ Fixed | TRANSFORM schema + rule #5 + BANNED |
| #3: Invalid aggregate metric structure | ✅ Fixed | AGGREGATE schema + rules + BANNED |
| #4: Invalid step-level references | ✅ Fixed | CRITICAL RULES + BANNED |
| #5: Validate step producing output | ✅ Fixed | Added warning to VALIDATE |
| #6: Loop return semantics | ✅ Already handled | Existing rule sufficient |
| #7: Operator safety | ✅ Fixed | Added to CRITICAL RULES |

---

## Expected Changes in Next Generation

After regenerating the Intent Contract with these fixes:

1. ✅ Full contract object (not just steps array)
2. ✅ Map template wrapped in object: `{ "row": [...] }`
3. ✅ Aggregate without where inside metrics - need separate aggregate steps for over_50
4. ✅ All refs include output key: `$.calculate_totals.total_count` not `$.calculate_totals`
5. ✅ Validate step removed or changed to transform for boolean output
6. ✅ Only operators from core_operators list

---

## Files Modified

- ✅ `lib/agentkit/v6/intent/intent-system-prompt.ts` - All 7 fixes applied

---

## Next Steps

1. 🔴 **Regenerate Intent Contract** with updated prompt
2. ✅ **Validate** all 7 issues are resolved
3. ✅ **Proceed to Phase 2:** Capability Binding
4. ✅ **Proceed to Phase 3:** IR Compilation

---

**Status:** 🟡 FIXES APPLIED - Need to regenerate and validate
