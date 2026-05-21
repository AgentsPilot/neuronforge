# WP-01: Rate-Limit / Quota Auto-Remediation

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~2h
> **Author**: Dev agent

## Problem

`FailureClassifier` already returns `category: 'execution_error', sub_type: 'rate_limit'` (or similar — verify in `lib/pilot/shadow/FailureClassifier.ts`) when a plugin returns a 429 or quota-exceeded response. But:

- `ErrorRecovery.executeWithRetry` applies a single generic retry policy (`maxRetries: 3, exponential backoff`). It doesn't know the failure was rate-limited specifically.
- For Gmail, Sheets, and similar APIs, rate-limit recovery wants **longer initial backoff** (10–30s, not 1s) and **respect for `Retry-After` headers** when present.
- The user sees this as a generic execution failure, which lands in the "user must debug" pile.

## Goal

When `FailureClassifier` classifies a step failure as `rate_limit`, the calibration system should **silently retry with a rate-limit-aware policy** (longer backoff, optional `Retry-After` header respect), record the auto-remediation in the audit trail, and only surface to the user if the retry policy also fails.

## Non-goals

- Implementing rate-limit budget tracking across executions (out of scope; that's an operational telemetry concern).
- Adding new failure sub-types.
- Modifying plugin executor signatures.

## Design

### D1 — Per-failure-type retry policies

Today `ErrorRecovery.executeWithRetry` accepts one `RetryPolicy`. Extend it (or wrap it) with a `policySelector(failureClassification)` that returns the right policy for the classified failure:

```ts
const RATE_LIMIT_POLICY: RetryPolicy = {
  maxRetries: 5,
  backoffMs: 10_000,        // 10s initial
  backoffMultiplier: 2,      // 10s, 20s, 40s, 80s, 160s
  retryableErrors: ['rate_limit', '429', 'quota_exceeded'],
};
```

### D2 — Where the selection happens

`WorkflowPilot.executeSingleStep` already wraps `stepExecutor.execute(...)` in `errorRecovery.executeWithRetry(...)` (line 1546). The cleanest injection point:

1. After the wrapped call fails AND `FailureClassifier.classify(error)` returns `rate_limit`, retry ONE MORE TIME with `RATE_LIMIT_POLICY`.
2. If that also fails, surface to the user (today's path).

Alternative: pass `failureClassifier` into `executeWithRetry` so it can switch policies mid-retry-loop. Cleaner long-term but more invasive.

### D3 — `Retry-After` header pass-through

Plugin executors that catch a 429 should include the `Retry-After` value (seconds) in the thrown error's `details`. `ErrorRecovery` reads it and overrides `backoffMs` for that specific attempt.

Today no plugin executor surfaces this. Phase A is the runtime support; per-plugin adoption is a follow-up (similar shape to the idempotency-key adoption pattern from Tier 3 Fix #10).

### D4 — Audit + user-facing translation

- Audit event: extend the existing `PILOT_STEP_RETRIED` event with `reason: 'rate_limit'`. Surfaces in admin dashboards.
- User-facing: when rate-limit retry succeeds, NO user notification (silent fix — the goal). When it fails after all retries, the user-facing translator produces:
  - title: `"<Plugin> is rate-limited"`
  - message: `"We tried <N> times with a delay between each — <Plugin> is throttling us. This usually clears up in a few minutes."`
  - what_to_do: `"Wait a few minutes and run calibration again."`

## File-by-file changes

| File | Change |
|---|---|
| `lib/pilot/ErrorRecovery.ts` | Add `RATE_LIMIT_POLICY` constant. Add an `applyClassifiedRetry()` method or modify `executeWithRetry` to consult a classifier. |
| `lib/pilot/WorkflowPilot.ts:1546` | When the initial retry chain exhausts, call `FailureClassifier.classify(error)`; if `rate_limit`, re-invoke `executeWithRetry` with `RATE_LIMIT_POLICY`. |
| `lib/pilot/shadow/FailureClassifier.ts` | Verify `rate_limit` sub_type detection covers Gmail 429, Sheets quota, Slack 429, HubSpot 429 — add patterns where missing. |
| `lib/audit/events.ts` | (Optional) Add a dedicated `PILOT_RATE_LIMIT_RETRY` event for grouping. Or reuse `PILOT_STEP_RETRIED` with `reason` in details. |
| `lib/pilot/shadow/userFacing.ts` | Add a translator branch for `rate_limit` failures that exhausted retries. |
| `lib/pilot/__tests__/ErrorRecovery.test.ts` | New test file (or extension): assert that a step throwing a 429 retries with the rate-limit policy and eventually succeeds. |

## Tests

| # | Case | Expected |
|---|---|---|
| R1 | Step throws 429 once → retry succeeds | Step output marked success; audit event with `reason: 'rate_limit'` |
| R2 | Step throws 429 five times → retry chain exhausted | ExecutionError surfaces; user-facing message is the friendly "rate-limited" copy |
| R3 | Step throws non-rate-limit error → uses default policy, NOT rate-limit policy | Verifies the classifier dispatch is correct |
| R4 | Plugin error carries `Retry-After: 30` | Backoff uses 30s, not the policy default |
| R5 | Two consecutive scatter items both 429 | Both retry independently with their own policy chain |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Longer backoff makes the calibration loop slower if many rate-limit failures occur | Cap total retry time per step (e.g. 5 min absolute). Surface to user if cap hits. |
| R2 | `Retry-After` header not surfaced by some plugin executors | Phase A works without it (uses policy defaults). Per-plugin adoption is follow-up. |
| R3 | False-positive rate-limit classification → uses heavy backoff when not needed | `FailureClassifier` is regex-based and conservative; small expected false-positive rate. |

## Estimated effort

~2 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
