/**
 * Exact rate maths for the sync (Admin Exchange Rates slice 1e; SA §13.7
 * SQ-38, SQ-41): the §5.7.2 worked values, half away from zero at the 7th
 * decimal, and the §5.7.5 gap with its direction from the exact comparison.
 */

import { parseDecimal } from '@/lib/ai/pricing-research/decimal';

import { divideHalfUp, rateGap, toFixedPlaces } from '../rateMath';

const divide = (numerator: string, denominator: string, places = 6) =>
  toFixedPlaces(divideHalfUp(parseDecimal(numerator), parseDecimal(denominator), places), places);

describe('divideHalfUp: the §5.7.2 worked values (ECB of 2026-10-23)', () => {
  it('ILS 3.4939 ÷ 1.1193 → 3.121505 (3.12150451…: the 7th decimal is 5, the half-up case)', () => {
    expect(divide('3.4939', '1.1193')).toBe('3.121505');
  });

  it('GBP 0.83728 ÷ 1.1193 → 0.748039', () => {
    expect(divide('0.83728', '1.1193')).toBe('0.748039');
  });

  it('EUR 1 ÷ 1.1193 → 0.893416', () => {
    expect(divide('1', '1.1193')).toBe('0.893416');
  });
});

describe('divideHalfUp: rounding', () => {
  it('an exact tie at the 7th decimal rounds up', () => {
    expect(divide('0.0000005', '1')).toBe('0.000001');
    expect(divide('0.0000015', '1')).toBe('0.000002');
  });

  it('just below the tie rounds down', () => {
    expect(divide('0.0000004999', '1')).toBe('0.000000');
    expect(divide('0.0000014999', '1')).toBe('0.000001');
  });

  it('a negative half rounds away from zero', () => {
    expect(divide('-0.0000005', '1')).toBe('-0.000001');
    expect(divide('0.0000005', '-1')).toBe('-0.000001');
    expect(divide('-0.0000004', '1')).toBe('0.000000');
  });

  it('aligns different scales', () => {
    expect(divide('10', '0.25')).toBe('40.000000');
    expect(divide('1.5', '3', 2)).toBe('0.50');
    expect(divide('2', '3', 0)).toBe('1');
  });

  it('a zero denominator throws (a programming error)', () => {
    expect(() => divideHalfUp(parseDecimal('1'), parseDecimal('0'), 6)).toThrow(/division by zero/);
    expect(() => divideHalfUp(parseDecimal('1'), parseDecimal('0.000'), 6)).toThrow(/division by zero/);
  });
});

describe('toFixedPlaces', () => {
  it('pads to exactly the places', () => {
    expect(toFixedPlaces(parseDecimal('3.09'), 6)).toBe('3.090000');
    expect(toFixedPlaces(parseDecimal('0'), 2)).toBe('0.00');
    expect(toFixedPlaces(parseDecimal('12'), 0)).toBe('12');
    expect(toFixedPlaces(parseDecimal('0.5'), 3)).toBe('0.500');
  });

  it('signs a negative with -, never a positive with +', () => {
    expect(toFixedPlaces(parseDecimal('-0.61'), 6)).toBe('-0.610000');
    expect(toFixedPlaces(parseDecimal('0.61'), 6)).toBe('0.610000');
  });

  it('refuses to cut digits', () => {
    expect(() => toFixedPlaces(parseDecimal('1.2345678'), 6)).toThrow();
  });
});

describe('rateGap (SQ-41)', () => {
  it('the worked case: 3.09 → 3.70 is +0.610000, +19.74%, up', () => {
    expect(rateGap('3.09', '3.70')).toEqual({ gapAbsolute: '+0.610000', gapPercent: '+19.74%', direction: 'up' });
  });

  it('a lower suggestion is negative and down', () => {
    expect(rateGap('3.70', '3.09')).toEqual({ gapAbsolute: '-0.610000', gapPercent: '-16.49%', direction: 'down' });
  });

  it('equal in another form (3.090000 vs 3.09) is none', () => {
    expect(rateGap('3.090000', '3.09')).toEqual({ gapAbsolute: '0.000000', gapPercent: '0.00%', direction: 'none' });
  });

  it('+0.000001 reads +0.00% and is still up (colour from the exact compare, never the rounded %)', () => {
    expect(rateGap('3.090000', '3.090001')).toEqual({ gapAbsolute: '+0.000001', gapPercent: '+0.00%', direction: 'up' });
  });

  it('-0.000001 reads -0.00% and is down', () => {
    expect(rateGap('3.090001', '3.090000')).toEqual({ gapAbsolute: '-0.000001', gapPercent: '-0.00%', direction: 'down' });
  });

  it('the accept audit worked case: 3.09 → 3.121505 is +0.031505, +1.02%, up', () => {
    expect(rateGap('3.09', '3.121505')).toEqual({ gapAbsolute: '+0.031505', gapPercent: '+1.02%', direction: 'up' });
  });

  it('refuses a zero current rate', () => {
    expect(() => rateGap('0', '1')).toThrow();
  });
});
