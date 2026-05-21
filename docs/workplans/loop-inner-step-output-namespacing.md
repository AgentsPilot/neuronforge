# WP: Loop Inner-Step Output Namespacing

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/loop-inner-step-namespacing`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`ParallelExecutor.executeLoopIteration` writes each loop iteration's inner-step output to the parent `ExecutionContext` under **the inner step's own id** — silently overwriting the previous iteration:

```ts
// lib/pilot/ParallelExecutor.ts:880–885
const namespacedStepId = `${step.id}_iteration${index}`;
parentContext.setStepOutput(namespacedStepId, output);
parentContext.setStepOutput(step.id, output); // Latest iteration overwrites previous
```

After the loop completes, `{{step5.data}}` resolves to **only the last iteration's output** even though the loop ran N times. This is the H-1 finding from the execution layer review and one of the most common sources of "valid JSON, wrong runtime data" bugs.

**What today already works correctly:**
- `{{loopStep.data}}` — the LOOP step's own output IS the aggregated array of iteration results. Set in `WorkflowPilot.ts:1266`. **No change needed here.**

**What's broken:**
- `{{innerStepId.data}}` after the loop = silently the last iteration's data, not surfaced as a bug.

**What's hidden but works:**
- `{{innerStepId_iteration0.data}}` — the per-iteration namespace IS written but undocumented and not used by any compiler-emitted DSL.

## Goal

Remove the silent overwrite so that broken `{{innerStepId.data}}` references **fail loud** (especially when Fix #2's strict resolution is also enabled) instead of returning the last iteration's data. Preserve UI completion tracking. Preserve aggregated loop access via `{{loopStep.data}}`. Document the per-iteration namespace.

## Non-Goals

- Changing `{{loopStep.data}}` semantics — it already returns the aggregated array correctly.
- Changing scatter-gather behavior — `executeScatterItem` writes to a **cloned `itemContext`**, not the parent, so the same bug class doesn't apply.
- Compiler-side migration of existing workflows that reference inner step ids after a loop (those are bugs by definition).

---

## Design Decisions

### D1. Inner-step write becomes namespaced-only

When the fix is enabled, the inner-step `setStepOutput(step.id, output)` line is **removed**. Only `setStepOutput(${step.id}_iteration${index}, output)` runs. Effect:

- `{{innerStepId.data}}` — throws `VariableResolutionError` ("Step innerStepId has not been executed yet or does not exist"). Already today's behavior for unknown step IDs. With Fix #2 (strict resolution), the message is even more actionable.
- `{{innerStepId_iteration0.data}}` — works.
- `{{loopStep.data}}` — unchanged.

### D2. UI completion tracking is preserved

`setStepOutput` is also what pushes a step into `context.completedSteps`. Dropping the inner-step write would remove `innerStepId` from `completedSteps`, breaking the UI status check ("step5 completed").

Fix: add a small `markStepCompletion(stepId, success)` method on `ExecutionContext` that mutates `completedSteps` / `failedSteps` arrays **without** touching `stepOutputs`. The loop iteration calls it once after all iterations finish, with the aggregate success status.

### D3. Feature-flag gating (consistent with Fix #1, #2, #3)

Add SystemConfig flag `pilot_loop_inner_step_overwrite_disabled` (default `false`). When `false` (default), today's overwrite behavior is preserved — zero regression. When `true`, the fix activates.

Stored as a per-execution boolean on `ExecutionContext` (constructor arg, same shape as `strict` in Fix #2). `WorkflowPilot.execute()` reads the flag and passes it down. `ParallelExecutor.executeLoopIteration` reads it from context.

### D4. Per-iteration namespace becomes documented public surface

Today the `_iteration<N>` suffix is an internal artifact. With this fix, it becomes the **canonical** way to reference a specific iteration's inner-step output. Document this in:

- The workplan (here).
- A small JSDoc comment on `ParallelExecutor.executeLoopIteration`.
- (Follow-up, not in scope) the compiler/DSL system prompt that teaches the LLM about this namespace.

### D5. Inheritance through clones

`ExecutionContext.clone()` already propagates the strict flag (Fix #2) and the scope (Fix #3). Adding `loopInnerOverwriteDisabled` to clone is the same one-line pattern.

---

## File-by-File Changes

### M1. `lib/pilot/ExecutionContext.ts` (MODIFY)

1. Add a private field `loopInnerOverwriteDisabled: boolean = false`.
2. Extend the constructor signature with one optional `loopInnerOverwriteDisabled?: boolean` after `strict`.
3. Add a getter `isLoopInnerOverwriteDisabled(): boolean`.
4. Add a new public method `markStepCompletion(stepId: string, success: boolean): void` that updates `completedSteps` / `failedSteps` without touching `stepOutputs` and without adjusting token totals.
5. In `clone()`, pass `this.loopInnerOverwriteDisabled` to the cloned constructor.

### M2. `lib/pilot/ParallelExecutor.ts` (MODIFY)

Inside `executeLoopIteration` (lines 880–885):

```ts
// BEFORE
const namespacedStepId = `${step.id}_iteration${index}`;
parentContext.setStepOutput(namespacedStepId, output);
parentContext.setStepOutput(step.id, output); // Latest iteration overwrites previous

