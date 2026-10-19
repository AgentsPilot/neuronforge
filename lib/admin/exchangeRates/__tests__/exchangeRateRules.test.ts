/**
 * Exchange rates slice 1a: the pure rules (SQ-3, SQ-5 as amended by SA O-1,
 * SA-R7 same-value saves, FR-8 / SA O-5 stale rule).
 */

import {
  BASE_CURRENCY,
  HISTORY_LIMIT,
  RATE_MAX,
  STALE_AFTER_DAYS,
  STALE_DESCRIPTION,
  ageInDays,
  currencyCodeSchema,
  isPositiveRate,
  isRateStale,
  isStale,
  normaliseRate,
  patchBodySchema,
  rateStringSchema,
  sameRate,
} from '../exchangeRateRules';

describe('rate strings (SA O-1)', () => {
  it.each(['1', '3.71', '0.000001', '999999.999999', '000150', '150', '0.79', '1.000000'])('accepts %s', (rate) => {
    expect(rateStringSchema.safeParse(rate).success).toBe(true);
    expect(isPositiveRate(rate)).toBe(true);
  });

  it.each([
    '0',
    '0.000000',
    '000000',
    '-1',
    '1000000',
    '1234567',
    '10000000',
    '10000000.000001',
    '123456789',
    '1.1234567',
    '1e3',
    ' 1',
    '1 ',
    '1.',
    '.5',
    '',
    '1,5',
    '+1',
    'NaN',
  ])('refuses %j', (rate) => {
    expect(rateStringSchema.safeParse(rate).success).toBe(false);
  });

  it('refuses a JS number (the rate travels as a string)', () => {
    expect(rateStringSchema.safeParse(1.2).success).toBe(false);
  });

  it('RATE_MAX is the largest accepted value and one more digit is refused', () => {
    expect(rateStringSchema.safeParse(RATE_MAX).success).toBe(true);
    expect(rateStringSchema.safeParse(`1${RATE_MAX}`).success).toBe(false);
  });
});

describe('currency codes (SQ-3)', () => {
  it.each(['USD', 'EUR', 'ILS'])('accepts %s', (code) => {
    expect(currencyCodeSchema.safeParse(code).success).toBe(true);
  });
  it.each(['usd', 'US', 'USDX', '12A', 'U$D', '', 'Usd'])('refuses %j', (code) => {
    expect(currencyCodeSchema.safeParse(code).success).toBe(false);
  });
  it('the base currency is USD', () => {
    expect(BASE_CURRENCY).toBe('USD');
  });
});

describe('PATCH body (SQ-3: strict discriminated union)', () => {
  it('accepts one rate change and one enabled change', () => {
    expect(patchBodySchema.safeParse({ field: 'rate', rate: '3.71' }).success).toBe(true);
    expect(patchBodySchema.safeParse({ field: 'enabled', isEnabled: false }).success).toBe(true);
  });

  it.each([
    ['empty', {}],
    ['unknown field', { field: 'symbol', symbol: '$' }],
    ['both fields', { field: 'rate', rate: '1', isEnabled: true }],
    ['extra key', { field: 'enabled', isEnabled: true, note: 'x' }],
    ['updatedBy smuggled', { field: 'rate', rate: '1', updatedBy: 'someone' }],
    ['updated_by smuggled', { field: 'enabled', isEnabled: true, updated_by: 'someone' }],
    ['enabled as a string', { field: 'enabled', isEnabled: 'true' }],
    ['rate as a number', { field: 'rate', rate: 1.2 }],
    ['rate missing', { field: 'rate' }],
    ['not an object', 'rate'],
    ['null', null],
  ])('refuses %s', (_name, body) => {
    expect(patchBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('sameRate / normaliseRate (SA-R7 same-value saves)', () => {
  it.each([
    ['3.65', '3.650000'],
    ['000150', '150'],
    ['150.000000', '150'],
    ['0.790000', '0.79'],
    ['1', '1.0'],
  ])('%s equals %s', (a, b) => {
    expect(sameRate(a, b)).toBe(true);
  });

  it.each([
    ['3.65', '3.651'],
    ['150', '15'],
    ['0.1', '1'],
  ])('%s differs from %s', (a, b) => {
    expect(sameRate(a, b)).toBe(false);
  });

  it('handles null on either side', () => {
    expect(sameRate(null, null)).toBe(true);
    expect(sameRate(null, '1')).toBe(false);
    expect(sameRate('1', null)).toBe(false);
  });

  it('normalises zero', () => {
    expect(normaliseRate('0.000000')).toBe('0');
  });
});

describe('isStale / ageInDays (FR-8, 35 days)', () => {
  const readAt = '2026-10-19T12:00:00.000Z';
  const daysBefore = (days: number, extraMs = 0) =>
    new Date(Date.parse(readAt) - days * 86_400_000 - extraMs).toISOString();

  it('is not stale at exactly 35 days, stale one second later', () => {
    expect(STALE_AFTER_DAYS).toBe(35);
    expect(isStale(daysBefore(35), readAt)).toBe(false);
    expect(isStale(daysBefore(35, 1000), readAt)).toBe(true);
  });

  it('is not stale when fresh, stale for the 2025-11-05 rows', () => {
    expect(isStale(daysBefore(1), readAt)).toBe(false);
    expect(isStale('2025-11-05T10:00:00.000Z', readAt)).toBe(true);
  });

  it('a missing or unreadable date is stale', () => {
    expect(isStale(null, readAt)).toBe(true);
    expect(isStale('not a date', readAt)).toBe(true);
  });

  it('ageInDays counts whole days', () => {
    expect(ageInDays(daysBefore(3, 5000), readAt)).toBe(3);
    expect(ageInDays(null, readAt)).toBeNull();
  });

  it('isRateStale: the base currency is never stale; any other code follows isStale (review B-1)', () => {
    const old = '2025-11-05T10:00:00.000Z';
    expect(isRateStale({ currencyCode: 'USD', lastUpdatedAt: old }, readAt)).toBe(false);
    expect(isRateStale({ currencyCode: 'USD', lastUpdatedAt: null }, readAt)).toBe(false);
    expect(isRateStale({ currencyCode: 'EUR', lastUpdatedAt: old }, readAt)).toBe(true);
    expect(isRateStale({ currencyCode: 'EUR', lastUpdatedAt: null }, readAt)).toBe(true);
    expect(isRateStale({ currencyCode: 'EUR', lastUpdatedAt: daysBefore(1) }, readAt)).toBe(false);
  });

  it('the history limit has one value, 50', () => {
    expect(HISTORY_LIMIT).toBe(50);
  });

  it('the description says "not updated", never "not confirmed" (SA O-5)', () => {
    expect(STALE_DESCRIPTION).toBe('not updated in 35 days');
  });
});
