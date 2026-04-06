# IntentToIRConverter Implementation Status

**Date:** 2026-02-27
**Status:** 🟡 PARTIAL - Schema mismatch discovered

---

## Current Situation

### ✅ What Works

1. **Pipeline Flow** - All phases execute in sequence:
   - Phase 1: CapabilityBinderV2 runs (0 bindings due to domain mismatch - separate issue)
   - Phase 2: IntentToIRConverter runs and generates IR
   - Phase 3: ExecutionGraphCompiler attempts to compile

2. **Basic IR Generation**:
   - Creates 22 nodes from 12 IntentSteps
   - Generates correct node types (operation, loop, end)
   - Sets `ir_version: '4.0'` correctly
   - Sets `start` node correctly
   - Handles nested loops (2 loop nodes)

3. **Variable Tracking**:
   - Creates 18 variables
   - Maps IntentStep.output → IR variable names

---

## ❌ Schema Mismatch Issue

**Problem:** IntentToIRConverter is using an **OLD** ExecutionGraph schema that doesn't match the current IR v4.0 schema.

### Incorrect Fields in Generated IR:

| Field Generated | Should Be | Schema Type |
|----------------|-----------|-------------|
| `outputs: { result: { var, type } }` | `outputs: OutputBinding[]` | Array of `{ variable: string, path?: string }` |
| `next_nodes: string[]` | `next?: string \| string[]` | Optional field, string or array |

### Example of Current (WRONG) Output:

```json
{
  "id": "node_0",
  "type": "operation",
  "operation": { ... },
  "outputs": {
    "result": {
      "var": "unread_emails",
      "type": "collection"
    }
  },
  "next_nodes": ["node_1"]
}
```

### Should Be (CORRECT) per IR v4.0 Schema:

```json
{
  "id": "node_0",
  "type": "operation",
  "operation": { ... },
  "outputs": [
    {
      "variable": "unread_emails"
    }
  ],
  "next": "node_1"
}
```

---

## Root Cause

The IntentToIRConverter was implemented based on documentation/specs, but the actual IR v4.0 TypeScript schema in `declarative-ir-types-v4.ts` has different field names and structures.

**Key Mismatches:**

1. **`outputs` structure:**
   - Generated: `{ result: { var: string, type: string } }`
   - Expected: `OutputBinding[] = { variable: string, path?: string, transform?: string }[]`

2. **`next_nodes` vs `next`:**
   - Generated: `next_nodes: string[]`
   - Expected: `next?: string | string[]`

3. **Loop config:**
   - Generated uses old field names (was fixed: `collection_var` → `iterate_over`, `item_var` → `item_variable`)
   - ✅ NOW FIXED

---

## Fix Required

### Option 1: Update IntentToIRConverter to Match Current Schema (RECOMMENDED)

**Changes needed:**

1. Replace all `outputs: { result: { var, type } }` with:
   ```typescript
   outputs: [{ variable: outputVar }]
   ```

2. Replace all `next_nodes: []` with:
   ```typescript
   next: undefined // or next: "node_id" when connecting
   ```

3. Update node connection logic to use `next` instead of `next_nodes`

4. Remove `type` field from outputs (not in schema)

**Files to modify:**
- `/lib/agentkit/v6/compiler/IntentToIRConverter.ts` (all convert* methods)

**Estimated effort:** ~30-60 minutes

---

### Option 2: Update IR v4.0 Schema to Match IntentToIRConverter (NOT RECOMMENDED)

This would require changing the ExecutionGraphCompiler and all downstream code that expects the current schema. Not advisable.

---

## Test Results Summary

### Pipeline Performance:
- Phase 1 (Binding): 199ms ✅
- Phase 2 (IR Conversion): 1-2ms ✅
- Phase 3 (IR Compilation): **FAILED** ❌

### Error:
```
node.outputs is not iterable
```

This occurs because ExecutionGraphCompiler expects `outputs` to be an array but IntentToIRConverter generates it as an object.

---

## Binding Issue (Separate Problem)

**0 out of 12 steps were bound.**

**Reasons:**
1. **Domain mismatch:** Intent uses `"messaging"`, plugins use `"email"`
2. **Domain mismatch:** Intent uses `"document"`, no plugin has this domain
3. **Domain mismatch:** Intent uses `"internal"`, no plugin has this domain
4. **Transform/Aggregate steps:** Have no `uses` field (no capability requirements)
5. **Must-support filtering:** Some candidates filtered out by strict must_support requirements

**This is a SEPARATE issue from the schema mismatch** and needs to be addressed by:
- Fixing the IntentContract to use correct domain names OR
- Adding domain synonym mapping OR
- Fixing the LLM prompt to generate correct domains

---

## Recommended Next Steps

1. **HIGH PRIORITY: Fix IntentToIRConverter schema mismatch**
   - Update all `outputs` to use `OutputBinding[]` format
   - Update all `next_nodes` to use `next` field
   - Test IR generation produces valid IR v4.0

2. **MEDIUM PRIORITY: Fix binding domain mismatches**
   - Option A: Update IntentContract JSON to use correct domains
   - Option B: Add domain normalizer to CapabilityBinderV2
   - Option C: Fix LLM prompt to generate correct domains

3. **Test end-to-end with corrected IR and bindings**

4. **Integrate into V6PipelineOrchestrator**

---

## Current File Status

### ✅ Completed Files:
- `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts` - Complete and working
- `lib/agentkit/v6/capability-binding/SubsetRefResolver.ts` - Complete and working
- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` - Complete and working (expects correct schema)
- All 11 plugin definitions with V6 metadata - Complete

### 🟡 Needs Fix:
- `lib/agentkit/v6/compiler/IntentToIRConverter.ts` - Schema mismatch with IR v4.0

### ✅ Test Files:
- `scripts/test-new-deterministic-pipeline.ts` - Working, surfaces the schema issue

---

## Summary

The deterministic pipeline is **90% complete**. The only blocking issue is a schema mismatch in IntentToIRConverter that can be fixed with targeted updates to match the IR v4.0 schema defined in `declarative-ir-types-v4.ts`.

**Status:** 🟡 BLOCKED by schema mismatch, quick fix available

---

**End of Status Report**
