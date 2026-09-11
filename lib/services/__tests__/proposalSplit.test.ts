import { splitTotal, isCompleteSplit } from '../ProposalAcceptanceService';

/**
 * The stages must add up to what the client accepted. Exactly.
 *
 * This is the one arithmetic in the feature where being a penny out is a real
 * failure: the owner bills three stages, the client pays all three, and the
 * total does not match the quote they signed. Percentages are what gets typed;
 * money is what gets paid, and the conversion between them is where it goes.
 */
describe('splitTotal', () => {
  const sum = (parts: number[]) => Number(parts.reduce((a, b) => a + b, 0).toFixed(2));

  it('splits a clean 30/40/30', () => {
    expect(splitTotal(60000, [30, 40, 30])).toEqual([18000, 24000, 18000]);
  });

  it('puts the rounding remainder on the last stage rather than losing it', () => {
    // 1000 split three ways leaves a penny that has to land somewhere.
    const percents = [33.34, 33.33, 33.33];
    const parts = splitTotal(1000, percents);

    expect(sum(parts)).toBe(1000);

    /*
     * The guarantee is about WHERE the remainder goes, not which stage is
     * largest — with 33.34 first, the first stage is the biggest and still
     * takes no remainder. Every stage but the last is exactly its own floored
     * share; the last is whatever is left, which is what makes the sum exact.
     */
    percents.slice(0, -1).forEach((percent, i) => {
      expect(parts[i]).toBe(Math.floor((100000 * percent) / 100) / 100);
    });

    const allButLast = Number(parts.slice(0, -1).reduce((a, b) => a + b, 0).toFixed(2));
    expect(parts[parts.length - 1]).toBe(Number((1000 - allButLast).toFixed(2)));
  });

  it('never loses money, across a range of awkward totals and splits', () => {
    const cases: Array<[number, number[]]> = [
      [1000, [33.33, 33.33, 33.34]],
      [999.99, [50, 50]],
      [12345.67, [10, 20, 30, 40]],
      [0.03, [33.33, 33.33, 33.34]],
      [7, [15, 35, 50]],
      [60000, [20, 30, 30, 20]],
    ];

    for (const [total, percents] of cases) {
      expect(sum(splitTotal(total, percents))).toBe(Number(total.toFixed(2)));
    }
  });

  it('handles a single stage as the whole amount', () => {
    expect(splitTotal(2700, [100])).toEqual([2700]);
  });

  it('gives every stage a non-negative amount', () => {
    // A tiny total split many ways must not produce negatives when the
    // remainder is applied.
    const parts = splitTotal(0.05, [25, 25, 25, 25]);
    expect(parts.every(p => p >= 0)).toBe(true);
    expect(sum(parts)).toBe(0.05);
  });

  it('matches equal instalments to the same total', () => {
    // The instalments path builds its percents as 100/count; it must land on
    // the same money as an explicit split would.
    const three = splitTotal(1000, [100 / 3, 100 / 3, 100 / 3]);
    expect(sum(three)).toBe(1000);
  });
});

describe('isCompleteSplit', () => {
  it('accepts a split that covers the job', () => {
    expect(isCompleteSplit([30, 40, 30])).toBe(true);
    expect(isCompleteSplit([100])).toBe(true);
    // Typed thirds, which a person will absolutely enter.
    expect(isCompleteSplit([33.33, 33.33, 33.34])).toBe(true);
  });

  it('rejects a split that does not', () => {
    // The form must refuse to send these: the client would be billed for less
    // or more than they agreed.
    expect(isCompleteSplit([30, 40])).toBe(false);
    expect(isCompleteSplit([50, 60])).toBe(false);
    expect(isCompleteSplit([])).toBe(false);
  });

  it('is not fooled by a rounding-sized gap that is actually a mistake', () => {
    // 1% missing on a ₪60,000 job is ₪600, not a rounding error.
    expect(isCompleteSplit([30, 40, 29])).toBe(false);
  });
});
