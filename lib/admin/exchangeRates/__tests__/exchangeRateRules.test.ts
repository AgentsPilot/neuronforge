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
  rateOriginSchema,
  rateStringSchema,
  sameRate,
  UNKNOWN_USER_LABEL,
  exchangeRatesQuerySchema,
  historyEditorIds,
  labelHistory,
  editorLabel,
  type ExchangeRateHistoryRecord,
  KPI_RATE_DECIMALS,
  roundRateForDisplay,
  HISTORY_DEFAULT_PRESET,
  HISTORY_WINDOW_MAX_DATE,
  HISTORY_WINDOW_MIN_DATE,
  defaultHistoryWindowDates,
  historyWindowBounds,
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

// ── Slice 1d: the history window (SQ-26, SQ-28, SA-1d-3) ────────────────────

describe('the GET query with a history window (slice 1d, SQ-26, SA-1d-3)', () => {
  it.each([
    [{}],
    [{ currency: 'ILS' }],
    [{ from: '2026-10-01', to: '2026-10-20' }],
    [{ currency: 'ILS', from: '2026-10-01', to: '2026-10-20' }],
    [{ from: '2026-10-20', to: '2026-10-20' }],
    // A `to` after today is allowed, and there is no day cap (SQ-26).
    [{ from: '2026-10-01', to: '2099-12-31' }],
    [{ from: HISTORY_WINDOW_MIN_DATE, to: HISTORY_WINDOW_MAX_DATE }],
  ])('accepts %j', (query) => {
    expect(exchangeRatesQuerySchema.safeParse(query).success).toBe(true);
  });

  it.each([
    ['only from', { from: '2026-10-01' }],
    ['only to', { to: '2026-10-20' }],
    ['reversed', { from: '2026-10-20', to: '2026-10-01' }],
    ['not a real date', { from: '2026-02-30', to: '2026-03-01' }],
    ['an empty date', { from: '', to: '2026-10-20' }],
    ['an unpadded month', { from: '2026-1-01', to: '2026-10-20' }],
    ['before the range', { from: '1999-12-31', to: '2026-10-20' }],
    ['after the range', { from: '2026-10-01', to: '3000-01-01' }],
    ['year 0', { from: '0000-01-01', to: '2026-10-20' }],
    ['year 9999', { from: '2026-10-01', to: '9999-12-31' }],
    ['an unknown limit', { from: '2026-10-01', to: '2026-10-20', limit: '50' }],
  ])('refuses %s', (_name, query) => {
    expect(exchangeRatesQuerySchema.safeParse(query).success).toBe(false);
  });

  it('the range constants are the SA-1d-3 values', () => {
    expect(HISTORY_WINDOW_MIN_DATE).toBe('2000-01-01');
    expect(HISTORY_WINDOW_MAX_DATE).toBe('2999-12-31');
  });
});

