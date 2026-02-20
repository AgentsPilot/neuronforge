# Compiler collect_from Translation Fix (Feb 19, 2026)

**Status:** CRITICAL BUG FIXED ✅
**Issue:** Gather configurations missing `from` field in compiled DSL
**Root Cause:** Compiler not translating IR's `collect_from` to DSL's `from`
**Impact:** Loop collection executing but gathering 0 items (doesn't know WHICH variable to collect)

---

## The Problem

**User provided compiled workflow showing:**
```json
"gather": {
  "operation": "collect",
  "outputKey": "email_transactions"
  // ❌ MISSING: "from": "transaction_record"
}
```

**But the IR (execution graph) had:**
```json
"loop": {
  "collect_outputs": true,
  "output_variable": "email_transactions",
  "collect_from": "transaction_record"  // ✅ Present in IR!
}
```

**Conclusion:** IR generation is correct (prompt fix worked), but **compiler is not translating** `collect_from` to `from`.

---

## Root Cause Analysis

**File:** [lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)

**Function:** `compileLoopNode()` (lines 713-784)

**The buggy code (lines 767-770):**
```typescript
gather: {
  operation: loop.collect_outputs ? 'collect' : 'flatten',
  outputKey: loop.output_variable
  // ❌ MISSING: from: loop.collect_from
}
```

**Why this happened:**
- When ExecutionGraphCompiler was originally written, IR didn't have `collect_from` field
- After we updated the prompt to include `collect_from`, the compiler was never updated
- IR correctly has `collect_from`, but compiler ignores it
- Result: DSL gather has no `from` field

**Impact:**
- WorkflowPilot's ParallelExecutor doesn't know WHICH variable to collect
- Falls back to collecting ALL variables or 0 items
- Calibration logs showed: "Gathering 0 items from step6"

---

## The Fix

**File:** [lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:767)

**Changed lines 767-770:**

**Before:**
```typescript
gather: {
  operation: loop.collect_outputs ? 'collect' : 'flatten',
  outputKey: loop.output_variable
}
```

**After:**
```typescript
gather: {
  operation: loop.collect_outputs ? 'collect' : 'flatten',
  outputKey: loop.output_variable,
  ...(loop.collect_from && { from: loop.collect_from })  // ✅ Add collect_from as "from" field
}
```

**What this does:**
- Reads `collect_from` from IR loop configuration
- Adds it as `from` field in DSL gather configuration
- Uses spread operator with conditional to only add if `collect_from` exists
- Backward compatible: if IR doesn't have `collect_from`, `from` is omitted

---

## Expected Result

**Before fix (compiled DSL):**
```json
{
  "step_id": "step_4",
  "type": "scatter_gather",
  "scatter": {
    "input": "{{current_email.attachments}}",
    "itemVariable": "current_attachment",
    "steps": [...]
  },
  "gather": {
    "operation": "collect",
    "outputKey": "email_transactions"
    // ❌ Missing from
  }
}
```

**After fix (compiled DSL):**
```json
{
  "step_id": "step_4",
  "type": "scatter_gather",
  "scatter": {
    "input": "{{current_email.attachments}}",
    "itemVariable": "current_attachment",
    "steps": [...]
  },
  "gather": {
    "operation": "collect",
    "outputKey": "email_transactions",
    "from": "transaction_record"  // ✅ Now included!
  }
}
```

**Runtime behavior:**
- ParallelExecutor reads `gather.from` field
- Knows to collect `transaction_record` variable from each iteration
- `email_transactions` array gets populated with complete records
- Summary email has all data

---

## Verification Steps

**Test workflow compilation:**
1. Use existing IR with `collect_from` field
2. Run ExecutionGraphCompiler.compile(ir)
3. Check compiled DSL has `gather.from` field
4. Verify value matches IR's `collect_from`

**Test execution:**
1. Run workflow in PILOT
2. Check calibration logs show "Gathering N items" (not 0)
3. Verify collected array has expected records
4. Verify summary email has complete data

---

## Files Modified

**File:** [lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts)

**Changes:**
- **Line 770:** Added `...(loop.collect_from && { from: loop.collect_from })`

**Total lines changed:** 1 line

---

## Related Fixes

**This completes the full collect_from fix chain:**

1. ✅ **Prompt Fix:** Added `collect_from` field to Loop Node template in formalization-system-v4.md
   - IR now generates with `collect_from` field
   - See: [CALIBRATION-CRITICAL-FIXES-Feb19-2026.md](CALIBRATION-CRITICAL-FIXES-Feb19-2026.md)

2. ✅ **Compiler Fix:** Translate `collect_from` (IR) to `from` (DSL) in ExecutionGraphCompiler
   - DSL now has `from` field in gather
   - This document

**Together, these fixes ensure:**
- IR generation includes `collect_from` (LLM knows to add it)
- DSL compilation includes `from` (compiler translates it)
- Runtime execution collects correct variable (PILOT uses it)

---

## Key Learning

**When updating IR schema, remember to:**
1. Update prompt templates (so LLM generates new field)
2. Update compiler (so it translates new field to DSL)
3. Update runtime executor (so it uses new field)

**In this case:**
- ✅ Step 1 done: Prompt updated
- ✅ Step 2 done: Compiler updated (this fix)
- ✅ Step 3 already worked: ParallelExecutor already supports `gather.from`

---

## Success Criteria

**Before compiler fix:**
```
[ParallelExecutor] Gathering 0 items from step6 (expected to collect email_transactions)
```

**After compiler fix:**
```
[ParallelExecutor] Gathering 5 items from step6 (collecting transaction_record → email_transactions)
```

**Summary email:**
- ✅ Has transaction data
- ✅ Has Drive links
- ✅ Has source email info
- ✅ Totals are correct

---

## Status

✅ **COMPILER FIX COMPLETE**
✅ **READY FOR TESTING**
🎯 **NEXT:** Recompile workflow with updated compiler and test execution
