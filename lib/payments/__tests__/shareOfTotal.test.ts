/**
 * The shares on the orders strip add up to the whole.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * Each share was `Math.round(part / total * 100)`, computed alone. The real
 * figures from a live account:
 *
 *     Collected        ₪12,445   74.54%  →  75%
 *     Still to collect  ₪2,650   15.87%  →  16%
 *     Overdue           ₪1,600    9.58%  →  10%
 *                                          ─────
 *                                           101%
 *
 * Every rounding is the correct answer to its own question, and the column
 * still tells an owner their book is 101% of itself. The amounts beside them
 * reconcile exactly, which makes it worse: the one part of the strip that
 * cannot be checked by addition is the one part that does not add up.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { shareOfTotal } from '@/lib/payments/shareOfTotal';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('the exact case from the strip', () => {
  it('no longer sums to 101', () => {
    expect(sum(shareOfTotal([12445, 2650, 1600]))).toBe(100);
  });

  it('gives the point to the share that lost most in the flooring', () => {
    /*
     * Fractions .54, .87, .58 and one point to hand out. It goes to .87 — the
     * middle share — not to the largest figure, because largest REMAINDER is
     * what keeps every share within a point of its true value.
     */
    expect(shareOfTotal([12445, 2650, 1600])).toEqual([74, 16, 10]);
  });
});

describe('it always sums to 100', () => {
  const cases: number[][] = [
    [1, 1, 1],
    [1, 2],
    [100, 100, 100, 100, 100, 100, 100],
    [9999, 1, 1],
    [1, 9999],
    [33, 33, 34],
    [0.1, 0.2, 0.7],
    [12445, 2650, 1600],
    [4250, 1600],
    [7],
  ];

  for (const values of cases) {
    it(`for [${values.join(', ')}]`, () => {
      expect(sum(shareOfTotal(values))).toBe(100);
    });
  }

  it('for thirds, which no independent rounding can get right', () => {
    /* 33.33 each. Floors to 33/33/33, one point left, so one share reads 34.
       Any approach that rounds each alone gives 33/33/33 and loses a point. */
    const shares = shareOfTotal([1, 1, 1]);

    expect(sum(shares)).toBe(100);
    expect(shares.filter(s => s === 34)).toHaveLength(1);
  });
});

describe('no share is misrepresented to make the sum work', () => {
  it('keeps every share within one point of its true value', () => {
    const values = [12445, 2650, 1600, 77, 3];
    const total = sum(values);
    const shares = shareOfTotal(values);

    shares.forEach((share, index) => {
      expect(Math.abs(share - (values[index] / total) * 100)).toBeLessThan(1);
    });
  });

  it('never reorders them: a bigger amount never gets a smaller share', () => {
    const values = [500, 300, 200];
    const shares = shareOfTotal(values);

    expect(shares[0]).toBeGreaterThanOrEqual(shares[1]);
    expect(shares[1]).toBeGreaterThanOrEqual(shares[2]);
  });
});

describe('nothing to divide', () => {
  it('reports zeroes rather than NaN when the total is zero', () => {
    /*
     * `0/0` is NaN, and "NaN%" on a money strip is the kind of thing an owner
     * screenshots. A business with no orders has no shares, not broken ones.
     */
    expect(shareOfTotal([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('handles an empty set', () => {
    expect(shareOfTotal([])).toEqual([]);
  });

  it('treats a negative as zero instead of throwing', () => {
    /*
     * The callers clamp with `Math.max(0, …)` before this, so a negative is
     * already a fault upstream. A strip that renders a zero is recoverable; one
     * that throws takes the whole page down.
     */
    const shares = shareOfTotal([-5, 10]);

    expect(shares[0]).toBe(0);
    expect(sum(shares)).toBe(100);
  });

  it('survives a non-finite value', () => {
    expect(sum(shareOfTotal([Number.NaN, 10, 10]))).toBe(100);
  });
});
