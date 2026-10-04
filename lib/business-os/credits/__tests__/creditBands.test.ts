/**
 * The band module (credit deduction slice 8a, SA SQ-39, BD-20, AC-40, AC-41).
 */

import {
  CREDIT_BANDS,
  LOW_LINE_PERCENT,
  bandColor,
  bandFor,
  creditPercentLeft,
  lowLineOf,
  type CreditBand,
} from '../creditBands';

const FP = 32_250;
const TRIAL = 2_000;

/** `used` that leaves exactly `percent`% of `allowance`, at 6 dp. */
const usedLeaving = (allowance: number, percent: number) => Math.round(allowance * (1 - percent / 100) * 1e6) / 1e6;

describe('creditPercentLeft — BD-20', () => {
  it.each([
    ['nothing used', 0, FP, { kind: 'percent', value: 100 }, 'plenty'],
    ['one 0.2-credit briefing', 0.2, FP, { kind: 'percent', value: 99 }, 'plenty'],
    ['64.9% left', usedLeaving(FP, 64.9), FP, { kind: 'percent', value: 64 }, 'plenty'],
    ['exactly 60%', usedLeaving(FP, 60), FP, { kind: 'percent', value: 60 }, 'plenty'],
    ['59.99%', usedLeaving(FP, 59.99), FP, { kind: 'percent', value: 59 }, 'comfortable'],
    ['exactly 30%', usedLeaving(FP, 30), FP, { kind: 'percent', value: 30 }, 'comfortable'],
    ['29.5%', usedLeaving(FP, 29.5), FP, { kind: 'percent', value: 29 }, 'low'],
    ['exactly 10.000000% (monthly)', usedLeaving(FP, 10), FP, { kind: 'percent', value: 10 }, 'low'],
    ['exactly 10.000000% (trial)', usedLeaving(TRIAL, 10), TRIAL, { kind: 'percent', value: 10 }, 'low'],
    ['9.6%', usedLeaving(FP, 9.6), FP, { kind: 'percent', value: 9 }, 'below_line'],
    ['1% exactly', usedLeaving(FP, 1), FP, { kind: 'percent', value: 1 }, 'below_line'],
    ['0.4% left', usedLeaving(FP, 0.4), FP, { kind: 'less_than_one' }, 'below_line'],
    ['one micro-credit left', FP - 0.000001, FP, { kind: 'less_than_one' }, 'below_line'],
    ['exactly at the allowance', FP, FP, { kind: 'percent', value: 0 }, 'below_line'],
    ['over the allowance', FP + 12.5, FP, { kind: 'percent', value: 0 }, 'below_line'],
    ['a negative used clamps to nothing used', -3, FP, { kind: 'percent', value: 100 }, 'plenty'],
  ])('%s', (_name, used, allowance, shown, band) => {
    const result = creditPercentLeft(used as number, allowance as number);
    expect(result).not.toBeNull();
    expect(result!.shown).toEqual(shown);
    expect(result!.band).toBe(band);
  });

  it('the exact share drives the arc, never the shown number', () => {
    expect(creditPercentLeft(0, FP)!.share).toBe(1);
    expect(creditPercentLeft(FP, FP)!.share).toBe(0);
    expect(creditPercentLeft(FP + 1, FP)!.share).toBe(0);
    expect(creditPercentLeft(usedLeaving(FP, 0.4), FP)!.share).toBeGreaterThan(0);
    expect(creditPercentLeft(1000, TRIAL)!.share).toBe(0.5);
  });

  it.each([
    ['no allowance', 5, null],
    ['zero allowance', 5, 0],
    ['negative allowance', 5, -10],
    ['NaN allowance', 5, Number.NaN],
    ['infinite allowance', 5, Number.POSITIVE_INFINITY],
    ['NaN used', Number.NaN, FP],
    ['an allowance too large for exact integers (SA Q-10)', 1, 1e8],
  ])('%s → null', (_name, used, allowance) => {
    expect(creditPercentLeft(used as number, allowance as number | null)).toBeNull();
  });

  it('DV-2: the scaled subtraction equals round((allowance − used) × 10⁶) on 6-dp inputs', () => {
    for (const [allowance, used] of [
      [32250, 20640.123456],
      [19750, 0.000001],
      [2000, 1799.999999],
      [32250, 29025],
    ]) {
      const separate = Math.round(allowance * 1e6) - Math.round(used * 1e6);
      expect(separate).toBe(Math.round((allowance - used) * 1e6));
    }
  });

  it('number and band never disagree near any boundary (micro-credit sweep)', () => {
    for (const allowance of [FP, 19_750, TRIAL]) {
      for (const boundary of [60, 30, 10, 1]) {
        const centre = Math.round(allowance * (1 - boundary / 100) * 1e6);
        for (let step = -50; step <= 50; step += 1) {
          const used = (centre + step) / 1e6;
          const result = creditPercentLeft(used, allowance)!;
          expect(result.band).toBe(bandFor(result.shown));
          if (result.shown.kind === 'percent') {
            const exactLeftMicro = Math.round(allowance * 1e6) - (centre + step);
            expect(result.shown.value).toBe(Math.floor((exactLeftMicro * 100) / Math.round(allowance * 1e6)));
          }
        }
      }
    }
  });
});

describe('bands as data', () => {
  it('the cut-offs and the SA colours', () => {
    expect(CREDIT_BANDS.map((band) => [band.id, band.from, band.color])).toEqual([
      ['plenty', 60, '#059669'],
      ['comfortable', 30, '#2a78d6'],
      ['low', 10, '#EA580C'],
      ['below_line', 0, '#EF4444'],
    ]);
  });

  it('the low line is 10, derived from the band above the red one', () => {
    expect(LOW_LINE_PERCENT).toBe(10);
    const moved: CreditBand[] = CREDIT_BANDS.map((band) => (band.id === 'low' ? { ...band, from: 15 } : band));
    expect(lowLineOf(moved)).toBe(15);
    expect(() => lowLineOf([{ id: 'below_line', from: 0, color: '#000000' }])).toThrow();
  });

  it.each([
    [100, 'plenty'],
    [60, 'plenty'],
    [59, 'comfortable'],
    [30, 'comfortable'],
    [29, 'low'],
    [10, 'low'],
    [9, 'below_line'],
    [0, 'below_line'],
  ])('bandFor(%i%) = %s', (value, band) => {
    expect(bandFor({ kind: 'percent', value })).toBe(band);
  });

  it('"less than 1%" is red, and every band has its colour', () => {
    expect(bandFor({ kind: 'less_than_one' })).toBe('below_line');
    for (const band of CREDIT_BANDS) expect(bandColor(band.id)).toBe(band.color);
  });
});
