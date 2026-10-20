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
  UNKNOWN_USER_LABEL,
  exchangeRatesQuerySchema,
  historyEditorIds,
  labelHistory,
  type ExchangeRateHistoryRecord,
  KPI_RATE_DECIMALS,
  roundRateForDisplay,
} from '../exchangeRateRules';

describe('roundRateForDisplay (Last rate change tile, 3 decimals)', () => {
  it('defaults to 3 decimals', () => {
    expect(KPI_RATE_DECIMALS).toBe(3);
  });

  it.each([
    ['3.650000', '3.650'],
    ['3.700000', '3.700'],
    ['1.000000', '1.000'],
    ['0.920000', '0.920'],
    ['150.000000', '150.000'],
    ['3.6549', '3.655'],
    ['3.6544', '3.654'],
    ['3.6545', '3.655'],
    ['0.0005', '0.001'],
    ['0.0004', '0.000'],
    ['0.999500', '1.000'],
    ['9.9995', '10.000'],
    ['999999.999999', '1000000.000'],
    ['3.7', '3.700'],
    ['42', '42.000'],
    [' 3.65 ', '3.650'],
  ])('%s → %s', (input, expected) => {
    expect(roundRateForDisplay(input)).toBe(expected);
  });

  it('honours an explicit place count', () => {
    expect(roundRateForDisplay('3.656789', 2)).toBe('3.66');
    expect(roundRateForDisplay('3.6', 6)).toBe('3.600000');
  });

  it.each(['', 'abc', '-1.5', '1e3', '1.2.3'])('returns %p unchanged when it is not a plain decimal', (input) => {
    expect(roundRateForDisplay(input)).toBe(input);
  });
});

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

  it('the history limit has one value, 10 (slice 1c.1, FR-18)', () => {
    expect(HISTORY_LIMIT).toBe(10);
  });

  it('the description says "not updated", never "not confirmed" (SA O-5)', () => {
    expect(STALE_DESCRIPTION).toBe('not updated in 35 days');
  });
});

// ── Slice 1c.1 ──────────────────────────────────────────────────────────────

describe('the GET query (slice 1c.1, SQ-12)', () => {
  it.each([[{}], [{ currency: 'ILS' }], [{ currency: 'USD' }]])('accepts %j', (query) => {
    expect(exchangeRatesQuerySchema.safeParse(query).success).toBe(true);
  });

  it.each([
    [{ currency: 'ils' }],
    [{ currency: '' }],
    [{ currency: 'ILSX' }],
    [{ currency: 'IL' }],
    [{ limit: '50' }],
    [{ currency: 'ILS', limit: '50' }],
  ])('refuses %j', (query) => {
    expect(exchangeRatesQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('"Changed by" labels (slice 1c.1, SQ-13 with SA Q-1)', () => {
  const ANNA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const BEN = 'bbbbbbbb-2222-4222-8222-222222222222';
  const CARL = 'cccccccc-3333-4333-8333-333333333333';

  const record = (id: string, changedBy: string | null): ExchangeRateHistoryRecord => ({
    id,
    currencyCode: 'ILS',
    oldRate: '3.600000',
    newRate: '3.650000',
    changedBy,
    changedAt: '2026-10-19T11:00:00+00:00',
    changeReason: null,
  });

  it('the editors to look up are distinct and never null', () => {
    expect(historyEditorIds([record('h1', ANNA), record('h2', null), record('h3', ANNA), record('h4', BEN)])).toEqual([
      ANNA,
      BEN,
    ]);
    expect(historyEditorIds([record('h1', null)])).toEqual([]);
  });

  it('ok: name, else email, else "Unknown user"; every label set', () => {
    const labelled = labelHistory(
      [record('h1', ANNA), record('h2', BEN), record('h3', CARL), record('h4', null)],
      {
        status: 'ok',
        names: new Map([
          [ANNA, '  Anna Admin  '],
          [BEN, '   '],
        ]),
        emails: new Map([
          [ANNA, 'anna@example.com'],
          [BEN, 'ben@example.com'],
        ]),
      }
    );
    expect(labelled.map((row) => row.changedByLabel)).toEqual([
      'Anna Admin',
      'ben@example.com',
      UNKNOWN_USER_LABEL,
      UNKNOWN_USER_LABEL,
    ]);
    expect(UNKNOWN_USER_LABEL).toBe('Unknown user');
  });

  it('ok: an empty name falls through to the email', () => {
    const [row] = labelHistory([record('h1', ANNA)], {
      status: 'ok',
      names: new Map([[ANNA, '']]),
      emails: new Map([[ANNA, 'anna@example.com']]),
    });
    expect(row.changedByLabel).toBe('anna@example.com');
  });

  it('failed: every looked-up editor is null; a row with no editor is still "Unknown user" (SA Q-1)', () => {
    const labelled = labelHistory([record('h1', ANNA), record('h2', null), record('h3', BEN)], { status: 'failed' });
    expect(labelled.map((row) => row.changedByLabel)).toEqual([null, UNKNOWN_USER_LABEL, null]);
  });

  it('keeps every other field as it was, and the editor id for tracing', () => {
    const [row] = labelHistory([record('h1', ANNA)], { status: 'failed' });
    expect(row).toEqual({ ...record('h1', ANNA), changedByLabel: null });
  });
});
