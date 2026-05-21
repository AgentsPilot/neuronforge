# WP: Strict Variable Resolution Mode in ExecutionContext

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/strict-variable-resolution`)
> **Author**: Dev agent (draft)
> **Status**: 📋 WORKPLAN — implementing (SA review skipped per user direction)

---

## Overview

`ExecutionContext` resolves variable references (`{{step5.email}}`, `{{input.name}}`, `{{current.x}}`) with three layers of forgiving behavior that silently transmute broken references into "almost right" values:

| Forgiving behavior | Location | What it hides |
|---|---|---|
| Auto-`.data` navigation when first prop isn't a top-level field | `ExecutionContext.ts:478–491` | LLM-generated refs that omit `.data` |
| Fuzzy snake↔camel↔Pascal↔lowercase key matching | `ExecutionContext.ts:596–646` (`findMatchingKey`) | Convention mismatches and typos |
| `getNestedValue` returns `undefined` silently for missing keys | `ExecutionContext.ts:651–745` | Cascading nulls with no runtime assertion |
| Inline template substitution catches errors and returns the raw `{{...}}` token | `ExecutionContext.ts:301–317` (`resolveAllVariables`) | Failed resolutions disappear into output strings |

This is "Tier 1 Fix #2" from the execution layer review (kills H-5).

## Goal

Add an opt-in **strict resolution mode** that disables the three forgiving paths and re-throws inline substitution errors. Default off; enabled per-env via a SystemConfig flag, then propagated through `WorkflowPilot.execute()` → `ExecutionContext` constructor.

## Non-Goals

- Changing the inline `new Function()` evaluation in `resolveLiteralWithVariables` (that's Fix #6 in the review).
- Touching `ConditionalEvaluator`'s separate `resolveVariablesInExpression` (different code path; covered by Fix #5).
- Removing the auto-`.data` / fuzzy behavior in lenient mode — only adding a strict-mode bypass.

---

## Design Decisions

### D1. What "strict" disables

When `strict === true`:

1. **No auto-`.data` navigation.** A reference like `{{step5.email}}` must say `{{step5.data.email}}`. If `email` is not a direct property of the `StepOutput` envelope (`stepId | plugin | action | data | metadata`), throw.
2. **No fuzzy key matching.** `findMatchingKey` is bypassed; the original `part in current` check decides exact-key existence.
3. **`getNestedValue` throws on missing keys** instead of returning `undefined`. Mid-traversal `current === undefined` also throws. **Explicit `null` is still returned as-is** (legitimate API response).
4. **`resolveAllVariables` does not swallow inline-substitution errors.** Throws instead.

### D2. Lenient mode is unchanged

When `strict === false` (default), every line of behavior is identical to today. This is a no-op for existing workflows.

### D3. Wiring — flag + run-mode gating

Reuse the same gating shape as Fix #1:

- SystemConfig key: `pilot_strict_variable_resolution_enabled` (boolean, default `false`).
- `WorkflowPilot.execute()` reads the flag once, alongside `pilot_strict_field_validation_enabled`.
- Strict is enabled only when **flag is true AND `runMode === 'production'`**. Calibration runs stay lenient (because calibration's whole job is to surface bad workflows without breaking the user — the strict errors would be too coarse).
- `ExecutionContext` constructor gets a new optional `strict: boolean` parameter, defaulting to `false`.

### D4. Distinguish "key not declared" from "key declared but undefined"

The existing `getNestedValue` already makes this distinction via `part in current`:
- `part in current === true` → key declared; current value (possibly `null`/`undefined`) is honored.
- `part in current === false` → key not declared → today returns `undefined` silently; in strict mode → throw.

This means optional plugin output fields that legitimately come back `undefined` will still resolve cleanly. Only references to keys that don't exist in the producer's output at all will throw.

### D5. Error type

Reuse the existing `VariableResolutionError` from `lib/pilot/types.ts`. No new error class. Message format:

```
Variable '<full-path>' could not be resolved: key '<missing-part>' not found on <type-of-current>. Available keys: <comma-separated>.
```

Including the available keys is the actionable hint the user needs. Cap at 8 keys to avoid log spam.

### D6. Scope of error propagation

Strict errors thrown during resolution will bubble up through `StepExecutor` and be classified by `ErrorRecovery` as `non-retryable` (they're deterministic bugs, not transient). The step fails with a clear message; the workflow fails with a `PILOT_EXECUTION_FAILED` audit event. No new event type needed.

---

## File-by-File Changes

### M1. `lib/pilot/ExecutionContext.ts` (MODIFY)

**Change 1 — Add a private `strict` field and constructor param.**
- Add `private strict: boolean = false;` near the other private fields.
- Extend the constructor signature with one optional `strict?: boolean` after `batchCalibrationMode`.
- Assign `this.strict = strict ?? false;` in the constructor body.

**Change 2 — `resolveSimpleVariable` — gate the auto-`.data` block (lines 478–491).**
- Wrap the auto-navigate logic in `if (!this.strict)`. In strict mode, fall through to the normal `getNestedValue(stepOutput, remainingPath)` call.

**Change 3 — `findMatchingKey` — bypass in strict mode.**
- Callers go through `getNestedValue`. The change is *in the caller*: when strict, skip the `findMatchingKey` fallback and go straight to "throw or return undefined."

**Change 4 — `getNestedValue` — throw on missing keys when strict.**
- When `current === undefined` mid-traversal AND `this.strict`: throw `VariableResolutionError` with path + last-known-keys.
- When `part in current` is `false` AND `this.strict`: throw the same.
- When `part in current` is `false` AND NOT strict: keep the existing `findMatchingKey` fuzzy fallback.

**Change 5 — `resolveAllVariables` — re-throw inline-substitution errors when strict (lines 301–317).**
- In the `.replace` callback's `catch (error)` block: if `this.strict`, re-throw. Otherwise keep existing `logger.warn` + return-`match` behavior.

**Change 6 — `clone()` — preserve `strict` (lines 800–838).**
- Pass `this.strict` to the cloned constructor so loop/scatter iterations inherit strictness.

### M2. `lib/pilot/WorkflowPilot.ts` (MODIFY)

**Change 1 — Read the new flag near the field-validation flag** (already at lines 325–340 after Fix #1).

```ts
const strictVariableResolution = await SystemConfigService.getBoolean(
  this.supabase,
  'pilot_strict_variable_resolution_enabled',
  false // Default: off — fully backward-compatible
);
```

**Change 2 — Pass strict into the ExecutionContext constructor** (around line 368).

```ts
const isBatchCalibration = runMode === 'batch_calibration';
const isStrictResolution =
  strictVariableResolution &&
  runMode === 'production';