describe('historyWindowBounds (slice 1d, SQ-28): half-open UTC midnights', () => {
  it.each([
    ['a month to date', '2026-10-01', '2026-10-20', '2026-10-01T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
    ['one day', '2026-10-20', '2026-10-20', '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z'],
    ['month end', '2026-10-01', '2026-10-31', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'],
    ['year end', '2026-12-01', '2026-12-31', '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'],
    ['leap year, Feb 28', '2028-02-01', '2028-02-28', '2028-02-01T00:00:00.000Z', '2028-02-29T00:00:00.000Z'],
    ['leap year, Feb 29', '2028-02-01', '2028-02-29', '2028-02-01T00:00:00.000Z', '2028-03-01T00:00:00.000Z'],
    ['common year, Feb 28', '2027-02-01', '2027-02-28', '2027-02-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z'],
    ['the range limits', '2000-01-01', '2999-12-31', '2000-01-01T00:00:00.000Z', '3000-01-01T00:00:00.000Z'],
  ])('%s', (_name, from, to, fromInclusive, toExclusive) => {
    expect(historyWindowBounds({ from, to })).toEqual({ fromInclusive, toExclusive });
  });
});

describe('defaultHistoryWindowDates (slice 1d, SQ-26)', () => {
  it('is This month at the given clock', () => {
    expect(HISTORY_DEFAULT_PRESET).toBe('this_month');
    expect(defaultHistoryWindowDates(new Date('2026-10-20T15:30:00.000Z'))).toEqual({ from: '2026-10-01', to: '2026-10-20' });
    expect(defaultHistoryWindowDates(new Date('2026-10-01T00:00:00.000Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(defaultHistoryWindowDates(new Date('2026-10-31T23:59:59.999Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});

// ── Slice 1e (SA §13.7 SQ-43 / SQ-44, §13.8 SQ-50 (2)): additions only ──────

describe('PATCH body, slice 1e: expectedRate and origin on the rate branch', () => {
  const ORIGIN = { kind: 'sync', source: 'ecb', rateDate: '2026-10-23' };

  it('accepts both keys on the rate branch', () => {
    const parsed = patchBodySchema.safeParse({ field: 'rate', rate: '3.121505', expectedRate: '3.09', origin: ORIGIN });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ field: 'rate', rate: '3.121505', expectedRate: '3.09', origin: ORIGIN });
  });

  it('accepts expectedRate alone', () => {
    expect(patchBodySchema.safeParse({ field: 'rate', rate: '3.1', expectedRate: '3.09' }).success).toBe(true);
  });

  it('refuses origin without expectedRate (SQ-50 (2))', () => {
    expect(patchBodySchema.safeParse({ field: 'rate', rate: '3.1', origin: ORIGIN }).success).toBe(false);
  });

  it.each([
    ['expectedRate', { field: 'enabled', isEnabled: true, expectedRate: '3.09' }],
    ['origin', { field: 'enabled', isEnabled: true, origin: ORIGIN }],
  ])('refuses %s on the enabled branch', (_name, body) => {
    expect(patchBodySchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['an unknown key in origin', { ...ORIGIN, note: 'x' }],
    ['a bad date', { ...ORIGIN, rateDate: '2026-02-30' }],
    ['a date in another form', { ...ORIGIN, rateDate: '23/10/2026' }],
    ['another source', { ...ORIGIN, source: 'frankfurter' }],
    ['another kind', { ...ORIGIN, kind: 'manual' }],
    ['a missing rate date', { kind: 'sync', source: 'ecb' }],
    ['not an object', 'ecb'],
  ])('refuses origin with %s', (_name, origin) => {
    expect(patchBodySchema.safeParse({ field: 'rate', rate: '3.1', expectedRate: '3.09', origin }).success).toBe(false);
  });

  it.each(['0', '-1', '1.1234567', '', 3.09])('refuses expectedRate %j (same rules as a rate)', (expectedRate) => {
    expect(patchBodySchema.safeParse({ field: 'rate', rate: '3.1', expectedRate }).success).toBe(false);
  });

  it('rateOriginSchema is exported and strict', () => {
    expect(rateOriginSchema.safeParse(ORIGIN).success).toBe(true);
    expect(rateOriginSchema.safeParse({ ...ORIGIN, extra: 1 }).success).toBe(false);
  });
});

// ── Slice 1f (SA §13.9 SQ-54): the one label rule for one admin id ──────────

describe('editorLabel (slice 1f, SQ-54)', () => {
  const ANNA = 'aaaaaaaa-1111-4111-8111-111111111111';
  const ok = (names: Array<[string, string]>, emails: Array<[string, string]>) =>
    ({ status: 'ok', names: new Map(names), emails: new Map(emails) }) as const;

  it('no id: "Unknown user", whatever the lookup (nothing was looked up)', () => {
    expect(editorLabel(null, ok([], []))).toBe(UNKNOWN_USER_LABEL);
    expect(editorLabel(null, { status: 'failed' })).toBe(UNKNOWN_USER_LABEL);
  });

  it('a failed lookup: null, so the page shows the short id', () => {
    expect(editorLabel(ANNA, { status: 'failed' })).toBeNull();
  });

  it('the trimmed name first', () => {
    expect(editorLabel(ANNA, ok([[ANNA, '  Anna Admin  ']], [[ANNA, 'anna@example.com']]))).toBe('Anna Admin');
  });

  it('a blank name falls back to the email', () => {
    expect(editorLabel(ANNA, ok([[ANNA, '   ']], [[ANNA, 'anna@example.com']]))).toBe('anna@example.com');
  });

  it('neither a name nor an email: "Unknown user"', () => {
    expect(editorLabel(ANNA, ok([], []))).toBe(UNKNOWN_USER_LABEL);
  });
});
