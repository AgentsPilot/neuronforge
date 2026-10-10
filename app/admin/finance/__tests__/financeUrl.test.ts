/**
 * @jest-environment node
 *
 * The finance page's URL filters (slice 1a, L-4, SA-F11 condition 1).
 */

import {
  DEFAULT_FINANCE_QUERY,
  FINANCE_URL_KEYS,
  FINANCE_URL_NOTICE,
  parseFinanceUrl,
  serialiseFinanceUrl,
  type FinanceQuery,
} from '../financeUrl';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const A = '11111111-1111-4111-8111-111111111111';
const parse = (qs: string) => parseFinanceUrl(new URLSearchParams(qs), NOW);

describe('parseFinanceUrl', () => {
  it('an empty URL is the default with no notice', () => {
    expect(parse('')).toEqual({ query: DEFAULT_FINANCE_QUERY, notice: null });
    expect(DEFAULT_FINANCE_QUERY).toEqual({ preset: 'this_month', from: null, to: null, accountId: null });
  });

  it('reads a preset and a business', () => {
    expect(parse(`preset=7d&accountId=${A}`)).toEqual({
      query: { preset: '7d', from: null, to: null, accountId: A },
      notice: null,
    });
  });

  it('reads a valid custom range', () => {
    expect(parse('preset=custom&from=2026-09-01&to=2026-10-09').query).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-10-09',
      accountId: null,
    });
  });

  it('drops a preset’s client dates (the server resolves its own window)', () => {
    expect(parse('preset=30d&from=2020-01-01&to=2020-01-02')).toEqual({
      query: { preset: '30d', from: null, to: null, accountId: null },
      notice: null,
    });
  });

  it.each([
    ['an unknown preset', 'preset=year'],
    ['a malformed account id', 'accountId=acme'],
    ['custom without dates', 'preset=custom'],
    ['custom with to before from', 'preset=custom&from=2026-10-05&to=2026-10-01'],
    ['custom ending tomorrow', 'preset=custom&from=2026-10-01&to=2026-10-10'],
    ['custom over 92 days', 'preset=custom&from=2026-07-09&to=2026-10-09'],
    ['custom with an impossible date', 'preset=custom&from=2026-02-30&to=2026-03-02'],
    ['a repeated key', 'preset=7d&preset=30d'],
  ])('%s → the default plus a notice, never a throw', (_name, qs) => {
    expect(parse(qs)).toEqual({ query: DEFAULT_FINANCE_QUERY, notice: FINANCE_URL_NOTICE });
  });

  it('drops an unknown key with no notice', () => {
    expect(parse('preset=today&name=Acme&utm_source=x')).toEqual({
      query: { preset: 'today', from: null, to: null, accountId: null },
      notice: null,
    });
  });
});

describe('serialiseFinanceUrl', () => {
  it.each<[string, FinanceQuery]>([
    ['the default', DEFAULT_FINANCE_QUERY],
    ['a preset with a business', { preset: '7d', from: null, to: null, accountId: A }],
    ['a custom range', { preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: null }],
  ])('round trips %s', (_name, query) => {
    expect(parse(serialiseFinanceUrl(query))).toEqual({ query, notice: null });
  });

  it('writes from / to only for custom', () => {
    expect(serialiseFinanceUrl({ preset: 'today', from: '2026-01-01', to: '2026-01-02', accountId: null })).toBe(
      'preset=today'
    );
  });

  it('only ever writes the four keys: ids and enums, never a name', () => {
    const keys = [...new URLSearchParams(serialiseFinanceUrl({ preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: A })).keys()];
    for (const key of keys) expect(FINANCE_URL_KEYS).toContain(key);
    expect(keys).toEqual(['preset', 'from', 'to', 'accountId']);
  });
});
