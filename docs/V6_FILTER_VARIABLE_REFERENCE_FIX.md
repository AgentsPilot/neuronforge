# V6 Filter Variable Reference Fix

**Date:** 2026-01-07
**Status:** ✅ COMPLETE
**Impact:** Filter operations now generate correct variable references

---

## Problem

The DeclarativeCompiler was appending `.filtered` suffix to `ctx.currentVariable` after filter operations, causing subsequent steps to reference filtered results as `{{stepN.filtered}}` instead of `{{stepN}}`.

### Example Issue

**Generated Workflow:**
```json
{
  "id": "step7",
  "type": "transform",
  "operation": "filter",
  "input": "{{step6}}",
  "config": {
    "condition": "item.subject.includes('complaint')"
  }
},
{
  "id": "step8",
  "type": "transform",
  "operation": "render_table",
  "input": "{{step7.filtered}}"  // ❌ Incorrect reference
}
```

**Why This Was Confusing:**

The filter operation in [StepExecutor.ts:1632-1644](lib/pilot/StepExecutor.ts#L1632-L1644) returns an array with metadata properties:

```typescript
const result: any = filtered;  // The result IS the filtered array
result.filtered = filtered;    // Backward compatibility property
result.removed = originalCount - filtered.length;
result.count = filtered.length;
```

So both `{{step7}}` and `{{step7.filtered}}` technically work, but:
- `{{step7}}` is the **primary data** (the filtered array itself)
- `{{step7.filtered}}` is a **redundant property access** (accessing the same array)

Using `{{step7}}` is simpler, more direct, and consistent with other transform operations.

---

## Root Cause

In [DeclarativeCompiler.ts](lib/agentkit/v6/compiler/DeclarativeCompiler.ts), three locations were setting:

```typescript
ctx.currentVariable = `${metadata.id}.filtered`  // ❌ Appending .filtered
```

This was based on an assumption that filter operations return an object with a `.filtered` property, but the runtime returns the filtered array directly (with metadata as properties).

---

## Solution

Updated the DeclarativeCompiler to set `ctx.currentVariable` to the step ID directly, without the `.filtered` suffix.

### Files Modified

**lib/agentkit/v6/compiler/DeclarativeCompiler.ts**

**Change 1: Line 707 (AND filter logic)**
```typescript
// Before
ctx.currentVariable = `${metadata.id}.filtered`

// After
ctx.currentVariable = metadata.id
```

**Change 2: Line 728 (OR filter logic)**
```typescript
// Before
ctx.currentVariable = `${metadata.id}.filtered`

// After
ctx.currentVariable = metadata.id
```

**Change 3: Line 752 (Nested filter groups)**
```typescript
// Before
ctx.currentVariable = `${metadata.id}.filtered`

// After
ctx.currentVariable = metadata.id
```

---

## Impact

### Before Fix

**Generated References:**
```json
{
  "id": "step7",
  "type": "transform",
  "operation": "filter",
  "input": "{{step6}}"
},
{
  "id": "step8",
  "input": "{{step7.filtered}}"  // Redundant .filtered access
}
```

### After Fix

**Generated References:**
```json
{
  "id": "step7",
  "type": "transform",
  "operation": "filter",
  "input": "{{step6}}"
},
{
  "id": "step8",
  "input": "{{step7}}"  // Direct reference to filtered array
}
```

---

## Benefits

1. **Simpler variable references** - `{{step7}}` instead of `{{step7.filtered}}`
2. **Consistent with other operations** - Map, reduce, etc. all use `{{stepN}}`
3. **Less confusing** - No need to understand which operations append suffixes
4. **Backward compatible** - Both patterns work due to runtime structure

---

## Testing

### Manual Test

Using the Gmail complaints workflow:

**Before:**
```json
{
  "id": "step7",
  "operation": "filter",
  "input": "{{step6}}"
},
{
  "id": "step8",
  "input": "{{step7.filtered}}"
}
```

**After:**
```json
{
  "id": "step7",
  "operation": "filter",
  "input": "{{step6}}"
},
{
  "id": "step8",
  "input": "{{step7}}"
}
```

✅ Both work, but the new pattern is cleaner.

---

## Related Changes

This fix is part of the **V6 Phase 5 DSL Architecture** improvements (2026-01-07):

1. ✅ Phase 5 DSL generation (DSL after transforms)
2. ✅ Step ID simplification (`step1`, `step2`, etc.)
3. ✅ Filter variable reference fix (this document)

---

## Backward Compatibility

**Breaking Change:** No

Workflows compiled with the old naming scheme (`{{stepN.filtered}}`) will still work due to the runtime structure. However, newly compiled workflows will use the simpler `{{stepN}}` pattern.

**Migration:** Re-compile existing workflows to get the new references (optional).

---

## Conclusion

The DeclarativeCompiler now generates simpler, more consistent variable references for filter operations.

**Key Takeaway:** Filter operations return the filtered array directly, so subsequent steps should reference it as `{{stepN}}`, not `{{stepN.filtered}}`.

---

**Author:** Claude (Sonnet 4.5)
**Date:** 2026-01-07
**Status:** ✅ COMPLETE