context = new ExecutionContext(
  executionId,
  agent,
  userId,
  finalSessionId,
  inputValues,
  isBatchCalibration,
  isStrictResolution // NEW
);
```

### M3. `lib/pilot/__tests__/ExecutionContext.test.ts` (NEW FILE)

Test matrix (selected cases):

| # | Case | Strict mode | Expected |
|---|---|---|---|
| S1 | `{{step1.data.email}}` where `step1.data.email === "x@y.com"` | strict | resolves to `"x@y.com"` |
| S2 | `{{step1.email}}` (auto-`.data` reliance) where data has `email` | strict | **throws** `VariableResolutionError` |
| S3 | Same as S2 but lenient | lenient | resolves via auto-`.data` |
| S4 | `{{step1.data.EMAIL}}` where data has `email` (case mismatch) | strict | **throws** |
| S5 | Same as S4 but lenient | lenient | resolves via fuzzy match |
| S6 | `{{step1.data.subject}}` where `data.subject === undefined` but key declared | strict | resolves to `undefined` (no throw) |
| S7 | `{{step1.data.nope}}` where key absent | strict | **throws** with "Available keys" hint |
| S8 | Inline `"Hello {{step1.data.name}}"` where name missing | strict | **throws** |
| S9 | Same as S8 | lenient | warns, leaves `{{...}}` token in output |
| S10 | `{{input.foo}}` where `foo` not supplied | strict | **throws** |
| S11 | `clone()` preserves strict flag | strict | cloned ctx is also strict |
| S12 | Explicit `null` value | strict | returns `null` (not throw) |

---

## Behavior Contract

### Before
- Broken refs silently resolve to `undefined`.
- Wrong case (`EMAIL` vs `email`) silently resolves to the right field.
- Missing `.data` segment silently auto-fills.

### After, flag OFF (default)
- Identical to before. Zero regression risk.

### After, flag ON + production runMode
- Any non-exact reference throws a `VariableResolutionError` with the full path + available keys at the failing segment.
- The step fails (existing `ErrorRecovery` path). The workflow fails with the existing `PILOT_EXECUTION_FAILED` audit event.

---

## Rollout

Same shape as Fix #1:

1. Ship with flag `false`. Pure no-op.
2. Enable in dev/staging. Replay last N production workflows; count `VariableResolutionError`s.
3. Compare against the warnings already emitted by Fix #1's strict field validation — high overlap indicates Fix #1 caught it at preflight already (good); divergence indicates a runtime-only path.
4. Enable in production once false-positive rate is acceptable.
5. Rollback is a single SystemConfig toggle.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Real workflows rely on auto-`.data` / fuzzy matching today | High | Strict mode breaks them | Default off; staged rollout; Fix #1 already surfaces most of these at preflight |
| R2 | Plugin outputs sometimes contain explicit `undefined` values that look like missing keys | Low | False-positive strict throws | We distinguish via `part in current` — explicit `undefined` is fine |
| R3 | `resolveAllVariables` is called on many objects during execution; throwing inline interrupts a step entirely | Medium | A single bad ref fails the whole step | This is the intended behavior — surfacing the bug |
| R4 | Cloned contexts (loops/scatter) need to inherit strict | Certain | Without this, nested executions silently degrade | Explicitly tested in S11 |
| R5 | Test for "explicit `undefined` value" depends on the producer using `'key' in obj` semantics | Low | Test could be flaky | Using direct object literal in tests guarantees `'key' in obj` |

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (ExecutionContext.ts changes) | 1.5 hours |
| M2 (WorkflowPilot.ts wiring) | 15 min |
| M3 (new test file with 12 cases) | 1.5 hours |
| Local verification | 30 min |
| **Total** | **~4 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft |
