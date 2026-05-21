# WP: Propagate `runMode` into Scatter-Gather Failure Handling

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/runmode-into-scatter-failures`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`WorkflowPilot.execute()` accepts a `runMode` parameter with three values:

| runMode | Documented contract |
|---|---|
| `production` (default) | Stop on first error, throw exceptions |
| `calibration` | Collect issues, attempt auto-repairs, continue on recoverable errors |
| `batch_calibration` | Same as calibration but optimized for bulk testing |

The contract holds at the top level — `WorkflowPilot.execute()` throws the first uncaught error in production mode. But **`ParallelExecutor.executeScatterItem` (`ParallelExecutor.ts:680–691`) silently swallows per-item failures regardless of runMode**:

```ts
} catch (error: any) {
  logger.warn({ itemIndex: index, error: error.message }, 'Scatter item failed');
  return {
    result: { error: error.message, item: index },
    ...
  };
}
```

The caller (`executeScatter` lines 261–298) then partitions the swallowed errors out of `successResults` and only throws if **ALL** items failed. So:

- A 100-item scatter with 99 successes + 1 failure → workflow continues silently in production mode.
- The 1 failure is recorded as `{ error, item }` in `_scatter_metadata` attached as a non-enumerable-looking property of the result array (which won't survive JSON serialization through Supabase).

This contradicts the documented "production = stop on first error" contract. This is H-8 from the execution layer review.

## Goal

Make scatter-item failures honor `runMode`:
- **`production`**: first item failure re-throws → `Promise.all` rejects → scatter fails → workflow fails (matches documented contract).
- **`calibration` / `batch_calibration`**: today's behavior preserved (swallow to error metadata; only fail if all items failed). Calibration's job is to surface as many issues as possible without stopping.

## Non-Goals

- Changing loop iteration failure semantics. Loops already throw on iteration failure unless `loopStep.continueOnError` is set — that's a per-step contract, not a runMode contract. (Verified in `executeLoopIteration` lines 887–907 and the outer catch at 996–1011.)
- Fixing the `_scatter_metadata` non-serializable-property issue (it's H-8b in the review — separate concern).
- Adding new runMode values.

---

## Design Decisions

### D1. Store `runMode` on `ExecutionContext`

Currently `ExecutionContext` derives `batchCalibrationMode` from `runMode` (constructor's `batchCalibrationMode` boolean is set by `WorkflowPilot.execute()` via `runMode === 'batch_calibration'`). For this fix we need the full 3-value enum, not just the boolean.

Add a public `runMode` field on `ExecutionContext`. Set from constructor (existing positional arg pattern — 11th arg). Backward-compatible default is `'production'` to match `WorkflowPilot.execute()`'s default.

### D2. `ParallelExecutor.executeScatterItem` re-throws in production

In the catch block at lines 680–691, before constructing the `{ result: { error, item } }` return value, check `parentContext.runMode`:

```ts
} catch (error: any) {
  if (parentContext.runMode === 'production') {
    // Honor the documented production contract: fail fast on first item failure.
    throw error;
  }
  // Calibration / batch_calibration: today's behavior preserved.
  logger.warn(...);
  return { result: { error: error.message, item: index }, ... };
}
```

When `Promise.all` rejects (because one of the scattered items threw), the outer `executeScatter` propagates the rejection up to `executeScatterGather` → `StepExecutor` → `WorkflowPilot.execute()`'s outer catch.

### D3. Inner-step failures with `metadata.success === false` (not exceptions)

Line 463–468 already throws for these:

```ts
throw new ExecutionError(
  `Scatter item ${index} failed at step ${step.id}: ${output.metadata.error}`,
  scatterStep.id,
  { item: index, failedStep: step.id, error: output.metadata.error, ... }
);
```

That throw is currently caught by the outer catch (line 681) and swallowed in production. With D2 in place, it now propagates correctly. No additional change needed.

### D4. No new feature flag for this fix

Unlike the previous fixes, this one **does not get a flag**. The documented contract is unambiguous: production should stop on first error. The current behavior is a bug, not a deliberate design choice. Switching to flag-gated rollout would invite "but what if a workflow depends on the swallow?" — a workflow that depended on silent swallow in production was already broken.

That said, the **rollout path** still allows safe verification: any workflow that was implicitly relying on the swallow will now fail loudly with a clear error, which is the desired surface area. If post-deploy logs show legitimate failures, the operator can switch the affected agents to `runMode='calibration'` while investigating.

### D5. `runMode` flows through clone/sub-workflow/resume

Same pattern as the previous five flags:
- `clone()` propagates `runMode`.
- Sub-workflow context inherits `parentContext.runMode`.
- `StateManager.resumeExecution` uses the same `runMode` that's already extracted from `data.run_mode` on the execution record (line 752 of `StateManager.ts`).

---

## File-by-File Changes

### M1. `lib/pilot/ExecutionContext.ts` (MODIFY)

- Add a public field `runMode: 'production' | 'calibration' | 'batch_calibration'`.
- Constructor 11th positional arg, default `'production'`.
- `clone()` propagates it.
- `logger.info` includes it.

### M2. `lib/pilot/ParallelExecutor.ts` (MODIFY)

- Inside `executeScatterItem`'s catch block (lines 680–691), check `parentContext.runMode === 'production'` and re-throw.
- Add a docblock comment at the top of `executeScatterItem` describing the runMode-aware failure semantics.

### M3. `lib/pilot/WorkflowPilot.ts` (MODIFY)

- Pass `runMode` into the main `ExecutionContext` constructor as the new 11th arg.
- Sub-workflow context inherits `parentContext.runMode`.

### M4. `lib/pilot/StateManager.ts` (MODIFY)

- Resume path passes the existing `runMode` variable into the reconstructed context (it's already in scope at line 752).

### M5. `lib/pilot/__tests__/ExecutionContext.test.ts` (MODIFY)

Append:
- `runMode` defaults to `'production'` when omitted.
- Constructor arg sets it.
- `clone()` propagates it.

### M6. `lib/pilot/__tests__/ParallelExecutor.scatter.test.ts` (MODIFY)

Append:
- A scatter where one item throws an unrecoverable error inside its inner step. In `production` mode, the scatter-gather call rejects with that error. In `calibration` mode, it succeeds and the failed item is partitioned into `_scatter_metadata` (today's behavior).

---

## Behavior Contract

### Before
- production mode + scatter with partial failures → silently succeeds, failures hidden in non-serializable `_scatter_metadata`.

### After
- production mode + scatter with partial failures → first failure re-thrown → scatter fails → workflow fails → audit event emitted with the actual error.
- calibration / batch_calibration → unchanged.

### Rollout

No flag — direct fix. The rollback path if a regression appears is to switch the affected agent to `runMode='calibration'` via the existing run-mode plumbing. That gives the operator the same forgiveness as today while a proper fix is implemented.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A production workflow was implicitly relying on silent scatter-item failures | Medium | New visible failures | This is the intended surface area. Operators can switch the agent to `calibration` mode while investigating. |
| R2 | Plugin actions that fail mid-scatter cause partial side-effects (sent half the emails, then failed) | Existing today | Same as before — re-throwing doesn't change idempotency | Out of scope (Tier 3 #10 — idempotency keys). Documented in the review. |
| R3 | Loop iteration semantics accidentally changed | None | N/A | Loops are not touched. Only the scatter catch block changes. |
| R4 | `runMode` accessed without being set (test paths constructing ExecutionContext manually) | Low | undefined comparison → `=== 'production'` is false → today's behavior preserved | The default `'production'` in the constructor signature handles this; tests are also updated. |
| R5 | Concurrent scatter items each throwing → Promise.all rejects with the FIRST one, but others still complete (potentially with side-effects) | Existing today | Documented "fail fast" contract; partial side-effects unavoidable until idempotency fix | Out of scope; same risk as before with regards to writes. |

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (ExecutionContext field + clone) | 15 min |
| M2 (ParallelExecutor catch block) | 15 min |
| M3 (WorkflowPilot wiring) | 15 min |
| M4 (StateManager wiring) | 5 min |
| M5 (ExecutionContext tests) | 15 min |
| M6 (scatter failure tests) | 45 min |
| TS check + verification | 30 min |
| **Total** | **~2.5 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
