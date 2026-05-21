# WP-06: Distribution-Aware Multi-Sample Testing

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP item — pending implementation session
> **Effort**: ~6–8h
> **Author**: Dev agent

## Problem

`DryRunValidator` runs the workflow **once** with whatever input the user provided. If the test data is unrepresentative — recent only, all the same shape, missing edge cases — the calibration certifies a workflow that breaks the moment a different data shape appears in production.

Real failure patterns this misses:
- Numeric fields formatted as `"$1,234.56"` in some rows, `"1234.56"` in others
- Optional fields present in 80% of rows, absent in 20%
- International characters / encoding issues in a fraction of rows
- Empty results from one date range but not another
- Very large items that blow past LLM token budgets

A workflow that works on 1 sample passes calibration. The 1,000th row of production data breaks it.

## Goal

Replace single-sample `DryRunValidator.validateWithDryRun` with a **multi-sample** run: 3–5 representative samples drawn from different distribution slices. The workflow must pass on ALL samples to be considered calibrated. Failures on specific samples reveal distribution-dependent bugs that single-sample testing cannot.

## Non-goals

- Building a full statistical-sampling framework. Phase A is heuristic-based slice selection.
- Per-plugin sample selection optimization. Phase A uses the same slicing strategy for all plugins; per-plugin refinement is follow-up.
- Replacing the existing single-sample path entirely. Multi-sample is opt-in via a flag for the first rollout.

## Design

### D1 — Sample slices

For each data source step in the workflow, pull samples from up to 5 distribution slices:

| Slice | Selection strategy |
|---|---|
| `recent` | Newest items in the source (current default — what we already test) |
| `oldest` | Oldest items in the source (catches schema drift over time) |
| `edge_case` | Items with unusual values: missing optional fields, empty strings, longest content |
| `empty` | An explicitly-empty / no-match query (catches the "nothing found" code path) |
| `large` | Largest items by payload size (catches token-budget and timeout issues) |

Not all slices apply to all sources. The selection is **opportunistic**: try each, skip if the source can't produce it.

### D2 — Per-plugin slice strategies

Each plugin needs a tiny adapter that knows how to fetch each slice. Examples:

| Plugin | Slice | Fetch strategy |
|---|---|---|
| Gmail `search_messages` | `recent` | `q: 'newer_than:1d'`, limit 5 |
| Gmail `search_messages` | `oldest` | `q: 'before:1y'`, limit 5 |
| Gmail `search_messages` | `edge_case` | `q: 'has:attachment OR is:starred'`, limit 5 |
| Gmail `search_messages` | `empty` | `q: 'subject:"xyzabc-nonexistent-1234"'`, limit 5 |
| Gmail `search_messages` | `large` | `q: 'larger:1M'`, limit 5 |
| Sheets `read_range` | `recent` | First 5 rows from the last sheet |
| Sheets `read_range` | `oldest` | First 5 rows from the first sheet (or row 1-5) |
| Sheets `read_range` | `edge_case` | Rows with empty cells (require scanning) |
| Sheets `read_range` | `empty` | `range: 'Sheet1!A10000:Z10005'` (likely empty) |

For plugins without a known strategy, fall back to single-sample (today's behavior).

### D3 — Aggregating results

After running the workflow against each slice, aggregate:

```ts
interface MultiSampleResult {
  totalSamples: number;
  passedSamples: number;
  failedSamples: number;
  perSampleIssues: Array<{
    slice: 'recent' | 'oldest' | 'edge_case' | 'empty' | 'large';
    issues: DryRunIssue[];
  }>;
  /** Issues that appeared in ALL samples — likely systemic */
  systemicIssues: DryRunIssue[];
  /** Issues that appeared in SOME samples — likely distribution-dependent */
  distributionalIssues: DryRunIssue[];
}
```

Distributional issues are the new value-add: "works on recent emails, fails on emails older than a year — likely a date format that changed."

### D4 — Cost and time budget

Running 5x dry-runs costs 5x more. Cap by:
- Skip slices that the previous slice already produced 0 results (the source clearly can't produce more)
- Maximum 5 slices per source
- Cap total dry-run time at 5 minutes; emit a warning if hit
- For workflows with multiple data sources, only the first source gets multi-sample treatment (downstream steps use the output) — multi-sampling all sources is exponential

### D5 — Flag-gated rollout

`pilot_multi_sample_dry_run_enabled` SystemConfig flag, default `false`. When `false`: today's single-sample behavior. When `true`: multi-sample. Allows side-by-side comparison and instant rollback.

## File-by-file changes

| File | Change |
|---|---|
| `lib/pilot/shadow/DryRunValidator.ts` | New method `validateWithMultiSample(agent, userId, options)` alongside existing `validateWithDryRun`. Calls per-slice fetchers, runs workflow on each, aggregates. |
| `lib/pilot/shadow/SampleStrategy.ts` | **NEW** — per-plugin slice strategies. Plugin adapter pattern. |
| `app/api/v2/calibrate/batch/route.ts:962` | Read flag; call either single-sample or multi-sample. |
| `lib/pilot/shadow/userFacing.ts` | Translator branches for "works on most data, fails on edge cases" pattern. |
| `lib/pilot/shadow/__tests__/SampleStrategy.test.ts` | **NEW** — unit tests for slice fetchers (mock plugin responses). |
| `lib/pilot/shadow/__tests__/DryRunValidator.multiSample.test.ts` | **NEW** — integration tests: workflow that passes on `recent` but fails on `oldest`. |

## Tests

| # | Case | Expected |
|---|---|---|
| M1 | All 5 slices pass | Multi-sample result: 5/5 pass, no distributional issues |
| M2 | Recent passes, oldest fails on a date-format mismatch | 4/5 pass, distributional issue surfaced with slice tag |
| M3 | Empty slice deliberately empty | Pass — workflow handled empty correctly (or surfaced empty-result auto-diagnosis) |
| M4 | Large slice hits LLM token budget | Fail on `large`; user-facing message: "your largest items exceed the AI step's capacity" |
| M5 | Source plugin has no `oldest` strategy → falls back to single-sample for that source | Verified via mock |
| M6 | Time budget exceeded mid-run | Stop, surface what we have; mark `partial_multi_sample: true` |

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | 5x calibration cost — slow + expensive | Default flag off; opt-in per-env. Cap at 5 slices, 5-min total. |
| R2 | Edge-case slice query patterns don't match every user's data | Per-plugin adapters are best-effort; fall back to single-sample if all slices return 0. |
| R3 | Multi-sample failures confuse the user | User-facing translator must explicitly say "WORKS on recent data, FAILS on older items" — frame as distribution coverage, not as a generic failure. |
| R4 | Plugin rate limits hit faster with 5x calls | Use the rate-limit auto-remediation from WP-01 (assumed shipped first). |

## Estimated effort

~6–8 hours.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Initial workplan | Dev agent |
