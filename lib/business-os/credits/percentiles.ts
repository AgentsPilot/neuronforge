/**
 * The percentile rule of the credit ledger (workplan §4.3, SA Q-13 / S-6).
 *
 * Linear interpolation between closest ranks — the answer Postgres
 * `percentile_cont` gives — so a later SQL version of the same report agrees
 * with this one to the last digit.
 *
 * WHICH ROWS go in is the caller's decision and is part of the rule: the cost
 * report passes SUCCEEDED, non-fallback-priced charge rows only. A failed
 * action usually stops early and spends less, so including it pulls p90 DOWN,
 * and slice 8 reads p90 as "would this exhaust the trial?", where an
 * understated figure is the unsafe direction. Fallback-priced rows are a
 * deliberate over-estimate (KI-2). Failed spend still counts in every SUM.
 *
 * Exported for slices 5 and 8. Pure; no imports.
 *
 * @module lib/business-os/credits/percentiles
 */

/** Below this many examples the figures are marked "few examples". */
export const FEW_EXAMPLES_BELOW = 10;

/**
 * The `p`-th percentile (0 ≤ p ≤ 1) of `values`, or NULL for no values.
 * Non-finite values are ignored. The input is not mutated.
 */
export function percentileCont(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`percentile must be between 0 and 1, got ${p}`);
  }
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export interface Spread {
  /** How many values the figures are computed over. */
  examples: number;
  p50: number | null;
  p90: number | null;
  /** True below `FEW_EXAMPLES_BELOW` examples (including none). */
  fewExamples: boolean;
}

export function spreadOf(values: readonly number[]): Spread {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    examples: finite.length,
    p50: percentileCont(finite, 0.5),
    p90: percentileCont(finite, 0.9),
    fewExamples: finite.length < FEW_EXAMPLES_BELOW,
  };
}