// AFTER
const namespacedStepId = `${step.id}_iteration${index}`;
parentContext.setStepOutput(namespacedStepId, output);

if (parentContext.isLoopInnerOverwriteDisabled()) {
  // Phase 6 — Tier 2 Fix #1: don't pollute the parent stepOutputs map with the
  // inner step id, which previously caused {{stepId.data}} to silently resolve
  // to only the last iteration. Mark completion without writing the output, so
  // UI status tracking still works.
  parentContext.markStepCompletion(step.id, output.metadata.success);
} else {
  // Legacy behavior preserved when the flag is off.
  parentContext.setStepOutput(step.id, output);
}
```

Add a docblock comment above `executeLoopIteration` documenting the per-iteration namespace as the canonical way to reference a specific iteration's output.

### M3. `lib/pilot/WorkflowPilot.ts` (MODIFY)

1. Read the new SystemConfig flag alongside the existing two (Fix #1, Fix #2):

```ts
const [strictFieldValidation, strictVariableResolution, loopInnerOverwriteDisabled] =
  await Promise.all([
    SystemConfigService.getBoolean(this.supabase, 'pilot_strict_field_validation_enabled', false),
    SystemConfigService.getBoolean(this.supabase, 'pilot_strict_variable_resolution_enabled', false),
    SystemConfigService.getBoolean(this.supabase, 'pilot_loop_inner_step_overwrite_disabled', false),
  ]);
```

2. Pass into the `ExecutionContext` constructor (after `isStrictResolution`):

```ts
context = new ExecutionContext(
  executionId,
  agent,
  userId,
  finalSessionId,
  inputValues,
  isBatchCalibration,
  isStrictResolution,
  loopInnerOverwriteDisabled, // NEW
);
```

3. Also pass into the sub-workflow `new ExecutionContext(...)` at line 1868 — it should inherit the parent's behavior.

### M4. `lib/pilot/StateManager.ts` (MODIFY)

Resume path also needs to read the flag and pass to the reconstructed context (mirroring how Fix #2 added `isStrictResolution`).

### M5. `lib/pilot/__tests__/ExecutionContext.test.ts` (MODIFY)

Add tests:

| # | Case | Expected |
|---|---|---|
| L1 | `markStepCompletion('step5', true)` adds to `completedSteps` | yes |
| L2 | `markStepCompletion('step5', false)` adds to `failedSteps` | yes |
| L3 | `markStepCompletion` does NOT add to `stepOutputs` | `stepOutputs.has('step5') === false` |
| L4 | `isLoopInnerOverwriteDisabled()` defaults to false | yes |
| L5 | Constructor arg sets the flag | yes |
| L6 | `clone()` preserves the flag | yes |

### M6. `lib/pilot/__tests__/ParallelExecutor.test.ts` (NEW FILE)

A small integration test for the loop behavior:

| # | Case | Flag | Expected |
|---|---|---|---|
| LP1 | Loop runs 3 iterations, inner step is `s5`. Read `{{s5.data}}` after loop | off (legacy) | resolves to iteration 2's data |
| LP2 | Same setup | on (fix) | `{{s5.data}}` throws (step not in stepOutputs) |
| LP3 | Same setup | on (fix) | `{{s5_iteration0.data}}`, `{{s5_iteration1.data}}`, `{{s5_iteration2.data}}` all resolve correctly |
| LP4 | Same setup | on (fix) | `context.completedSteps` includes `'s5'` exactly once (UI tracking preserved) |
| LP5 | Same setup | on (fix) | The LOOP step's own id resolves to the aggregated array (unchanged behavior) |

This requires a minimal stub `StepExecutor` for the test — since `ParallelExecutor` depends on it. Test will use a fake `StepExecutor` that returns canned outputs.

---

## Behavior Contract

### Flag OFF (default)
- Identical to today. `{{innerStepId.data}}` after a loop returns the last iteration. The per-iteration namespace still gets written, just unused.

### Flag ON + lenient resolution (Fix #2 off)
- `{{innerStepId.data}}` throws "Step innerStepId has not been executed yet or does not exist."
- `{{innerStepId_iteration0.data}}` works.
- `{{loopId.data}}` works (unchanged).
- UI shows `innerStepId` as completed (preserved via `markStepCompletion`).

### Flag ON + strict resolution (Fix #2 on)
- Same as above, but with strict's better error messages (path + available keys).

---

## Rollout

Same shape as Fix #1, #2, #3:

1. Ship with flag `false`. Pure no-op.
2. Enable in dev/staging. Replay a corpus of workflows with loops. Count how many start failing (those are the broken-data-flow bugs the fix surfaces).
3. For each newly-surfaced failure: confirm the workflow actually expected the per-iteration data, not the last iteration. Migrate the DSL ref to `{{loopId.data}}` (most common case) or `{{innerStepId_iteration<N>.data}}` (rare).
4. Enable in production.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A production workflow legitimately relied on "last iteration's output" | Medium | Workflow fails with VariableResolutionError | Feature-flag gated; error message is loud and actionable; rollback is one toggle |
| R2 | `markStepCompletion` is called multiple times (once per iteration) for the same step id | Certain | `completedSteps` array has duplicates | Existing `setStepOutput` already de-dupes via `.includes()`; new method must do the same |
| R3 | `failedSteps` tracking when some iterations succeeded and others failed | Low | Status is "completed" or "failed" depending on which was last | We mark the LOOP step's success/failure status (which is what UI shows for loops). Per-iteration status is in the namespaced outputs. |
| R4 | Resume path reconstructs context without the flag, so a partially-completed loop run resumes with different semantics | Low | Flag value persisted in SystemConfig (global, not per-execution), so resume re-reads it; consistent | StateManager change in M4 |
| R5 | Test setup for `ParallelExecutor.test.ts` requires a stub StepExecutor; mocking might mask the real bug | Medium | False positives in tests | Use minimal interface-based mock with explicit returned outputs; verify against actual call patterns |
| R6 | Sub-workflows inside loops: nested loop inner-step gets the same treatment | Low | Same semantics | M3 already passes flag to sub-workflow context |

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (ExecutionContext changes) | 30 min |
| M2 (ParallelExecutor.executeLoopIteration) | 15 min |
| M3 (WorkflowPilot wiring) | 15 min |
| M4 (StateManager resume path) | 15 min |
| M5 (existing tests extension) | 30 min |
| M6 (new ParallelExecutor.test.ts) | 1 hour |
| TS check + verification | 30 min |
| **Total** | **~3 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
