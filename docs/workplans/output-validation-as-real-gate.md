# WP: Output Validation as a Real Gate

> **Last Updated**: 2026-05-12
> **Status**: 📋 WORKPLAN — implementing
> **Author**: Dev agent

## Overview

`WorkflowPilot.execute()` validates the final output against `agent.output_schema` at two sites:

- Line 633 (main execute path)
- Line 2897 (resume path)

In both cases, **validation failure becomes a `console.warn`, not an error**:

```ts
if (!validationResult.valid) {
  console.warn(`⚠️  [WorkflowPilot] Output validation failed:`, validationResult.errors);
  // Don't fail execution, just log warning
}
```

So a workflow that produces malformed output (missing required fields, wrong types) is still marked `success: true`. This is H-12 from the execution layer review.

## Goal

In `runMode === 'production'`, output validation failures throw `ValidationError`, causing the workflow to be marked failed and emitting the standard `PILOT_EXECUTION_FAILED` audit event. In `calibration` / `batch_calibration`, today's warning-only behavior is preserved.

## Why no feature flag

Like Fix #4 (`runMode` into scatter failures), this is bug-fix territory — the documented `runMode='production'` contract says "stop on first error." Silent output-schema mismatches are exactly the class the contract was meant to surface.

The rollback path if a workflow regresses: switch the affected agent's `runMode` to `'calibration'` via the existing plumbing, which preserves today's behavior while investigating.

## Changes

### M1. `lib/pilot/WorkflowPilot.ts:633` (main execute path)

```ts
// BEFORE
if (!validationResult.valid) {
  console.warn(`⚠️  [WorkflowPilot] Output validation failed:`, validationResult.errors);
  // Don't fail execution, just log warning
}

// AFTER
if (!validationResult.valid) {
  if (context.runMode === 'production') {
    throw new ValidationError(
      `Workflow output failed schema validation: ${validationResult.errors.join('; ')}`,
      undefined,
      {
        agent_id: agent.id,
        execution_id: executionId,
        validation_errors: validationResult.errors,
        run_mode: context.runMode,
      }
    );
  }
  console.warn(`⚠️  [WorkflowPilot] Output validation failed (runMode=${context.runMode}):`, validationResult.errors);
}
```

### M2. `lib/pilot/WorkflowPilot.ts:2897` (resume path)

Same shape — read `context.runMode` from the reconstructed context, throw in production, warn otherwise.

### M3. Tests

The shipping pattern of this fix is the same as Fix #4 (no flag, runMode-gated). For a quick verification we'd want an integration test, but since `WorkflowPilot.execute()` requires a real Supabase client, this is out of scope for a unit-test-only verification. A note will be added to the workplan for the QA agent to add an integration test later. Type-check + existing tests must still pass.

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A workflow produces output that schema-validates today but breaks under stricter type-check after some downstream change | Low | New failure | The validator itself is unchanged — only the consequence on failure changes. |
| R2 | `agent.output_schema` is malformed / undefined | None | N/A | `OutputValidator.validate` already short-circuits with `valid: true` when `!schema || schema.length === 0` (line 29). |
| R3 | Resume of an in-flight execution: original ran lenient, resume runs strict | Low | Resume fails on output validation it wouldn't have caught originally | `StateManager.resumeExecution` persists `runMode`; the resumed context uses the same mode. No regression. |

## Estimated Effort

~30 minutes total. M1 + M2 + TS check + run existing tests.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent |
