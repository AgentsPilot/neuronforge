/**
 * Did the thing we raised actually get better?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY PART OF THE OUTCOME LOOP THAT CAN BE WRONG ON PURPOSE.
 *
 * Reading a metric twice is arithmetic. Deciding whether the second reading is
 * BETTER is not, and it has a trap in it: improvement has no fixed sign.
 *
 *   ret_no_show_spike      fired because the rate was too HIGH  → down is good
 *   ops_utilization_low    fired because it was too LOW         → up is good
 *
 * The insight row records which (`direction`: the side the threshold was
 * breached on), so improvement is movement AGAINST that side. Hardcoding
 * "lower is better" would report every utilisation recovery as a decline, and
 * the loop would then learn to suppress the advice that worked.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM
 *
 * Not causation. The owner acted and the number moved; the weather, a holiday
 * and a cancelled contract all also happened. This records that the two
 * coincided, which is the honest claim and is still enough to rank advice once
 * there are enough of them — and the insights she DISMISSED are the control
 * group that makes it meaningful.
 *
 * `unmeasurable` is a first-class answer, not a failure. A metric with no
 * fresh reading means we do not know, and the loop has to be able to say so --
 * otherwise "no data" quietly becomes "no improvement" and every detector
 * looks useless on a quiet account.
 *
 * Pure: no database, no clock. Same shape as `funnelGap.ts` and
 * `patterns/segmentRate.ts`, and the reason all three are testable without a
 * fixture.
 *
 * @module lib/business-os/insight/outcome/judgeMovement
 */

/**
 * How far the metric has to move before it counts as having moved.
 *
 * Five per cent. Below it the reading is noise: `derived_metrics` recomputes
 * daily from windows that shift under it, so a figure wobbles by a point or
 * two without anything happening in the business. Calling that an improvement
 * would let the loop learn from its own rounding.
 */
export const MIN_MOVEMENT_PERCENT = 5;

export type MovementVerdict =
  /** Moved away from the breached side by more than the noise floor. */
  | 'improved'
  /** Moved further onto the breached side. */
  | 'worsened'
  /** Moved less than the noise floor, in either direction. */
  | 'unchanged'
  /** One of the two readings is missing. We do not know, and say so. */
  | 'unmeasurable';

export interface Movement {
  verdict: MovementVerdict;
  /**
   * Signed percentage change from `before`, or null.
   *
   * Null when it cannot be computed rather than 0, which would read as "no
   * change": a baseline of zero has no percentage (every movement from it is
   * infinite), and an unmeasurable pair has no change at all. The verdict
   * carries the meaning; this is for display only.
   */
  changePercent: number | null;
}

/**
 * Judge one re-measurement.
 *
 * @param direction the side the threshold was breached on, from the insight
 *                  row. `'above'` means the metric was too high when we
 *                  raised it, so falling is improvement.
 */
export function judgeMovement(input: {
  before: number | null | undefined;
  after: number | null | undefined;
  direction: 'above' | 'below';
  minMovementPercent?: number;
}): Movement {
  const { before, after, direction } = input;
  const floor = input.minMovementPercent ?? MIN_MOVEMENT_PERCENT;

  if (typeof before !== 'number' || typeof after !== 'number') {
    return { verdict: 'unmeasurable', changePercent: null };
  }
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return { verdict: 'unmeasurable', changePercent: null };
  }

  const delta = after - before;

  /*
   * Improvement is movement AGAINST the side that was breached.
   *
   * `above` means it was too high, so a negative delta is better. `below`
   * means it was too low, so a positive delta is better.
   */
  const improvedBy = direction === 'above' ? -delta : delta;

  /*
   * A baseline of zero has no percentage.
   *
   * Every movement away from zero is an infinite increase, and printing one is
   * how this module produced a 275% refund rate. The DIRECTION is still
   * knowable, so the verdict stands on the raw delta and the percentage is
   * withheld. The noise floor cannot apply either -- there is nothing to take
   * five per cent of -- so any movement at all counts.
   */
  if (before === 0) {
    if (delta === 0) return { verdict: 'unchanged', changePercent: null };
    return { verdict: improvedBy > 0 ? 'improved' : 'worsened', changePercent: null };
  }

  const changePercent = Math.round((delta / Math.abs(before)) * 1000) / 10;

  if (Math.abs(changePercent) < floor) {
    return { verdict: 'unchanged', changePercent };
  }

  return { verdict: improvedBy > 0 ? 'improved' : 'worsened', changePercent };
}
