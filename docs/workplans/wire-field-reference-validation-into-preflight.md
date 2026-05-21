# WP: Wire Field-Reference Validation into Pre-Flight

> **Last Updated**: 2026-05-12
> **Branch**: TBD (suggest `fix/preflight-field-reference-validation`)
> **Author**: Dev agent (draft for SA review)
> **Status**: 📋 WORKPLAN — awaiting SA review

---

## Overview

The Pilot pre-flight validator (`WorkflowValidator.validatePreFlight()`) today checks only structural shape — step IDs, dependencies, cycles, known step types. It does **not** check that `{{step_N.field}}` references resolve to fields the producer step actually declares in its `output_schema`. The result is the recurring class of "valid JSON, broken graph" bugs: workflows pass pre-flight, then fail mid-execution because a downstream step references a field that doesn't exist upstream — or worse, silently resolves to `undefined` via `ExecutionContext`'s forgiving resolver.

Two field-reference validators **already exist** in the same file but are never called:

- `validateFieldReferences()` (line 641) — checks `{{variable.field}}` patterns in step configs against upstream `output_schema`
- `validateOperationFields()` (line 882) — checks raw field names in `filter`, `flatten`, `map` operation configs

This workplan wires both into `validatePreFlight()`, mapping their issue lists into pre-flight errors or warnings based on confidence and run mode.

---

## Goal

Convert the largest class of runtime semantic bugs into pre-flight errors with actionable messages, behind a feature flag for safe rollout.

## Non-Goals

- Cross-checking step `output_schema` against the underlying **plugin catalog** (follow-up: `wp-plugin-catalog-crosscheck`). Today's fix uses the schema the compiler stamped onto each step.
- Validating `{{input.X}}` references against `agent.input_schema` (follow-up).
- Loop iteration namespace fixes (H-1 in execution review — separate workplan).
- Replacing the existing fuzzy `findSimilarField` heuristic.

---

## Table of Contents

