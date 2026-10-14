/**
 * Exact decimal arithmetic (AI model price review slice 3, SA C-8, R-1 test).
 */

import { inCodeTokenPrices } from '@/lib/ai/pricing';
import { IMAGE_FALLBACK_PRICING } from '@/lib/repositories/SystemConfigRepository';

import {
  compareDecimals,
  decimalFromNumberLiteral,
  formatDecimal,
  gapBasisPoints,
  halveDecimal,
  isPlainDecimal,
  movesBeyondBasisPoints,
  parseDecimal,
  perMillionToPerToken,
  perTokenToPerMillion,
  shiftDecimal,
} from '../decimal';

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({ aiModelPricingRepository: {} }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

describe('per 1M and per token (R-1)', () => {
  it('0.075 per 1M is exactly 0.000000075 per token, and back', () => {
    expect(perMillionToPerToken('0.075')).toBe('0.000000075');
    expect(perTokenToPerMillion('0.000000075')).toBe('0.075');
  });

  it('handles the R-1 extremes: 6 integer digits and 9 decimals', () => {
    expect(perMillionToPerToken('999999.999999999')).toBe('0.999999999999999');
    expect(perMillionToPerToken('0.000000001')).toBe('0.000000000000001');
    expect(perMillionToPerToken('15')).toBe('0.000015');
    expect(perTokenToPerMillion('0.000015')).toBe('15');
  });

  it('formats without exponent or trailing zeros', () => {
    expect(formatDecimal(parseDecimal('0.000000075000'))).toBe('0.000000075');
    expect(formatDecimal(shiftDecimal(parseDecimal('2.5'), 6))).toBe('2500000');
    expect(formatDecimal(parseDecimal('-1.50'))).toBe('-1.5');
  });

  it('refuses anything that is not a plain decimal', () => {
    expect(() => parseDecimal('1e-7')).toThrow();
    expect(() => parseDecimal('abc')).toThrow();
    expect(isPlainDecimal('0.15')).toBe(true);
    expect(isPlainDecimal('.15')).toBe(false);
  });
});

describe('comparison is exact where a float is not (C-8)', () => {
  it('the float trap: 0.121 per 1M through a float per-token value is not 0.121; the decimal path is', () => {
    // 0.121 / 1e6 * 1e6 is 0.12099999999999998 in a float: a covered model would read as undercharging.
    expect((0.121 / 1e6) * 1e6).not.toBe(0.121);
    expect(perTokenToPerMillion(perMillionToPerToken('0.121'))).toBe('0.121');
    expect(compareDecimals(shiftDecimal(parseDecimal(perMillionToPerToken('0.121')), 6), parseDecimal('0.121'))).toBe(0);
  });

  it('compares past 15 significant digits, where a float cannot (QA E-3)', () => {
    expect(Number('0.00000015000000000000000001')).toBe(Number('0.00000015'));
    expect(compareDecimals(parseDecimal('0.00000015000000000000000001'), parseDecimal('0.00000015'))).toBe(1);
  });

  it('compares across scales', () => {
    expect(compareDecimals(parseDecimal('0.1'), parseDecimal('0.10000'))).toBe(0);
    expect(compareDecimals(parseDecimal('0.1'), parseDecimal('0.0999999999'))).toBe(1);
    expect(compareDecimals(parseDecimal('2'), parseDecimal('10'))).toBe(-1);
  });

  it('halves exactly (the derived OpenAI cached-input rule)', () => {
    expect(formatDecimal(halveDecimal(parseDecimal('0.00000015')))).toBe('0.000000075');
    expect(formatDecimal(halveDecimal(parseDecimal('0.000000001')))).toBe('0.0000000005');
  });
});

describe('gapBasisPoints: display and sorting only', () => {
  it('is (a − b) ÷ b in basis points, rounded half away from zero', () => {
    expect(gapBasisPoints(parseDecimal('0.88'), parseDecimal('1'))).toBe(-1200);
    expect(gapBasisPoints(parseDecimal('1.35'), parseDecimal('1'))).toBe(3500);
    expect(gapBasisPoints(parseDecimal('1.00005'), parseDecimal('1'))).toBe(1);
    expect(gapBasisPoints(parseDecimal('0.99995'), parseDecimal('1'))).toBe(-1);
    expect(gapBasisPoints(parseDecimal('1'), parseDecimal('1'))).toBe(0);
  });

  it('is null against a zero base', () => {
    expect(gapBasisPoints(parseDecimal('1'), parseDecimal('0'))).toBeNull();
  });
});

describe('movesBeyondBasisPoints (the 50% blocking flag)', () => {
  it('is exact at the boundary', () => {
    expect(movesBeyondBasisPoints(parseDecimal('1.5'), parseDecimal('1'), 5000)).toBe(false);
    expect(movesBeyondBasisPoints(parseDecimal('1.500000001'), parseDecimal('1'), 5000)).toBe(true);
    expect(movesBeyondBasisPoints(parseDecimal('0.5'), parseDecimal('1'), 5000)).toBe(false);
    expect(movesBeyondBasisPoints(parseDecimal('0.499999999'), parseDecimal('1'), 5000)).toBe(true);
  });

  it('any move off a zero base is beyond the bound', () => {
    expect(movesBeyondBasisPoints(parseDecimal('0.1'), parseDecimal('0'), 5000)).toBe(true);
    expect(movesBeyondBasisPoints(parseDecimal('0'), parseDecimal('0'), 5000)).toBe(false);
  });
});

describe('float literals from the in-code tables (C-8: every value)', () => {
  it('expands exponent notation', () => {
    expect(formatDecimal(decimalFromNumberLiteral(1.5e-7))).toBe('0.00000015');
    expect(formatDecimal(decimalFromNumberLiteral(0.00075))).toBe('0.00075');
    expect(formatDecimal(decimalFromNumberLiteral(2e21))).toBe('2000000000000000000000');
    expect(() => decimalFromNumberLiteral(Number.NaN)).toThrow();
  });

  it('round-trips every in-code token price and every in-code image price', () => {
    const values: number[] = [];
    for (const models of Object.values(inCodeTokenPrices())) {
      for (const price of Object.values(models)) values.push(price.input, price.output);
    }
    values.push(...Object.values(IMAGE_FALLBACK_PRICING));
    expect(values.length).toBeGreaterThan(50);
    for (const value of values) {
      const text = formatDecimal(decimalFromNumberLiteral(value));
      expect(isPlainDecimal(text)).toBe(true);
      expect(Number(text)).toBe(value);
    }
  });
});
