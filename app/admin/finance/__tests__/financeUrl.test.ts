/**
 * @jest-environment node
 *
 * The finance page's REQUEST serialiser (slice 1a, L-4, SA-F11 condition 1).
 *
 * Finance F-4: the page URL is read and written by `useAdminFilters` with
 * `FINANCE_FILTER_SPEC` (`financeFilters.ts`), so `parseFinanceUrl`, its
 * notice and its key list are gone; their cases moved, with the U-4 per-key
 * expectations of BD-30, to `financeFilters.test.ts`. The round trips through
 * the old parser are now literal request strings, the same strings as the
 * AC-173 pin (`financeRequestPins.ts`).
 */

import { DEFAULT_FINANCE_QUERY, FINANCE_GROUP_SHAPE, serialiseFinanceUrl, type FinanceQuery } from '../financeUrl';

const A = '11111111-1111-4111-8111-111111111111';
/** Slice 6a: the four tab keys at their defaults (the Overview). */
const OVERVIEW = { tab: null, sort: 'ai_cost', group: null, show: 'all' } as const;

describe('serialiseFinanceUrl', () => {
  it('the default query', () => {
    expect(DEFAULT_FINANCE_QUERY).toEqual({ preset: 'this_month', from: null, to: null, accountId: null, ...OVERVIEW });
    expect(serialiseFinanceUrl(DEFAULT_FINANCE_QUERY)).toBe('preset=this_month');
  });

  it.each<[string, FinanceQuery, string]>([
    ['a preset with a business', { preset: '7d', from: null, to: null, accountId: A, ...OVERVIEW }, `preset=7d&accountId=${A}`],
    ['a custom range', { preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: null, ...OVERVIEW }, 'preset=custom&from=2026-09-01&to=2026-10-09'],
  ])('writes %s', (_name, query, expected) => {
    expect(serialiseFinanceUrl(query)).toBe(expected);
  });

  it('writes from / to only for custom', () => {
    expect(serialiseFinanceUrl({ preset: 'today', from: '2026-01-01', to: '2026-01-02', accountId: null, ...OVERVIEW })).toBe(
      'preset=today'
    );
  });

  it('only ever writes its keys, in order: ids and enums, never a name', () => {
    const keys = [...new URLSearchParams(serialiseFinanceUrl({ preset: 'custom', from: '2026-09-01', to: '2026-10-09', accountId: A, ...OVERVIEW })).keys()];
    expect(keys).toEqual(['preset', 'from', 'to', 'accountId']);
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

  it('AC-130: tab=accounts; defaults are omitted', () => {
    expect(serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, tab: 'accounts' })).toBe('preset=this_month&tab=accounts');
  });

  it.each<[string, FinanceQuery, string]>([
    ['sort by margin', { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', sort: 'margin' }, 'preset=this_month&tab=accounts&sort=margin'],
    [
      'a plan group and show active',
      { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', group: 'founding_partner', show: 'active' },
      'preset=this_month&tab=accounts&group=founding_partner&show=active',
    ],
    [
      'a tier group (by shape)',
      { ...DEFAULT_FINANCE_QUERY, tab: 'accounts', group: `tier:${TIER_ID}`, show: 'negative', sort: 'credits' },
      `preset=this_month&tab=accounts&sort=credits&group=${encodeURIComponent(`tier:${TIER_ID}`)}&show=negative`,
    ],
    [
      'a custom window on the tab',
      { ...DEFAULT_FINANCE_QUERY, preset: 'custom', from: '2026-09-15', to: '2026-10-09', tab: 'accounts', sort: 'paid' },
      'preset=custom&from=2026-09-15&to=2026-10-09&tab=accounts&sort=paid',
    ],
  ])('writes %s', (_name, query, expected) => {
    expect(serialiseFinanceUrl(query)).toBe(expected);
  });

  it('never writes the tab with a business picked, nor sort / group / show without the tab', () => {
    expect(serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, accountId: A, tab: 'accounts', sort: 'margin' })).toBe(`preset=this_month&accountId=${A}`);
    expect(serialiseFinanceUrl({ ...DEFAULT_FINANCE_QUERY, sort: 'margin', group: 'trial', show: 'active' })).toBe('preset=this_month');
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