1. [Design Decisions](#design-decisions)
2. [File-by-File Changes](#file-by-file-changes)
3. [Behavior Contract](#behavior-contract)
4. [Rollout Plan](#rollout-plan)
5. [Risk Register](#risk-register)
6. [Tests](#tests)
7. [Open Questions for SA](#open-questions-for-sa)

---

## Design Decisions

### D1. Confidence → severity mapping

Both existing validators return issues with `confidence: number`. We map:

| Confidence | Severity in `production` mode | Severity in `calibration` mode |
|---|---|---|
| ≥ 0.95 | **error** (blocks execution) | warning |
| 0.70 – 0.95 | warning | warning |
| < 0.70 | dropped (too noisy) | dropped |

**Rationale:** 0.95+ means an exact (case-insensitive) match was found between the invalid ref and an available field — i.e. we're confident the workflow is wrong AND we have a concrete suggested fix. Below 0.70, false-positive risk outweighs signal.

### D2. Missing `output_schema` on the producer

If the referenced upstream step has no `output_schema` at all, today's validator silently returns (line 718: `if (!upstreamSchema) return;`). We will **add a single aggregated warning per workflow** (not per-reference) listing the producer step IDs that emit references with no declarable schema. This surfaces compiler-emission gaps without spamming users.

### D3. Run-mode awareness

`WorkflowPilot.execute()` already accepts `runMode?: 'production' | 'calibration' | 'batch_calibration'`. We will:

- Add a `runMode` parameter to `WorkflowValidator.validatePreFlight()`.
- Default to `'production'` if not supplied (matches `WorkflowPilot.execute()`'s default).
- Pass it through from `WorkflowPilot.ts:327` so calibration runs warn instead of block.

### D4. Feature-flag gating (safety)

Even with the confidence threshold, real workflows may currently rely on resolutions that the lenient runtime makes work. Ship behind a `SystemConfigService` boolean flag:

```
key: pilot_strict_field_validation_enabled
default: false
```

When `false`, all field-reference issues degrade to **warnings only**, regardless of confidence/runMode. When `true`, the D1 matrix applies. This lets us flip the gate per-environment and roll back instantly.

### D5. Where to call the new logic

Inside `validatePreFlight()` itself, after the existing structural checks (so structural errors still take precedence). The function signature becomes:

```ts
validatePreFlight(
  workflow: any[],
  options?: {
    runMode?: 'production' | 'calibration' | 'batch_calibration';
    strictFieldValidation?: boolean;
  }
): ValidationResult
```

This keeps both callers happy: existing callers that pass only `workflow` still work; the new caller in `WorkflowPilot.execute()` passes `runMode` and the resolved feature-flag value.

---

## File-by-File Changes

### M1. `lib/pilot/WorkflowValidator.ts` (MODIFY)

**Change 1 — Extend `validatePreFlight()` signature** (currently line 29):

```ts
// BEFORE
validatePreFlight(workflow: any[]): ValidationResult

// AFTER
validatePreFlight(
  workflow: any[],
  options?: {
    runMode?: 'production' | 'calibration' | 'batch_calibration';
    strictFieldValidation?: boolean;
  }
): ValidationResult
```

**Change 2 — After existing structural checks (after line ~159 where the existing function returns), add a new section:**

```ts
// ============================================================================
// Field-reference validation (Phase 6: catch broken {{step_N.field}} refs)
// ============================================================================
const runMode = options?.runMode ?? 'production';
const strict = options?.strictFieldValidation ?? false;

const fieldRefIssues = this.validateFieldReferences(workflow);
const operationFieldIssues = this.validateOperationFields(workflow);
const allIssues = [
  ...fieldRefIssues.map(i => ({ ...i, kind: 'field_reference' as const })),
  ...operationFieldIssues.map(i => ({ ...i, kind: 'operation_field' as const })),
];

for (const issue of allIssues) {
  if (issue.confidence < 0.70) continue;  // drop low-confidence noise

  const message = this.formatIssueMessage(issue);

  const shouldBlock =
    strict &&
    runMode === 'production' &&
    issue.confidence >= 0.95;

  if (shouldBlock) {
    errors.push(message);
  } else {
    warnings.push(message);
  }
}

// D2: aggregated "missing output_schema" warning
const stepsWithUnverifiableRefs = this.findStepsWithUnverifiableReferences(workflow);
if (stepsWithUnverifiableRefs.length > 0) {
  warnings.push(
    `Field references could not be validated for these producer steps (no output_schema): ` +
    stepsWithUnverifiableRefs.join(', ') +
    `. Consider regenerating with an updated compiler.`
  );
}
```

**Change 3 — Add three new private helpers:**

```ts
private formatIssueMessage(issue: FieldReferenceIssue | OperationFieldIssue): string {
  if (issue.kind === 'field_reference') {
    return (
      `Step '${issue.stepId}' references '${issue.invalidReference}' ` +
      `at parameter '${issue.parameter}' — ${issue.reason}. ` +
      `Suggested fix: '${issue.suggestedFix}' (confidence ${(issue.confidence * 100).toFixed(0)}%).`
    );
  } else {
    return (
      `Step '${issue.stepId}' ${issue.operation} operation uses field '${issue.invalidField}' — ` +
      `${issue.reason}. Suggested: '${issue.suggestedField}' ` +
      `(confidence ${(issue.confidence * 100).toFixed(0)}%).`
    );
  }
}

private findStepsWithUnverifiableReferences(workflow: any[]): string[] {
  // Walk all steps; collect upstream step IDs that are referenced but have no output_schema.
  // Implementation reuses existing collectSteps/extractVariableReferences helpers.
  // Returns deduped, sorted list.
}
```

(Plus a small union type for `FieldReferenceIssue | OperationFieldIssue` at module top.)

**No changes to** `validateFieldReferences` or `validateOperationFields` bodies — they already do the right thing.

---

### M2. `lib/pilot/WorkflowPilot.ts` (MODIFY)

**Change 1 — Resolve the feature flag once, alongside other config** (after line 222, near other `SystemConfigService.getBoolean` calls):

```ts
const strictFieldValidation = await SystemConfigService.getBoolean(
  this.supabase,
  'pilot_strict_field_validation_enabled',
  false  // Default: off (warnings only)
);
```

**Change 2 — Pass options into `validatePreFlight`** (line 327):

```ts
// BEFORE
const validation = this.workflowValidator.validatePreFlight(workflowSteps);

// AFTER
const validation = this.workflowValidator.validatePreFlight(workflowSteps, {
  runMode,
  strictFieldValidation,
});
```

The existing error/warning handling (lines 329–348) needs no changes — it already throws on `!valid` and logs warnings.

---

### M3. `lib/pilot/__tests__/WorkflowValidator.test.ts` (MODIFY)

Existing test file. Add cases:

| # | Case | Expected |
|---|---|---|
| T1 | Workflow with `{{step1.email}}` where `step1.output_schema` has `email` field | valid, no warnings |
| T2 | Workflow with `{{step1.emial}}` (typo) where `step1` has `email` field, runMode=production, strict=true | **error**, suggestion `email`, confidence ≥ 0.95 |
| T3 | Same as T2 but strict=false | warning only, no error |
| T4 | Same as T2 but runMode=calibration | warning only |
| T5 | `{{step1.content}}` where `step1` has only `data` — confidence ~0.5 | dropped, no error/warning |
| T6 | Filter operation `field: 'item.sender'` where upstream has `sender` (the `item.` prefix bug) | error in strict, suggestion `sender`, confidence 0.95 |
| T7 | Map operation with valid mapping → no issues | valid |
| T8 | Workflow where `step3.output_schema` is missing — referenced by step5 | aggregated warning lists `step3` |
| T9 | Mixed: 1 high-confidence + 1 low-confidence issue, strict=true, production | only high-confidence becomes error |
| T10 | Nested loop: `{{loop1.email}}` inside `loopSteps[0]` | validator collects nested steps and validates correctly |

---

## Behavior Contract

### Before this change
- Pre-flight passes any workflow with structurally-valid IDs and dependencies.
- Broken `{{...}}` refs become runtime `VariableResolutionError` or silent `undefined` propagation.

### After this change (with flag OFF — default)
- Pre-flight still passes the same workflows.
- Broken refs surface as **warnings in logs only**, sorted by confidence.
- Zero risk of regression vs. today.

### After this change (with flag ON, runMode=production)
- Pre-flight **blocks** workflows with high-confidence (≥0.95) field mismatches.
- Error message includes step ID, the bad reference, suggested fix, and confidence.
- Calibration mode still warns rather than blocks.

### Output format

Errors and warnings are strings (current `ValidationResult` shape). No breaking changes to consumers of `ValidationResult`.

---

## Rollout Plan

| Phase | Action | Duration | Exit criteria |
|---|---|---|---|
| 1 | Ship with `pilot_strict_field_validation_enabled = false` everywhere | 1 day | All existing tests pass; deployed |
| 2 | Enable flag in `dev` / `staging` env | 3–5 days | Collect false-positive rate from logs |
| 3 | Run flag in shadow mode against last 100 production workflows offline | concurrent with phase 2 | If FP rate < 5%, proceed |
| 4 | Enable flag in `production` for new agents only | 1 week | Monitor PILOT_EXECUTION_FAILED audit events |
| 5 | Enable flag globally; default the SystemConfig key to `true` | — | All agents covered |

**Rollback:** Toggle the SystemConfig flag to `false` via the admin UI (no deploy required).

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Confidence ≥ 0.95 still produces false positives on some real workflows | Medium | Blocks valid execution | Feature-flag gated; rollback is config-only |
| R2 | Performance: validators walk every step's config recursively | Low | Adds ms-scale latency to pre-flight | Both functions are O(steps × refs); current largest workflows < 50 steps |
| R3 | The "aggregated missing output_schema" warning is too noisy if the compiler often omits schemas | Medium | Log spam | Cap the list to first 5 step IDs; if list is empty drop it entirely |
| R4 | Nested-step collection in `validateFieldReferences` misses a step type we haven't seen | Low | Some refs not validated | Existing function handles `scatter_gather`, `conditional`, `parallel`, `loop`, `sub_workflow` — covers all current types in `StepExecutor` switch |
| R5 | `validateOperationFields` uses heuristic matching against `step.input` regex `{{varname}}` to find the upstream step — fails on indirect refs | Medium | Some operation field issues not caught | Acceptable — those will surface in calibration; not a regression |
| R6 | `output_schema` on a step may be in either `step.output_schema` (top-level) or `step.config.output_schema` — validator currently only reads top-level | Medium | Misses validation in some cases | Spot-check 5 real workflows; if top-level is dominant, accept; otherwise add a fallback read |

---

## Tests

### Unit tests (M3)
- See table above (T1–T10) in `lib/pilot/__tests__/WorkflowValidator.test.ts`.

### Integration test (NEW)
- Add `lib/pilot/__tests__/WorkflowValidator.integration.test.ts`:
  - Loads three real workflow fixtures from `tests/v6-regression/scenarios/*/expected-pilot-dsl.json` (or equivalent).
  - Asserts pre-flight is clean (no errors) for known-good workflows.
  - Mutates each fixture (introduce a typo'd ref) and asserts pre-flight catches it.

### Manual regression
- Pick 5 production agents; run them through `WorkflowPilot.execute()` with the flag OFF first, then ON. Compare audit events. Expect identical success rate with the flag off, and additional `PILOT_EXECUTION_FAILED` events with `reason: 'preflight_field_validation'` when on.

---

## Open Questions for SA

1. **Confidence threshold (0.95).** Should the cutoff be configurable per-env or fixed in code? My recommendation: fixed in code initially; add config in follow-up if needed.
2. **`step.config.output_schema` fallback (R6).** Should the validator read from both top-level and nested `config.output_schema`? Cheap to add; carries small risk of double-counting.
3. **Where exactly to read the SystemConfig flag in `WorkflowPilot.execute()`** — adjacent to the existing `pilot_enabled` check (line 225) is the obvious spot. Confirm placement.
4. **Should the aggregated "missing output_schema" warning (D2) also be feature-flag gated?** I propose no — it's purely informational.
5. **Audit event for blocked executions.** Should preflight-blocked runs emit a dedicated `AUDIT_EVENTS.PILOT_PREFLIGHT_BLOCKED` (new) or reuse `PILOT_EXECUTION_FAILED` with `reason: 'preflight'`? I lean dedicated.

---

## Estimated Effort

| Task | Effort |
|---|---|
| M1 (WorkflowValidator.ts) | 1–2 hours |
| M2 (WorkflowPilot.ts) | 30 min |
| M3 (unit tests) | 2 hours |
| Integration test | 1 hour |
| Manual regression on 5 agents | 1 hour |
| **Total** | **~6 hours** |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent draft for SA review |
