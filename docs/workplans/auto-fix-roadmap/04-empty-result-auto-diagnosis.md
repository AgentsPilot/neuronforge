# WP-04: Empty-Result Auto-Diagnosis

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~5–6h
> **Author**: Dev agent

## Problem

`DryRunValidator` flags `dryRunResult.isEmpty` when a data-processing workflow returns 0 results. Today this is surfaced as a high-severity issue with a generic message. But "empty" has multiple root causes, each with a different fix:

1. **Source was empty.** The data source itself had no rows in the queried window. (User issue — they need to widen the query, OR it's a legitimate "no matches today" result.)
2. **Filter dropped everything.** Source had data but a filter step rejected all rows. (Often a calibration bug — the filter is too narrow.)
3. **Wrong field extracted.** A transform step extracted a field that doesn't exist on the data, returning all-undefined → filtered out downstream. (Auto-fixable via field-ref validation, but only when output_schema is declared.)
4. **Permission scope insufficient.** Source returned 200 but with `[]` due to OAuth scope. (User issue — needs to reconnect with more scopes.)
5. **Date range / pagination misconfigured.** Default date range too narrow. (Often auto-fixable — widen the range.)

Today the system can't distinguish. The user sees "empty results — check your data source" regardless of which is the real cause.

## Goal

Walk backward through the executed steps after an empty result is detected. Diagnose which root cause applies and either:
- Auto-fix (widen filter, widen date range, fix field reference)
- Surface a precise one-click question to the user ("Source returned no data — is that expected? [Yes / Widen the query]")

## Non-goals

- Replacing the existing `DryRunValidator` — extend it.
- Solving the "is this an OAuth scope issue" case fully (requires plugin-by-plugin scope-error parsing). Phase A handles the unambiguous scope errors only.
- Auto-modifying user-set business logic (e.g. their `amount > 100` threshold).

## Design

### D1 — Backward-walk algorithm

After dry-run completes with `isEmpty: true`:

```
For each step in REVERSE execution order:
  case 'source' (action step, kind=fetch):
    if step.output.data is empty / 0-length:
      → root cause = SOURCE_EMPTY
      → break
    else if step.output.data has items:
      → not the source's fault; continue to next step
  
  case 'filter' / 'transform':
    inputSize = upstream step's output count
    outputSize = this step's output count
    if outputSize === 0 && inputSize > 0:
      → root cause = FILTER_DROPPED_ALL
      → record the filter step's id + its condition
      → break
  
  case 'map' / 'extract':
    if outputs are all undefined / null:
      → root cause = WRONG_FIELD_EXTRACTED
      → record which field was extracted from what input shape
      → break
  
  case 'scatter_gather':
    if all items produced empty output:
      → recurse into the body
```

### D2 — Per-cause remediation

| Root cause | Auto-fix | User-facing question |
|---|---|---|
| SOURCE_EMPTY | None (might be legitimate) | "No data was found in <source>. Is that expected, or should we widen the search?" |
| FILTER_DROPPED_ALL | Suggest relaxing the filter: show the filter's condition + a sample of rows that were rejected | "Your filter dropped all <N> items. Want to relax it?" + show preview |
| WRONG_FIELD_EXTRACTED | If output_schema available + better field exists → propose auto-swap | (auto-applied) "We noticed the workflow was reading X — switched to Y which has the data." |
| DATE_RANGE_NARROW | If detected (default range = 1 day or similar): suggest widening | "Try the last 7 days instead?" → one click → re-run dry-run |
| OAUTH_SCOPE_INSUFFICIENT | None | "<Plugin> may need a wider permission. Reconnect with more access?" → re-OAuth |

### D3 — Re-run after auto-fix

When an auto-fix is applied (e.g. widened date range), automatically re-run `DryRunValidator` with the modified workflow. If THAT returns data, the issue auto-resolves with no user action.

If the re-run still returns empty → fall back to the user-facing question.

### D4 — How to detect "filter dropped all"

For each transform step with `operation: 'filter'`, the runtime can capture upstream count vs downstream count. Already in `StepOutput.metadata.itemCount`. Compare.

For each ai_processing step that returns array → array, same comparison.

## File-by-file changes

| File | Change |
|---|---|
| `lib/pilot/shadow/DryRunValidator.ts` | After `validateWithDryRun` returns, if `isEmpty`, call new method `diagnoseEmptyResult(executionTrace)` which performs the backward walk. |
| `lib/pilot/shadow/EmptyResultDiagnoser.ts` | **NEW** — contains the backward-walk algorithm. |
| `lib/pilot/shadow/types.ts` | Add `EmptyResultCause` type + `EmptyResultDiagnosis` interface. |
| `app/api/v2/calibrate/batch/route.ts` | When `dryRunResult.diagnosis` is present, route to the appropriate auto-fix path (relax filter, widen range, etc.) before promoting to user-visible issue. |
| `lib/pilot/shadow/userFacing.ts` | Add translator branches for each `EmptyResultCause` per D2's question column. |
| `lib/pilot/shadow/__tests__/EmptyResultDiagnoser.test.ts` | **NEW** — test each diagnosis path with mock executionTraces. |

## Tests

| # | Trace shape | Expected diagnosis |
|---|---|---|
| E1 | Step1 (source) returns `[]` | `SOURCE_EMPTY` |
| E2 | Step1 returns 50 items, Step2 (filter) outputs 0 | `FILTER_DROPPED_ALL`, with Step2's condition recorded |
| E3 | Step1 returns 10 items, Step2 (map) outputs `[undefined, undefined, ...]` | `WRONG_FIELD_EXTRACTED` |
| E4 | Workflow has a `query: { date_range: 'last_1_day' }` and source is empty | Suggest widening; auto-rerun with `last_7_days` |
| E5 | Plugin returned 200 but with `permission_error` in body | `OAUTH_SCOPE_INSUFFICIENT` |
| E6 | Multi-step pipeline where the source IS empty AND a downstream filter would have dropped everything anyway | First (most upstream) cause wins: `SOURCE_EMPTY` |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Auto-relaxing a filter changes user intent silently | NEVER auto-apply for filters explicitly authored by the user; auto-apply only for compiler-emitted default filters. User-authored filters → one-click question instead. |
| R2 | Date range widening changes cost/quota usage | Cap auto-widening at one tier (1d → 7d → 30d → ask). |
| R3 | Diagnosing requires execution-trace inspection that exists today only in calibration mode | Phase A: enhance `executionTrace` to include per-step input/output counts. Already present in `metadata.itemCount`. |

## Estimated effort

~5–6 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
