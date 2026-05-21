# WP: Move `StructuralRepairEngine` Persistence Out of Execution

> **Last Updated**: 2026-05-12
> **Status**: 📋 WORKPLAN — implementing
> **Author**: Dev agent

## Overview

`WorkflowPilot.execute()` runs `StructuralRepairEngine.scanWorkflow() + autoFixWorkflow()` at the start of every execution (lines 264–303). When repairs succeed, the **modified `agent.pilot_steps` is silently persisted back to the `agents` table** (line 286–289). This is H-9 from the execution layer review.

The persistence is the worst part. Three problems:

1. **It hides generator bugs.** Every "auto-repaired" workflow is a sign that the generation pipeline (v4/v5/v6 compiler) produced bad output. Silently persisting masks the signal that should drive compiler improvements.
2. **It compounds drift.** Each execution may further mutate the agent definition. The user's saved workflow is no longer what they saved.
3. **It runs on every execute**, including scheduled runs the user never sees — so workflows quietly drift over time without anyone noticing.

## Goal

**Stop silently persisting repair results from `execute()`** behind a feature flag. The repair still runs in-memory (so today's workflows continue to execute), but the persistence is opt-out. Add audit-trail logging so operators can see which agents are getting repaired.

## Non-Goals

- Wiring `StructuralRepairEngine` into the v4/v5/v6 **generation** pipelines. That's the right long-term home for repair (and the `requires_review` mark), but it touches multiple compiler files and prompts. Defer to a separate workplan.
- Removing repair from `execute()` entirely. Today's workflows may rely on it; pulling the rug too early breaks production.
- Changing what `StructuralRepairEngine` does — only changing whether its results are persisted.

## Design Decisions

### D1. New SystemConfig flag with safe default

`pilot_structural_repair_persist_enabled`, default `true` (preserves today's behavior).

When `true`: persist repair results to `agents.pilot_steps` (current behavior).
When `false`: keep the in-memory repair so the workflow executes correctly, but DO NOT write back to the database. The user's saved workflow stays unchanged.

Default-true is intentional: changing the persistence default would change behavior overnight. Operators can flip the flag in staging, measure how many agents are silently getting "fixed" via the audit log (D2), then decide whether to flip in production.

### D2. Audit trail entry on every repair

Currently the only signal is a `console.log` line. Operators can't query "which agents are being repaired." Add a structured audit event:

- Action: `PILOT_STRUCTURAL_REPAIR_APPLIED`
- Severity: `warning` (it indicates a generator bug)
- Details: `{ agent_id, repair_count, fixed_count, failed_count, issues, persisted }`

This fires **regardless** of the persistence flag — so operators get visibility either way.

### D3. Per-execution `runMode` does NOT gate this fix

Unlike Fixes #4 and #9, this fix's behavior is the same across all run modes. Structural repair runs the same way in production and calibration. Only the persistence is flag-controlled.

(Rationale: structural repair fires when the workflow has missing required fields like `loop.iterateOver`. Calibration shouldn't get a different "fix" than production — the fix is deterministic.)

### D4. Structured warning log

Replace `console.log(\`✅ Auto-repaired ${fixedCount} ... silently\`)` with a structured `logger.warn` including the repair issues. Pino-grep-friendly.

---

## File-by-File Changes

### M1. `lib/audit/events.ts` (MODIFY)

Add a new audit event in the `AUDIT_EVENTS` const + an entry in the metadata map:

```ts
PILOT_STRUCTURAL_REPAIR_APPLIED: 'PILOT_STRUCTURAL_REPAIR_APPLIED',
```

And the metadata block (severity: `warning`, description: "Structural auto-repair fired on a workflow before execution — indicates a generator bug").

### M2. `lib/pilot/WorkflowPilot.ts` (MODIFY)

Inside the structural-repair block (lines 264–303):

1. After `repairResults` is computed, **always emit the audit event** with the repair issues.
2. Read the new SystemConfig flag `pilot_structural_repair_persist_enabled` (default `true`).
3. Gate the existing `.update({ pilot_steps })` block on the flag.
4. Replace the legacy `console.log` lines with structured `logger.warn` / `logger.info` so the repair issues are queryable.

### M3. (Optional) Tests

Like Fix #9, this is hard to unit-test without a Supabase mock. Focus on TS compile + existing test suite passing. Add a QA-handoff note that an integration test is needed.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | An agent currently relies on the silent auto-persistence (next execute reads the repaired version) | Medium | Subsequent runs may re-do the repair | Default `true` preserves today's behavior. Flag flip is opt-in per env. |
| R2 | New audit event volume | Low | Audit log noise if many agents are getting repaired | Severity `warning` lets operators filter. Volume is one event per execution, no worse than `PILOT_EXECUTION_STARTED`. |
| R3 | The audit event name is added but no UI handles it yet | Low | Operators see a new event name in logs without context | Description in the event metadata explains the semantics. |
| R4 | Generator team doesn't see the new signal | Medium | Audit events go unnoticed | Out of scope — surfacing the signal is the prerequisite for action; convincing the generator team is a separate conversation. |

## Estimated Effort

- M1 (audit event): 10 min
- M2 (WorkflowPilot changes): 20 min
- Verification (TS + tests): 20 min

**~50 minutes total.**

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent |
