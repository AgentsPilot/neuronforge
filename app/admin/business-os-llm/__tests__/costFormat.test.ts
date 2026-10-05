/**
 * The Costs & credits tab's number formats. Sub-cent actions are the norm, so
 * `$0.00` for a real charge would be a wrong answer on the screen.
 */

import { formatCount, formatCredits, formatDay, formatUsd, utcDateDaysAgo } from '../costFormat';

describe('formatUsd', () => {
  it.each([
    [0, '$0'],
    [1234.5, '$1,234.50'],
    [1, '$1.00'],
    [0.3, '$0.30'],
    [0.01, '$0.01'],
    [0.0042, '$0.0042'],
    [0.002, '$0.002'],
    [0.0005, '$0.0005'],
    [0.00000021, '$0.00000021'],
    [0.0000000003, '$0.0000000003'],
    [-0.3, '-$0.30'],
    [-0.0001, '-$0.0001'],
  ])('%p → %s', (value, text) => {
    expect(formatUsd(value)).toBe(text);
  });

  it('never prints a non-zero amount as $0.00', () => {
    for (const v of [0.004, 0.0001, 0.000001, 0.0000001]) expect(formatUsd(v)).not.toBe('$0.00');
  });

  it('a non-zero value below the stored 10 decimals (an interpolated percentile) keeps two significant digits (QA edge 6)', () => {
    expect(formatUsd(4e-11)).toBe('$0.00000000004');
    expect(formatUsd(1.23e-12)).toBe('$0.0000000000012');
    expect(formatUsd(-4e-11)).toBe('-$0.00000000004');
    for (const v of [4e-11, 1e-13, 9.9e-11]) {
      expect(formatUsd(v)).not.toMatch(/^-?\$0(\.0+)?$/);
    }
  });

  it('renders a missing value as a dash', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });
});

describe('formatCredits / formatCount / formatDay / utcDateDaysAgo', () => {
  it('credits keep up to 6 decimals and drop trailing zeros', () => {
    expect(formatCredits(4)).toBe('4');
    expect(formatCredits(0.000213)).toBe('0.000213');
    expect(formatCredits(-0.5)).toBe('-0.5');
    expect(formatCredits(1234.5)).toBe('1,234.5');
    expect(formatCredits(null)).toBe('—');
  });

  it('a non-zero credit value below 6 decimals keeps two significant digits, never "0" (QA edge 6)', () => {
    expect(formatCredits(1e-7)).toBe('0.0000001');
    expect(formatCredits(4.4e-7)).toBe('0.00000044');
    expect(formatCredits(-2.5e-8)).toBe('-0.000000025');
    expect(formatCredits(0)).toBe('0');
  });

  it('counts are grouped', () => {
    expect(formatCount(20000)).toBe('20,000');
    expect(formatCount(null)).toBe('—');
  });

  it('days are UTC dates', () => {
    expect(formatDay('2026-09-05T00:00:00+00:00')).toBe('2026-09-05');
    expect(formatDay('2026-09-04T23:30:00-02:00')).toBe('2026-09-05');
    expect(formatDay('garbage')).toBe('garbage');
  });

  it('utcDateDaysAgo counts back from a given instant', () => {
    expect(utcDateDaysAgo(29, new Date('2026-09-29T23:00:00Z'))).toBe('2026-08-31');
    expect(utcDateDaysAgo(0, new Date('2026-09-29T00:30:00Z'))).toBe('2026-09-29');
  });
});
