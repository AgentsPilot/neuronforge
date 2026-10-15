/**
 * @jest-environment node
 *
 * The finance page's URL filters (slice 1a, L-4, SA-F11 condition 1).
 */

import {
  DEFAULT_FINANCE_QUERY,
  FINANCE_URL_KEYS,
  FINANCE_URL_NOTICE,
  FINANCE_GROUP_SHAPE,
  parseFinanceUrl,
  serialiseFinanceUrl,
  type FinanceQuery,
} from '../financeUrl';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const A = '11111111-1111-4111-8111-111111111111';
const parse = (qs: string) => parseFinanceUrl(new URLSearchParams(qs), NOW);
/** Slice 6a: the four tab keys at their defaults (the Overview). */
const OVERVIEW = { tab: null, sort: 'ai_cost', group: null, show: 'all' } as const;

describe('parseFinanceUrl', () => {
  it('an empty URL is the default with no notice', () => {
    expect(parse('')).toEqual({ query: DEFAULT_FINANCE_QUERY, notice: null });
    expect(DEFAULT_FINANCE_QUERY).toEqual({ preset: 'this_month', from: null, to: null, accountId: null, ...OVERVIEW });
  });

  it('reads a preset and a business', () => {
    expect(parse(`preset=7d&accountId=${A}`)).toEqual({
      query: { preset: '7d', from: null, to: null, accountId: A, ...OVERVIEW },
      notice: null,
    });
  });

  it('reads a valid custom range', () => {
    expect(parse('preset=custom&from=2026-09-01&to=2026-10-09').query).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-10-09',
      accountId: null,
      ...OVERVIEW,
    });
  });

  it('drops a preset’s client dates (the server resolves its own window)', () => {
    expect(parse('preset=30d&from=2020-01-01&to=2020-01-02')).toEqual({
      query: { preset: '30d', from: null, to: null, accountId: null, ...OVERVIEW },
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
      query: { preset: 'today', from: null, to: null, accountId: null, ...OVERVIEW },
      notice: null,
    });
  });
});

describe('serialiseFinanceUrl', () => {
  it.each<[string, FinanceQuery]>([
    ['the default', DEFAULT_FINANCE_QUERY],
    ['a preset with a business', { preset: '7d', from: null, to: null, accountId: A, ...OVERVIEW }],
    ['a custom range', { preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: null, ...OVERVIEW }],
  ])('round trips %s', (_name, query) => {
    expect(parse(serialiseFinanceUrl(query))).toEqual({ query, notice: null });
  });

  it('writes from / to only for custom', () => {
    expect(serialiseFinanceUrl({ preset: 'today', from: '2026-01-01', to: '2026-01-02', accountId: null, ...OVERVIEW })).toBe(
      'preset=today'
    );
  });

  it('only ever writes its keys: ids and enums, never a name (slice 6a: eight keys, pinned in order)', () => {
    const keys = [...new URLSearchParams(serialiseFinanceUrl({ preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: A, ...OVERVIEW })).keys()];
    for (const key of keys) expect(FINANCE_URL_KEYS).toContain(key);
    expect(keys).toEqual(['preset', 'from', 'to', 'accountId']);
    expect(FINANCE_URL_KEYS).toEqual(['preset', 'from', 'to', 'accountId', 'tab', 'sort', 'group', 'show']);
    const tabKeys = [
      ...new URLSearchParams(
        serialiseFinanceUrl({ preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: null, tab: 'accounts', sort: 'margin', group: 'trial', show: 'negative' })
      ).keys(),
    ];
    expect(tabKeys).toEqual(['preset', 'from', 'to', 'tab', 'sort', 'group', 'show']);
  });
});

describe('slice 6a: the Accounts tab keys (SA-Q43, SA-Q44, E-48, SA-W84)', () => {
  const TIER_ID: string = jest.requireActual('@/lib/business-os/entitlements/source').getEntitlementConfig().tierOrder[0];

  it('AC-130: tab=accounts round trips; defaults are omitted from the URL', () => {
    const query: FinanceQuery = { ...DEFAULT_FINANCE_QUERY, tab: 'accounts' };
    expect(serialiseFinanceUrl(query)).toBe('preset=this_month&tab=accounts');
    expect(parse(serialiseFinanceUrl(query))).toEqual({ query, notice: null });
  });

  it.each<[string, FinanceQuery]>([
    ['sort by margin', { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', sort: 'margin' }],
    ['a plan group and show active', { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', group: 'founding_partner', show: 'active' }],
    ['a tier group (by shape)', { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', group: `tier:${TIER_ID}`, show: 'negative', sort: 'credits' }],
    ['a custom window on the tab', { ...DEFAULT_FINANCE_QUERY, preset: 'custom', from: '2026-09-15', to: '2026-10-09', tab: 'accounts', sort: 'paid' }],
  ])('round trips %s', (_name, query) => {
    expect(parse(serialiseFinanceUrl(query))).toEqual({ query, notice: null });
  });

  it('never writes the tab with a business picked, nor sort / group / show without the tab', () => {
    expect(serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, accountId: A, tab: 'accounts', sort: 'margin' })).toBe(`preset=this_month&accountId=${A}`);
    expect(serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, sort: 'margin', group: 'trial', show: 'active' })).toBe('preset=this_month');
  });

  it.each([
    ['tab=overview', 'tab=overview'],
    ['an empty tab', 'tab='],
    ['tab with a business picked (SA-W84)', `tab=accounts&accountId=${A}`],
    ['sort without the tab (E-48)', 'sort=margin'],
    ['group without the tab (E-48)', 'group=trial'],
    ['show without the tab (E-48)', 'show=active'],
    ['a malformed sort', 'tab=accounts&sort=name'],
    ['a malformed show', 'tab=accounts&show=x'],
    ['a malformed group', 'tab=accounts&group=tier:Bad!'],
    ['an unknown group word', 'tab=accounts&group=vip'],
    ['a repeated sort', 'tab=accounts&sort=margin&sort=paid'],
  ])('%s → the default plus the notice', (_name, qs) => {
    expect(parse(qs)).toEqual({ query: DEFAULT_FINANCE_QUERY, notice: FINANCE_URL_NOTICE });
  });

  it('SA-W83: the group shape accepts the six group kinds and any well-formed tier key, and nothing else', () => {
    for (const ok of ['trial', 'founding_partner', 'comped', 'unknown_held', 'tier_set', `tier:${TIER_ID}`, 'tier:no-such-tier']) {
      expect({ ok, valid: FINANCE_GROUP_SHAPE.test(ok) }).toEqual({ ok, valid: true });
    }
    for (const bad of ['tier:', 'tier:UPPER', 'TRIAL', 'trial ', `tier:${'x'.repeat(41)}`, 'all']) {
      expect({ bad, valid: FINANCE_GROUP_SHAPE.test(bad) }).toEqual({ bad, valid: false });
    }
  });
});
