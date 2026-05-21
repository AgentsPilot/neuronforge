# WP: Move Per-Execution State Off `WorkflowPilot` Instance

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/per-execution-state-to-context`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`WorkflowPilot.execute()` stuffs **7 distinct per-execution fields** onto its own instance via `(this as any).<field> = ...` and later reads them back the same way:

| Field | Type | Purpose |
|---|---|---|
| `stepEmitter` | `StepEmitter` | Caller-provided lifecycle callbacks |
| `debugRunId` | `string \| null` | Debug session id |
| `executionSummaryCollector` | `ExecutionSummaryCollector \| null` | Calibration summary |
| `_shadowAgent` | `ShadowAgent \| null` | Per-execution shadow agent |
| `_executionProtection` | `ExecutionProtection \| null` | Calibration guard rails |
| `_checkpointManager` | `CheckpointManager \| null` | Resume support |
| `_resumeOrchestrator` | `ResumeOrchestrator \| null` | Resume orchestration |

This is structurally unsafe. `WorkflowPilot` is constructed in route handlers like `app/api/run-agent/route.ts` and *could* be reused or pooled. Any concurrent or quasi-concurrent `execute()` call on the same instance corrupts the other's state — `stepEmitter` callbacks fire to the wrong SSE session, `_checkpointManager.clear()` clears the wrong execution's checkpoints, etc.

The fields are conceptually owned by **the execution**, not by the executor. `ExecutionContext` is already the per-execution object. This fix moves the 7 fields into a typed `scope` bag on `ExecutionContext` and replaces every `(this as any).X` access with `context.scope.X`.

## Goal

Eliminate **all** `(this as any).*` per-execution writes/reads from `WorkflowPilot.ts`. After this fix, two concurrent `execute()` calls on the same `WorkflowPilot` instance cannot corrupt each other's lifecycle resources.

## Non-Goals

- Refactoring `WorkflowPilot` into a fully stateless service (out of scope; the `parser`, `stepExecutor`, `stateManager`, etc. legitimately live on the instance).
- Changing the lifecycle of `ShadowAgent`, `CheckpointManager`, `ResumeOrchestrator`, or `ExecutionProtection` — only changing *where* the references are stored.
- Touching sub-workflow inheritance semantics beyond making them explicit.

---

## Design Decisions

### D1. New `ExecutionScope` bag on `ExecutionContext`

Add a single typed bag rather than 7 separate fields. Rationale:
- Keeps `ExecutionContext`'s public surface tidy (one new property).
- Makes the "this is the per-execution resource bundle" intent explicit.
- Single read/write namespace (`context.scope.X`).

Shape (in `lib/pilot/types.ts` to avoid circular imports):

```ts
import type { ShadowAgent } from './shadow/ShadowAgent';
import type { ExecutionProtection } from './shadow/ExecutionProtection';
import type { CheckpointManager } from './shadow/CheckpointManager';
import type { ResumeOrchestrator } from './shadow/ResumeOrchestrator';
import type { ExecutionSummaryCollector } from './shadow/ExecutionSummaryCollector';

export interface StepEmitter {
  onStepStarted?: (stepId: string, stepName: string) => void;
  onStepCompleted?: (stepId: string, stepName: string) => void;
  onStepFailed?: (stepId: string, stepName: string, error: string) => void;
}

export interface ExecutionScope {
  stepEmitter?: StepEmitter;
  debugRunId: string | null;
  executionSummaryCollector: ExecutionSummaryCollector | null;
  shadowAgent: ShadowAgent | null;
  executionProtection: ExecutionProtection | null;
  checkpointManager: CheckpointManager | null;
  resumeOrchestrator: ResumeOrchestrator | null;
}
```

All `import type` only — zero runtime imports added to `ExecutionContext.ts` or `types.ts`. The shadow classes don't move and don't change.

### D2. Initialization

`ExecutionContext` constructor initializes `scope` with all-null defaults. `WorkflowPilot.execute()` mutates `context.scope.X = Y` after `context` is created (the existing `(this as any).X = Y` lines move *down* past the `new ExecutionContext(...)` call).

For the two fields written **before** `context` is created today (`stepEmitter` at line 217, `debugRunId` at line 218): use local variables, then assign onto `context.scope` after construction. The intermediate-window mutation goes away — those writes today were also unsafe.

### D3. `clone()` propagates `scope` by reference

Loop iterations and scatter items share the same shadow agent, checkpoint manager, etc. — they aren't per-iteration. `clone()` shallow-copies the `scope` reference; mutations to the inner objects propagate as expected (which is what today's `(this as any)` model already implicitly relies on).

### D4. Sub-workflow contexts inherit `scope` by reference

Lines 1854–1861 already inherit `batchCalibrationMode` and (per Fix #2) `strict`. Inheriting `scope` is the same pattern. Sub-workflow steps will emit lifecycle events through the parent's `stepEmitter`, attach checkpoints to the parent's `_checkpointManager`, etc. — exactly today's behavior.

### D5. Resume path

`StateManager.resumeExecution` reconstructs `ExecutionContext` (touched in Fix #2 already). The resume path constructs a fresh `scope` with all-null defaults; `WorkflowPilot.resume()` then populates it via `context.scope.X = Y`, mirroring how `execute()` does. No surprise: today the `(this as any)._checkpointManager` reassignments at lines 2577–2588 are in the resume path; we move them onto `scope` too.

### D6. Backward compatibility

`ExecutionContext`'s existing constructor signature **doesn't change** (last arg is still `strict`, added in Fix #2). `scope` is initialized to defaults inside the constructor body — callers that don't set it (test helpers, sub-workflow paths) still work.

---

## File-by-File Changes

### M1. `lib/pilot/types.ts` (MODIFY)

Add `StepEmitter` interface and `ExecutionScope` interface (D1 above). All deps are `import type` so no runtime imports.

### M2. `lib/pilot/ExecutionContext.ts` (MODIFY)

1. Add `public scope: ExecutionScope` field with a private factory that returns the all-null default scope.
2. Initialize `this.scope = makeEmptyScope()` in the constructor.
3. In `clone()`, copy `scope` by reference (`cloned.scope = this.scope`).

### M3. `lib/pilot/WorkflowPilot.ts` (MODIFY)

Mechanical substitution at **all 17 sites** found in the grep map:

| Today | Becomes |
|---|---|
| `(this as any).stepEmitter = X` | `context.scope.stepEmitter = X` |
| `(this as any).debugRunId = X` | `context.scope.debugRunId = X` |
| `(this as any).executionSummaryCollector = X` | `context.scope.executionSummaryCollector = X` |
| `(this as any)._shadowAgent = X` | `context.scope.shadowAgent = X` |
| `(this as any)._executionProtection = X` | `context.scope.executionProtection = X` |
| `(this as any)._checkpointManager = X` | `context.scope.checkpointManager = X` |
| `(this as any)._resumeOrchestrator = X` | `context.scope.resumeOrchestrator = X` |
| `(this as any).X` (read) | `context.scope.X` |
| `(context as any).executionSummaryCollector` | `context.scope.executionSummaryCollector` (clean-up bonus) |
| `(parentContext as any).executionSummaryCollector` | `parentContext.scope.executionSummaryCollector` |
| `(subContext as any).executionSummaryCollector = ...` | `subContext.scope = parentContext.scope` (D4) |

Two of the writes (lines 217–218 for `stepEmitter` and `debugRunId`) must move below `new ExecutionContext(...)` (line 401). Local vars hold the values until then.

For the 8 read sites (lines 751, 870, 1117, 1118, 1455, 1469, 1547, 2733): verify each one has `context` (or a parent context) in scope before substitution. If not, thread it through the method signature.

### M4. `lib/pilot/__tests__/ExecutionContext.test.ts` (MODIFY)

Add small additions:

| # | Case | Expected |
|---|---|---|
| Sc1 | New context has `scope` populated with all-null defaults | yes |
| Sc2 | `scope.stepEmitter` is `undefined` on a fresh context | yes |
| Sc3 | `clone()` shares the same `scope` reference (shallow copy) | identity equal |
| Sc4 | Mutations to `scope` on parent visible on child via reference | yes |

### M5. `lib/pilot/__tests__/WorkflowPilot.concurrency.test.ts` (NEW — small)

The point of this fix. A regression test that proves two concurrent `execute()` calls on the same `WorkflowPilot` instance don't corrupt each other. Without real Supabase, we can't run a full execute(), but we **can** assert the structural property:

- Construct two `ExecutionContext` instances and write distinct values into their `scope` fields.
- Verify each context sees only its own values (no cross-contamination).
- Confirm `clone()` propagates scope by reference, not by deep copy.

This is the minimal proof that scope state is request-scoped. A full E2E concurrency test against Supabase is out of scope.

---

## Behavior Contract

### Before
- `WorkflowPilot` instance holds per-execution state. Concurrent runs cross-talk silently.

### After
- Per-execution state lives on `context.scope`. Two concurrent `execute()` calls on the same instance get distinct `ExecutionContext` instances with distinct scopes — no cross-talk possible.
- All other behavior (callbacks, checkpoints, shadow agent, etc.) is unchanged.

### Backward compatibility
- Single-execution case: identical behavior.
- Loops/scatter: identical (clone propagates scope by reference).
- Sub-workflows: identical (parent scope inherited explicitly).
- Resume: identical (scope reconstructed during resume).

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A `(this as any).X` read site exists that I missed and was reading after the corresponding write | Low | Read returns undefined, breaks lifecycle | Comprehensive grep map collected above (17 sites); plus TS compile checks |
| R2 | The `(context as any).executionSummaryCollector` reads occur somewhere outside `WorkflowPilot.ts` | Low | Lost reference in nested step execution | Grep audit shows only `WorkflowPilot.ts` reads/writes this — but I will re-check inside `StepExecutor.ts` and `ParallelExecutor.ts` before edits |
| R3 | `import type` from shadow files creates a hidden circular dep | Very Low | Compile fails | `import type` is erased; only structural typing affects compile graph |
| R4 | Resume path constructs a context without populating scope, leaving null checkpoint manager when it shouldn't | Medium | Resume silently no-ops checkpoints | Already true today (line 2577 mutates `this`). The fix preserves that exact assignment, just on `context.scope` instead of `this`. |
| R5 | Race condition that is real today might not manifest under typical Vercel cold-start patterns (so we can't write a failing test that reproduces) | Certain | Test coverage is structural, not behavioral | Acceptable — the fix is structural, and the structural test in M5 is sufficient |

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (types.ts additions) | 15 min |
| M2 (ExecutionContext.ts) | 30 min |
| M3 (WorkflowPilot.ts — 17 sites, audit each) | 1.5 hours |
| M4 (existing tests extension) | 30 min |
| M5 (concurrency test) | 30 min |
| TS check + verification | 30 min |
| **Total** | **~4 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
