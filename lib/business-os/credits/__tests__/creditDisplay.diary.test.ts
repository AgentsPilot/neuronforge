/**
 * The credit history's rounding (credit deduction slice 7a, D-m; SA SQ-34, Q-6).
 *
 * One decimal; "less than 0.1" for a non-zero line that would show 0.0, sign
 * kept; the summary parts always add up to the shown total.
 */

import { toDiaryCredits, toDiarySummary, type DiaryCreditFigure } from '../creditDisplay';

const tenths = (value: number): DiaryCreditFigure => ({ kind: 'tenths', value });

describe('toDiaryCredits', () => {
  it.each([
    [2.1, tenths(2.1)],
    [0.2, tenths(0.2)],
    [250, tenths(250)],
    [0.16, tenths(0.2)],
    [0.05, tenths(0.1)],
    [17.04, tenths(17)],
    [-12.5, tenths(-12.5)],
  ])('%p → %p', (credits, expected) => {
    expect(toDiaryCredits(credits)).toEqual(expected);
  });

  it('a positive line below 0.05 is "less than 0.1", never 0.0', () => {
    expect(toDiaryCredits(0.04)).toEqual({ kind: 'less_than_tenth', negative: false });
    expect(toDiaryCredits(0.000001)).toEqual({ kind: 'less_than_tenth', negative: false });
  });

  it('a small correction keeps its sign, never "−0.0"', () => {
    expect(toDiaryCredits(-0.04)).toEqual({ kind: 'less_than_tenth', negative: true });
  });

  it('zero, and an unreadable number, show as zero', () => {
    expect(toDiaryCredits(0)).toEqual({ kind: 'zero' });
    expect(toDiaryCredits(Number.NaN)).toEqual({ kind: 'zero' });
  });

  it('whole numbers format without ".0" through Intl', () => {
    const f = toDiaryCredits(250);
    const text = new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format((f as { value: number }).value);
    expect(text).toBe('250');
  });
});

describe('toDiarySummary', () => {
  const value = (f: DiaryCreditFigure) => (f.kind === 'tenths' ? Math.round(f.value * 10) : 0);

  it('the scoping example: 63.4 = 41.2 + 22.2', () => {
    expect(toDiarySummary({ used: 63.4, usedByOwner: 41.2, usedAutomatic: 22.2 })).toEqual({
      used: tenths(63.4),
      byOwner: tenths(41.2),
      automatic: tenths(22.2),
    });
  });

  it('the parts always add up to the shown total (sweep)', () => {
    for (let i = 0; i < 2000; i += 1) {
      const owner = ((i * 7919) % 100000) / 1e4;
      const automatic = ((i * 104729) % 100000) / 1e4;
      const shown = toDiarySummary({ used: owner + automatic, usedByOwner: owner, usedAutomatic: automatic });
      if (shown.used.kind !== 'tenths') continue;
      expect(value(shown.byOwner) + value(shown.automatic)).toBe(value(shown.used));
    }
  });

  it('a tiny total: "less than 0.1", the larger part carries it', () => {
    expect(toDiarySummary({ used: 0.03, usedByOwner: 0.01, usedAutomatic: 0.02 })).toEqual({
      used: { kind: 'less_than_tenth', negative: false },
      byOwner: { kind: 'zero' },
      automatic: { kind: 'less_than_tenth', negative: false },
    });
  });

  it('nothing used', () => {
    expect(toDiarySummary({ used: 0, usedByOwner: 0, usedAutomatic: 0 })).toEqual({
      used: { kind: 'zero' },
      byOwner: { kind: 'zero' },
      automatic: { kind: 'zero' },
    });
  });

  it('over the allowance: the true total at one decimal', () => {
    expect(toDiarySummary({ used: 32260.4, usedByOwner: 32000.2, usedAutomatic: 260.2 }).used).toEqual(tenths(32260.4));
  });
});
