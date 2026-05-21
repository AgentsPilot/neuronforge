# WP: Idempotency-Key Plumbing for Plugin Actions

> **Last Updated**: 2026-05-12
> **Status**: 📋 WORKPLAN — implementing
> **Author**: Dev agent

## Overview

`ErrorRecovery.executeWithRetry` (`WorkflowPilot.ts:1546`) wraps every step execution and retries up to 3 times by default. For action steps, this means **the same plugin call fires multiple times on transient failures** — sending the same email twice, writing the same row to Sheets twice, etc.

There's no idempotency-key plumbing in the action call chain today. This is H-11 from the execution layer review.

## Scope (minimum viable)

Full per-plugin idempotency is a big undertaking — Stripe has `Idempotency-Key`, Slack has `client_msg_id`, Google Sheets has no native support, every plugin is different. This fix does the **plumbing** so plugins can opt in:

1. Generate a stable idempotency key per logical action invocation (stable across retries, unique across distinct invocations).
2. Inject it as `_idempotency_key` in the params passed to `PluginExecuterV2.execute`.
3. Plugin executors that want to use it can read `params._idempotency_key`.
4. Plugin executors that don't read it ignore it — zero behavior change.

Each individual plugin executor migration is a separate workplan.

## Goal

Make idempotency adoption a per-plugin opt-in change rather than a runtime architecture change. After this fix, wiring idempotency into a specific plugin (e.g. Stripe) is one PR that reads `params._idempotency_key` and passes it as the appropriate API header.

## Non-Goals

- Modifying any individual plugin executor.
- Changing retry behavior in `ErrorRecovery`.
- Adding a feature flag (this is purely additive — no behavior change without plugin opt-in).

## Design Decisions

### D1. Key derivation

The key must be:
- **Stable across retries** of the same logical invocation (retries are step-level, so loop/scatter iteration index doesn't change between attempts).
- **Unique across distinct invocations** (same step inside a loop has different keys per iteration).
- **Deterministic enough to debug** (can correlate to logs).

Recipe:
```
${context.executionId}:${step.id}[:iteration=N][:scatter=N]
```

Where the iteration/scatter suffix is derived from `context.variables`:
- `loop.index` set by `ParallelExecutor.executeLoopIteration`
- `index` set by `ParallelExecutor.executeScatterItem`

If neither is set, the suffix is omitted.

### D2. Injection point

In `StepExecutor.executeAction`, after `transformParametersForPlugin` returns but before `pluginExecuter.execute` is called. The injection is one line:

```ts
transformedParams._idempotency_key = this.deriveIdempotencyKey(context, step);
```

The underscore prefix signals "internal field — not a user-supplied param." Plugins that don't read it are unaffected.

### D3. Conventions for plugin executor authors

A new public docstring on `StepExecutor.deriveIdempotencyKey` documents:
- Read it from `params._idempotency_key`.
- Use it as the API's idempotency mechanism (Stripe header, Slack `client_msg_id`, custom UPSERT key, etc.).
- Strip it from `params` before passing to APIs that don't accept extra keys.

---

## Changes

### M1. `lib/pilot/StepExecutor.ts` (MODIFY)

1. Add a private method `deriveIdempotencyKey(context, step): string` that builds the key per D1.
2. In `executeAction`, after `transformParametersForPlugin`, inject the key into `transformedParams._idempotency_key`.
3. Add a JSDoc on `deriveIdempotencyKey` documenting the convention for plugin executor authors.

### M2. (Documentation only)

The recipe is documented in the JSDoc and this workplan. No changes to plugin executors.

---

## Behavior Contract

### Before
- Action steps retry the same plugin call up to 3 times on transient failure.
- No idempotency mechanism — duplicate side effects on retry are possible.

### After
- Every action step's `transformedParams` includes `_idempotency_key: "${executionId}:${stepId}[:iteration=N]"`.
- The key is stable across retries (same `executionId`, `stepId`, and loop/scatter context within one logical call).
- The key is distinct across loop iterations.
- **No plugin actually uses the key yet.** Behavior is unchanged. Migration is per-plugin.

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A plugin's existing API call passes the entire params object through and the API rejects unknown fields | Low | Plugin call fails | Plugin executors that strip params before sending are unaffected. Those that pass through raw need a per-plugin fix; the `_idempotency_key` prefix is recognizable and easy to filter. |
| R2 | The derived key contains characters that aren't URL-safe / header-safe | None | N/A | Composed of UUIDs, alphanumerics, and `:` — all safe. |
| R3 | Tests that snapshot params would now see `_idempotency_key` in the snapshot | Medium | Test diffs | Tests that touch `transformedParams` need to either ignore the key or assert on it explicitly. We'll verify the existing test suite passes. |
| R4 | A plugin reads `_idempotency_key` but uses it incorrectly (e.g. as a primary key on insert) | Low | Plugin-specific bug | Per-plugin opt-in design — each adoption needs review. |

---

## Estimated Effort

~30 minutes.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-05-12 | Initial workplan | Dev agent |
