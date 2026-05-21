# WP: Explicit Scatter-Gather Output Shape

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/explicit-scatter-gather-shape`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`ParallelExecutor.executeScatterItem` (`ParallelExecutor.ts:519–632`) decides the per-item output shape via the **`isStepExtractLike` runtime heuristic** (lines 534–550). The heuristic produces one of five distinct shapes depending on `ai_type` strings, output_schema field counts, and step counts:

| Shape | Output | Triggered by |
|---|---|---|
| `step_only` | `stepData` (no merge with item) | extract-like step (ai_type or fieldCount ≥ 2) |
| `merge_with_item` | `{...item, ...stepData}` | single non-extract step with object data |
| `merge_as_named_array` | `{...item, [outputVariable]: stepData}` | single step with array data + output_variable |
| `raw_step_results` | `itemResults` (dict of stepId → data) | no merge possible, fallback |
| `item_only` | `item` | no step results at all |

Downstream steps cannot tell which branch fired — the same DSL shape produces different runtime shapes. The "D-B25" comment at line 601–604 documents that this caused a workflow to inflate to ~1M tokens because the heuristic merged a 165 KB document content blob alongside the extracted fields.

This is H-7 from the execution layer review. The fix lets the compiler (or hand-authored DSL) **declare the shape explicitly** in `gather.shape`. Runtime obeys deterministically.

## Goal

Add an explicit `gather.shape` field that, when present, completely bypasses the heuristic. When absent, the existing heuristic remains the default (zero regression). A separate SystemConfig flag makes the field mandatory for environments that want hard determinism.

## Non-Goals

- Removing the heuristic itself. Today's workflows depend on it. The heuristic stays as the fallback.
- Updating the V6 `ExecutionGraphCompiler` to emit `gather.shape` automatically. That's a separate compiler-side workplan. This change unblocks that — it doesn't do it.
- Touching `gather.from` (a separate runtime-only bypass at line 487–513). It already exists and works.
- Changing the four `gather.operation` values (`collect | merge | reduce | flatten`) — those control cross-item aggregation, separate from per-item shape.

---

## Design Decisions

### D1. New `gather.shape` field with 4 values

Extend `ScatterGatherStep.gather` with:

```ts
shape?: 'step_only' | 'merge_with_item' | 'merge_as_named_array' | 'item_only';
shapeField?: string; // Required iff shape === 'merge_as_named_array'
```

The 5th heuristic shape (`raw_step_results`, the dict-of-step-results fallback) is **not exposed** — it's a degenerate case the heuristic uses when none of the other shapes apply. Compiler-generated DSLs should never need it; if heuristic users hit it today, they keep the heuristic.

### D2. Runtime decision tree

```
if (gather.shape is present) {
  apply gather.shape deterministically
} else if (pilot_scatter_explicit_shape_required flag is on) {
  throw ExecutionError("gather.shape required")
} else {
  fall back to today's isStepExtractLike heuristic (UNCHANGED)
}
```

### D3. Per-shape semantics — explicit and uniform across single-step and multi-step bodies

| Shape | Single-step body | Multi-step body |
|---|---|---|
| `step_only` | Return the (single) step's data | Return the **last** step's data |
| `merge_with_item` | `{...item, ...stepData}` | `{...item, ...allObjectStepData}` (legacy multi-step flatten) |
| `merge_as_named_array` | `{...item, [shapeField]: stepData}` | same — uses last step's data as the array |
| `item_only` | Return the original `item` (drops step outputs) | same |

This is deliberately stricter than the heuristic: `step_only` and `merge_with_item` produce one well-defined shape regardless of body size.

### D4. SystemConfig flag — `pilot_scatter_explicit_shape_required`

- Default `false`. When false, missing `shape` falls back to the heuristic — zero regression.
- When `true`, missing `shape` throws `ExecutionError("Scatter-gather step ${id}: gather.shape is required")`.

### D5. Strict / coercion / overwrite — independent of this flag

The four existing per-execution flags (strict, loop-overwrite, conditional-coerce) are about different concerns. This flag is independent. Adding it follows the same pattern as the others — constructor param on `ExecutionContext`, propagated through `clone()`, read by `WorkflowPilot.execute()` from SystemConfig.

### D6. Validation at error time, not at construct time

We do NOT validate that `shapeField` is present when `shape === 'merge_as_named_array'` at the type level — TypeScript discriminated unions on the optional inner shape field would over-constrain the type for hand-written DSLs. Instead, validate at runtime when applying the shape; if `shapeField` is missing, throw a clear error.

---

## File-by-File Changes

### M1. `lib/pilot/types.ts` (MODIFY)

Extend `ScatterGatherStep.gather`:

```ts
gather: {
  operation: 'collect' | 'merge' | 'reduce' | 'flatten';
  outputKey?: string;
  reduceExpression?: string;
  /**
   * Phase 6 — Tier 2 Fix #3: explicit per-item output shape control.
   *
   * When present, ParallelExecutor uses this shape directly and skips the
   * legacy `isStepExtractLike` heuristic. When absent and the SystemConfig
   * flag `pilot_scatter_explicit_shape_required` is true, runtime throws.
   * When absent and the flag is false (default), the heuristic runs as today.
   *
   * Shapes:
   *   - 'step_only': return the inner-step's data only (no merge with item).
   *     For multi-step bodies, returns the LAST step's data.
   *   - 'merge_with_item': `{...item, ...stepData}`.
   *   - 'merge_as_named_array': `{...item, [shapeField]: stepData}`.
   *     Requires `shapeField` to be set.
   *   - 'item_only': return the original item, dropping all step outputs.
   */
  shape?: 'step_only' | 'merge_with_item' | 'merge_as_named_array' | 'item_only';
  /** Required iff shape === 'merge_as_named_array'. */
  shapeField?: string;
  /** Existing runtime-only field — declared here for type coverage. */
  from?: string;
};
```

Adding `from` to the type is a cleanup bonus — currently it's accessed via `(scatterStep as any).gather?.from`.

### M2. `lib/pilot/ExecutionContext.ts` (MODIFY)

Add a 5th flag, same shape as the previous four:
- Private field `scatterExplicitShapeRequired: boolean = false`
- Constructor 9th positional arg
- Getter `isScatterExplicitShapeRequired(): boolean`
- `clone()` propagates it
- `logger.info` includes it

### M3. `lib/pilot/ParallelExecutor.ts` (MODIFY)

Inside `executeScatterItem`, just before the existing `// Check if we have step results to merge` block:

```ts
// Phase 6 — Tier 2 Fix #3: explicit shape policy
const gatherShape = (scatterStep as any).gather?.shape as
  | 'step_only' | 'merge_with_item' | 'merge_as_named_array' | 'item_only'
  | undefined;
const shapeField = (scatterStep as any).gather?.shapeField as string | undefined;

if (gatherShape) {
  mergedResult = this.applyExplicitGatherShape(gatherShape, shapeField, item, itemResults, steps, scatterStep);
} else if (parentContext.isScatterExplicitShapeRequired()) {
  throw new ExecutionError(
    `Scatter-gather step ${scatterStep.id}: gather.shape is required but not specified. ` +
    `Set one of: 'step_only', 'merge_with_item', 'merge_as_named_array', 'item_only'.`,
    scatterStep.id,
    { errorCode: 'SCATTER_SHAPE_REQUIRED' }
  );
} else {
  // ===== LEGACY HEURISTIC PATH — unchanged =====
  const isStepExtractLike = (stepId: string) => { ... };
  // (existing 80 lines of heuristic logic, no modification)
}
```

Add a new private method `applyExplicitGatherShape(...)` that implements D3's table deterministically.

### M4. `lib/pilot/WorkflowPilot.ts` (MODIFY)

Add the 5th flag to the parallel `Promise.all([...])` and pass through to both the main and sub-workflow `ExecutionContext` constructors:

```ts
SystemConfigService.getBoolean(
  this.supabase,
  'pilot_scatter_explicit_shape_required',
  false // Default: off — heuristic preserved
),
```

### M5. `lib/pilot/StateManager.ts` (MODIFY)

Resume path: add to the parallel flag-read block; pass to the reconstructed context.

### M6. `lib/pilot/__tests__/ParallelExecutor.scatter.test.ts` (NEW FILE)

Test matrix:

| # | Shape | shapeField | Body | Item | Expected output |
|---|---|---|---|---|---|
| SC1 | `step_only` | — | single step → `{a:1, b:2}` | `{x:9}` | `{a:1, b:2}` |
| SC2 | `merge_with_item` | — | single step → `{a:1}` | `{x:9}` | `{x:9, a:1}` |
| SC3 | `merge_as_named_array` | `'rows'` | single step → `[1,2,3]` | `{x:9}` | `{x:9, rows:[1,2,3]}` |
| SC4 | `merge_as_named_array` | (missing) | single step → `[1,2,3]` | `{x:9}` | **throws** "shapeField required" |
| SC5 | `item_only` | — | single step → `{a:1}` | `{x:9}` | `{x:9}` (step data dropped) |
| SC6 | `step_only` | — | multi-step → 1st `{a:1}`, last `{b:2}` | `{x:9}` | `{b:2}` (last step) |
| SC7 | `merge_with_item` | — | multi-step → 1st `{a:1}`, last `{b:2}` | `{x:9}` | `{x:9, a:1, b:2}` |
| SC8 | (absent) + flag off | — | single step → `{a:1, b:2}` | `{x:9}` | heuristic decides (extract-like ≥ 2 → `{a:1, b:2}`) |
| SC9 | (absent) + flag on | — | any | any | **throws** "gather.shape required" |
| SC10 | `step_only` + flag on | — | single step | any | works (flag doesn't apply when shape is present) |

### M7. `lib/pilot/__tests__/ExecutionContext.test.ts` (MODIFY)

Append two small tests:
- The new constructor arg sets `isScatterExplicitShapeRequired()`.
- `clone()` propagates the new flag.

---

## Behavior Contract

### Today (no changes shipped)
- Heuristic runs unconditionally. Same input → potentially different shapes depending on `ai_type` / `output_schema` / step count.

### After fix, flag OFF, no `shape` on workflow
- Identical to today. Heuristic runs. Zero regression.

### After fix, flag OFF, `shape` declared on workflow
- Runtime uses the declared shape. Heuristic skipped entirely for that step.

### After fix, flag ON, no `shape` on workflow
- Runtime throws `SCATTER_SHAPE_REQUIRED`. Workflow author must declare a shape.

### After fix, flag ON, `shape` declared
- Same as off+declared.

---

## Rollout

Same shape as Fixes #1–#5:

1. Ship with flag off. Workflows that declare `gather.shape` get deterministic behavior; everything else uses the heuristic. No regression.
2. (Compiler-side, separate workplan) Teach `ExecutionGraphCompiler` to emit `gather.shape` based on the IR. Begin with the obvious cases.
3. Enable the flag in staging. Replay corpus. Any workflow that hits `SCATTER_SHAPE_REQUIRED` is a compiler bug to fix.
4. Enable in production once the compiler is reliably emitting `shape`.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A workflow declares `shape` that conflicts with the heuristic's choice → behavior changes | Medium (by design) | Different output shape than today | This IS the point — the declared shape wins. Compiler authors must choose correctly. |
| R2 | A hand-authored DSL forgets `shapeField` for `merge_as_named_array` | Low | Step throws | Error message is explicit and actionable. Tested in SC4. |
| R3 | `(scatterStep as any).gather?.shape` cast — what if `gather` is missing entirely? | Low | Existing validation already throws "missing gather configuration" earlier (line 178). | Existing guard sufficient. |
| R4 | The `from` field type addition might conflict with where it's currently used | Very Low | Type error | `from` is already widely accessed via `as any`; widening the type is a strict superset. |
| R5 | Multi-step `merge_with_item` shape uses ALL step outputs — could blow up tokens like D-B25 | Medium | Token bloat reintroduced | Documentation in shape comment explicitly warns; compiler should prefer `step_only` for extract-like multi-step bodies. |

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (types) | 15 min |
| M2 (ExecutionContext) | 15 min |
| M3 (ParallelExecutor) | 45 min |
| M4 (WorkflowPilot) | 10 min |
| M5 (StateManager) | 10 min |
| M6 (scatter test file) | 1.5 hours |
| M7 (ExecutionContext test additions) | 15 min |
| TS check + verification | 30 min |
| **Total** | **~3.5 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
