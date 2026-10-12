/**
 * The currency helper (finance & business health slice 2a, T2): AC-13 (one
 * line per normalised currency, the Unknown line last, never assumed USD),
 * scale 100 with the unreadable rule (S2-CUR-3, SA-Q13), exact sums at the
 * largest declared magnitude, and the exact export list: no export returns a
 * total across currencies (S2-CUR-1).
 */

import * as currencyGroups from '../currencyGroups';
import { CURRENCY_SCALE, groupByCurrency, normaliseCurrencyCode, toHundredths } from '../currencyGroups';

type Field = 'gross' | 'refunded';
const FIELDS: readonly Field[] = ['gross', 'refunded'];
const gross = (currency: unknown, hundredths: number | null) => ({ currency, field: 'gross' as const, hundredths });

describe('normaliseCurrencyCode (CUR-2)', () => {
  it.each([
    ['USD', 'USD'],
    ['usd', 'USD'],
    [' ils ', 'ILS'],
    ['Eur', 'EUR'],
  ])('%p → %p', (raw, code) => {
    expect(normaliseCurrencyCode(raw)).toBe(code);
  });

  it.each([[null], [undefined], [''], ['  '], ['US'], ['USDX'], ['U$D'], ['12A'], [840], [{}]])('%p → null (Unknown currency, never USD)', (raw) => {
    expect(normaliseCurrencyCode(raw)).toBeNull();
  });
});

describe('toHundredths (S2-CUR-3, scale 100)', () => {
  it('scale is 100', () => {
    expect(CURRENCY_SCALE).toBe(100);
  });

  it.each([
    [12.34, 1234],
    ['12.34', 1234],
    [' 12.34 ', 1234],
    [0, 0],
    ['0.00', 0],
    [0.1 + 0.2, 30],
    [-5.5, -550],
    [1e10, 1e12],
    // The largest value either declared column can hold: NUMERIC(12,2) and DECIMAL(10,2).
    [9_999_999_999.99, 999_999_999_999],
    ['9999999999.99', 999_999_999_999],
    [99_999_999.99, 9_999_999_999],
    [1_234_567.89, 123_456_789],
  ])('%p → %p hundredths, an exact integer', (raw, expected) => {
    const value = toHundredths(raw);
    expect(value).toBe(expected);
    expect(Number.isSafeInteger(value)).toBe(true);
  });

  it.each([[12.345], ['12.345'], [NaN], [Infinity], [-Infinity], [null], [undefined], [''], ['  '], ['abc'], [{}], [[]], [true], [1e20]])(
    '%p → null (unreadable, never 0)',
    (raw) => {
      expect(toHundredths(raw)).toBeNull();
    }
  );

  it('a valid refund-sized value whose n * 100 is off by more than 1e-6 through float rounding alone stays readable', () => {
    // The reason the tolerance widens with magnitude (Implementation Notes, D-1).
    const raw = 5_344_746_814.64;
    expect(Math.abs(raw * 100 - Math.round(raw * 100))).toBeGreaterThan(1e-6);
    expect(toHundredths(raw)).toBe(534_474_681_464);
  });

  it('a third decimal is still unreadable at the largest magnitude (the float tolerance stays far below 0.5)', () => {
    expect(toHundredths(9_999_999_999.5)).toBe(999_999_999_950);
    expect(toHundredths('9999999999.995')).toBeNull();
    expect(toHundredths('99999999.995')).toBeNull();
  });
});

describe('groupByCurrency (AC-13, S2-CUR-1, S2-CUR-5)', () => {
  it('USD, usd, ILS and NULL → three lines: ILS, USD, then Unknown last; each summed in its own currency', () => {
    const lines = groupByCurrency([gross('USD', 1000), gross('usd', 250), gross('ILS', 4000), gross(null, 7)], FIELDS);
    expect(lines.map((l) => l.currency)).toEqual(['ILS', 'USD', null]);
    expect(lines.map((l) => l.sums.gross)).toEqual([4000, 1250, 7]);
    expect(lines.every((l) => l.sums.refunded === 0 && !l.overflow)).toBe(true);
  });

  it('" ils " joins ILS; "US" and "USDX" join the Unknown line', () => {
    const lines = groupByCurrency([gross(' ils ', 100), gross('ILS', 1), gross('US', 2), gross('USDX', 3)], FIELDS);
    expect(lines).toEqual([
      { currency: 'ILS', sums: { gross: 101, refunded: 0 }, unreadable: { gross: 0, refunded: 0 }, overflow: false },
      { currency: null, sums: { gross: 5, refunded: 0 }, unreadable: { gross: 0, refunded: 0 }, overflow: false },
    ]);
  });

  it('an unreadable amount creates its line and is counted, never summed as 0', () => {
    const lines = groupByCurrency(
      [gross('EUR', null), { currency: 'EUR', field: 'refunded' as const, hundredths: 300 }, gross('EUR', 100)],
      FIELDS
    );
    expect(lines).toEqual([
      { currency: 'EUR', sums: { gross: 100, refunded: 300 }, unreadable: { gross: 1, refunded: 0 }, overflow: false },
    ]);
  });

  it('sorted by code, the Unknown line last, whatever the input order', () => {
    const lines = groupByCurrency([gross(null, 1), gross('USD', 1), gross('AUD', 1), gross('ILS', 1), gross('EUR', 1)], FIELDS);
    expect(lines.map((l) => l.currency)).toEqual(['AUD', 'EUR', 'ILS', 'USD', null]);
  });

  it('0.1 + 0.2 summed in hundredths is exactly 30', () => {
    const [line] = groupByCurrency([gross('USD', toHundredths(0.1)), gross('USD', toHundredths(0.2))], FIELDS);
    expect(line.sums.gross).toBe(30);
  });

  it('a sum past the safe-integer range is flagged, never silent', () => {
    const [line] = groupByCurrency([gross('USD', Number.MAX_SAFE_INTEGER), gross('USD', 10)], FIELDS);
    expect(line.overflow).toBe(true);
  });

  it('no entry → no line (never "USD 0.00" for a currency with no rows)', () => {
    expect(groupByCurrency([], FIELDS)).toEqual([]);
  });
});

describe('the export list (S2-CUR-1: no total across currencies)', () => {
  it('is exactly the four runtime names; the CurrencyLine type is type-only', () => {
    expect(Object.keys(currencyGroups).sort()).toEqual(['CURRENCY_SCALE', 'groupByCurrency', 'normaliseCurrencyCode', 'toHundredths']);
  });
});
