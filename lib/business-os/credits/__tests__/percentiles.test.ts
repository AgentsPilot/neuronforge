/**
 * The percentile rule (workplan §4.3, SA Q-13 / S-6): linear interpolation
 * between closest ranks, equal to Postgres `percentile_cont`.
 */

import { FEW_EXAMPLES_BELOW, percentileCont, spreadOf } from '../percentiles';

describe('percentileCont', () => {
  it('returns null for no values', () => {
    expect(percentileCont([], 0.5)).toBeNull();
  });

  it('returns the single value for one value, at any percentile', () => {
    expect(percentileCont([7], 0.5)).toBe(7);
    expect(percentileCont([7], 0.9)).toBe(7);
  });

  it('interpolates between two values', () => {
    // percentile_cont(0.5) of {1, 3} = 2; percentile_cont(0.9) = 1 + 0.9 * 2 = 2.8
    expect(percentileCont([3, 1], 0.5)).toBe(2);
    expect(percentileCont([3, 1], 0.9)).toBeCloseTo(2.8, 12);
  });

  it('matches percentile_cont on ten values', () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    // position = p * (n - 1): 0.5 * 9 = 4.5 → between 5 and 6; 0.9 * 9 = 8.1 → 9 + 0.1 * 1
    expect(percentileCont(values, 0.5)).toBe(5.5);
    expect(percentileCont(values, 0.9)).toBeCloseTo(9.1, 12);
  });

  it('ignores non-finite values and does not mutate its input', () => {
    const values = [3, Number.NaN, 1, Number.POSITIVE_INFINITY];
    expect(percentileCont(values, 0.5)).toBe(2);
    expect(values[0]).toBe(3);
  });

  it('refuses a percentile outside [0, 1]', () => {
    expect(() => percentileCont([1], 1.5)).toThrow(RangeError);
    expect(() => percentileCont([1], -0.1)).toThrow(RangeError);
  });
});

describe('spreadOf', () => {
  it('marks fewer than FEW_EXAMPLES_BELOW examples as "few examples"', () => {
    expect(FEW_EXAMPLES_BELOW).toBe(10);
    expect(spreadOf([1, 2, 3]).fewExamples).toBe(true);
    expect(spreadOf(Array.from({ length: 9 }, (_v, i) => i)).fewExamples).toBe(true);
    expect(spreadOf(Array.from({ length: 10 }, (_v, i) => i)).fewExamples).toBe(false);
  });

  it('reports the examples and both figures', () => {
    expect(spreadOf([1, 2])).toEqual({ examples: 2, p50: 1.5, p90: expect.closeTo(1.9, 12), fewExamples: true });
    expect(spreadOf([])).toEqual({ examples: 0, p50: null, p90: null, fewExamples: true });
  });
});
