/**
 * Percentages of one whole that add up to the whole.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `Math.round(part / total * 100)`
 *
 * Rounding each share on its own is correct for each share and wrong for the
 * set. The orders strip read:
 *
 *     Collected        ₪12,445   75%
 *     Still to collect  ₪2,650   16%
 *     Overdue           ₪1,600   10%
 *                               ────
 *                               101%
 *
 * Every figure there is the right answer to "what percentage is this", and the
 * column still says the business holds 101% of its own book. An owner who adds
 * them up finds the page cannot count, and from then on reads every other
 * number on it with the same suspicion.
 *
 * LARGEST REMAINDER. Floor each share, then hand the leftover points to
 * whichever shares lost the most in the flooring. The result sums to exactly
 * 100 and no share moves by more than a point from its true value, which is
 * the best either property can do while the other holds.
 *
 * Ties go to the larger share. Two equal halves of an odd total have to split
 * 50/50 or 51/49 somehow, and giving the point to the bigger one keeps the
 * order on screen matching the order of the figures.
 *
 * @module lib/payments/shareOfTotal
 */

/**
 * Whole percentages for `values`, summing to 100.
 *
 * Returns zeroes when the total is zero or negative: there is no share of
 * nothing, and `0/0` would otherwise put `NaN%` on screen.
 *
 * Negative values are treated as zero rather than rejected. The callers divide
 * money that has already been clamped (`Math.max(0, …)`), and a strip that
 * throws is worse than one that shows a zero.
 */
export function shareOfTotal(values: number[]): number[] {
  const safe = values.map(value => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);

  if (total <= 0) return safe.map(() => 0);

  const exact = safe.map(value => (value / total) * 100);
  const floors = exact.map(Math.floor);

  /* The points flooring threw away. Always a whole number, because the exact
     shares sum to 100 and each floor removed that share's own fraction. */
  let leftover = 100 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value), value }))
    /* By what flooring cost, then by size. */
    .sort((a, b) => b.remainder - a.remainder || b.value - a.value);

  const result = [...floors];
  for (const { index } of order) {
    if (leftover <= 0) break;
    result[index] += 1;
    leftover -= 1;
  }

  return result;
}
