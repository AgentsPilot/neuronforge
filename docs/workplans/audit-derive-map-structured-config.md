# WP (Deferred): Audit `deriveMapStructuredConfig` Coverage Gaps

> **Last Updated**: 2026-05-12
> **Status**: 📋 DEFERRED — captured from Phase A of the eval audit
> **Author**: Dev agent

## Overview

`ExecutionGraphCompiler.deriveMapStructuredConfig` (`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:668`) is the compiler's attempt to convert an LLM-emitted `custom_code` description into a structured map config (`field_mapping`, `field_path`, etc.) so the runtime doesn't need to invoke `new Function()` for that step.

When derivation fails, the compiler emits a warning at line 676 (`[O24] Map step ... has unresolvable custom_code`) and lets the `custom_code` flow through to the runtime, where `transformMap` falls back to evaluating it as a JS `expression` via `new Function()`.

Phase A of the eval audit (telemetry on the eval path) is now in place. The next step is to **count how many `[O24]` warnings fire in real generation logs over 2 weeks** and audit the patterns. Common patterns that the heuristic doesn't handle today are candidates for new derivation rules.

## Scope

1. **Wait for telemetry.** Run for ~2 weeks with the Phase A logs deployed. Pull:
   - All `[O24] Map step ... has unresolvable custom_code` warnings from the generation pipeline logs.
   - All `mode: 'expression_*' eval_path: true` runtime logs.
   - Correlate by step / agent.

2. **Cluster the failures.** Group by what the LLM was trying to express. Likely buckets:
   - Date arithmetic (`days_remaining = today - row.expiry_date`)
   - Conditional field selection (`label = row.urgent ? "high" : "low"`)
   - Substring / regex operations (`domain = email.split("@")[1]`)
   - Lookups against external arrays (`row.category = catLookup[row.id]`)
   - Multi-field aggregation (`full_name = first + " " + last`)

3. **For each cluster:** decide whether to:
   - Add a structured mode (e.g. `date_diff_field`, `conditional_label`, `regex_extract`)
   - Improve `deriveMapStructuredConfig`'s pattern-matching to recognize the cluster's natural-language description.
   - Or accept that the cluster genuinely needs eval and document it.

## Why deferred

This isn't blocked on engineering — it's blocked on data. Designing new structured modes without knowing the real-world clusters would either over-engineer (adding modes nobody uses) or under-engineer (missing the common cases).

## Files implicated (when ready)

- `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (`deriveMapStructuredConfig`)
- `lib/pilot/StepExecutor.ts` (`transformMap` — add new mode handlers)
- `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` (teach the LLM the new modes)
- `lib/pilot/schema/pilot-dsl-schema.ts` (extend the DSL schema for new modes)

## Estimated Effort

Unknown until telemetry is in. Likely 1-2 days per new structured mode.

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Captured deferred follow-up | Spawned from eval audit Phase A workplan |
