/**
 * Improvement has no fixed sign, and "no data" is not "no improvement".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The first group is the trap the module exists for: `ret_no_show_spike` fired
 * because a rate was too HIGH and `ops_utilization_low` because one was too
 * LOW, so a hardcoded "down is better" would report every utilisation recovery
 * as a decline — and a loop learning from that would suppress the advice that
 * worked.
 *
 * The rest pin the refusals: a baseline of zero has no percentage (printing
 * one is how this module produced a 275% refund rate), and a missing reading
 * is `unmeasurable` rather than a quiet zero.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { judgeMovement, MIN_MOVEMENT_PERCENT } from '../judgeMovement';

describe('improvement depends on which side was breached', () => {
  it('counts a FALL as improvement when the metric was too high', () => {
    // ret_no_show_spike: 20% of appointments missed, now 10%.
    const m = judgeMovement({ before: 20, after: 10, direction: 'above' });

    expect(m.verdict).toBe('improved');
    expect(m.changePercent).toBe(-50);
  });

  it('counts a RISE as improvement when the metric was too low', () => {
    // ops_utilization_low: 30% of available hours booked, now 45%.
    const m = judgeMovement({ before: 30, after: 45, direction: 'below' });

    expect(m.verdict).toBe('improved');
    expect(m.changePercent).toBe(50);
  });

  it('calls the same movement opposite things for opposite directions', () => {
    /*
     * The whole point, stated as one assertion. Identical numbers, identical
     * delta, opposite verdicts — because the question "is this better?" is
     * meaningless without knowing why it was raised.
     */
    const rose = { before: 20, after: 30 };

    expect(judgeMovement({ ...rose, direction: 'above' }).verdict).toBe('worsened');
    expect(judgeMovement({ ...rose, direction: 'below' }).verdict).toBe('improved');
  });
});

describe('the noise floor', () => {
  it('treats a wobble under the floor as unchanged, either way', () => {
    /*
     * `derived_metrics` recomputes daily over windows that shift under it, so
     * a point or two of movement happens without anything happening in the
     * business. Learning from that is learning from our own rounding.
     */
    expect(judgeMovement({ before: 100, after: 103, direction: 'above' }).verdict).toBe('unchanged');
    expect(judgeMovement({ before: 100, after: 97, direction: 'above' }).verdict).toBe('unchanged');
  });

  it('still reports the figure it declined to act on', () => {
    // `unchanged` is a verdict about significance, not a claim that nothing moved.
    expect(judgeMovement({ before: 100, after: 103, direction: 'above' }).changePercent).toBe(3);
  });

  it('acts on a movement exactly at the floor', () => {
    const m = judgeMovement({ before: 100, after: 100 - MIN_MOVEMENT_PERCENT, direction: 'above' });
    expect(m.verdict).toBe('improved');
  });

  it('honours a floor the caller supplies', () => {
    const m = judgeMovement({ before: 100, after: 90, direction: 'above', minMovementPercent: 20 });
    expect(m.verdict).toBe('unchanged');
  });
});

describe('a baseline of zero has no percentage', () => {
  it('judges direction but withholds the figure', () => {
    /*
     * Every movement away from zero is an infinite increase. This module has
     * already shown an owner a 275% rate assembled from a comparison that did
     * not exist; the verdict is knowable here and the percentage is not.
     */
    const m = judgeMovement({ before: 0, after: 4, direction: 'below' });

    expect(m.verdict).toBe('improved');
    expect(m.changePercent).toBeNull();
  });

  it('calls zero-to-zero unchanged', () => {
    expect(judgeMovement({ before: 0, after: 0, direction: 'above' })).toEqual({
      verdict: 'unchanged',
      changePercent: null,
    });
  });

  it('worsens when a metric that should stay low leaves zero', () => {
    expect(judgeMovement({ before: 0, after: 3, direction: 'above' }).verdict).toBe('worsened');
  });
});

describe('what we do not know, we say', () => {
  it('is unmeasurable when either reading is missing', () => {
    /*
     * The distinction that keeps the loop honest. Treating a missing reading
     * as zero would make every detector look useless on a quiet account, and
     * the ranking would learn from it.
     */
    for (const pair of [
      { before: 10, after: null },
      { before: null, after: 10 },
      { before: undefined, after: 10 },
      { before: 10, after: undefined },
    ]) {
      expect(judgeMovement({ ...pair, direction: 'above' })).toEqual({
        verdict: 'unmeasurable',
        changePercent: null,
      });
    }
  });

  it('is unmeasurable for a reading that is not a finite number', () => {
    expect(judgeMovement({ before: 10, after: NaN, direction: 'above' }).verdict).toBe('unmeasurable');
    expect(judgeMovement({ before: Infinity, after: 10, direction: 'above' }).verdict).toBe(
      'unmeasurable'
    );
  });

  it('never returns changePercent 0 in place of "we do not know"', () => {
    // 0 reads as "measured, and it did not move". Null is the absent answer.
    expect(judgeMovement({ before: null, after: null, direction: 'above' }).changePercent).toBeNull();
  });
});

describe('negative baselines', () => {
  it('measures the percentage against the magnitude', () => {
    /*
     * A metric can legitimately be negative (a net balance). Dividing by the
     * signed value flips the sign of the percentage and reports a recovery as
     * a decline.
     */
    const m = judgeMovement({ before: -100, after: -50, direction: 'below' });

    expect(m.changePercent).toBe(50);
    expect(m.verdict).toBe('improved');
  });
});
