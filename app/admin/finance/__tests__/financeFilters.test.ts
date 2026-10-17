/**
 * @jest-environment node
 *
 * Finance F-4 (AC-174 to AC-176, BD-30, SA-W3, SA-W4, SA-W5, SA-W6, SA-W7,
 * SA-W11): the page's filter spec, pure. Each link is parsed exactly as the
 * shared hook does (canonical key first, then the first non-empty alias, U-9),
 * so a bad value is shown to drop ONLY its own filter (U-4), never the rest.
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import {
  FINANCE_CLEAR_PATCH,
  FINANCE_DEFAULT_WINDOW,
  FINANCE_FILTER_SPEC,
  financeCanClear,
  financeFilterRepair,
  financeWindowProblem,
  fromFinanceQuery,
  toFinanceQuery,
  type FinanceFilters,
} from '../financeFilters';
import * as again from '../financeFilters';
import { DEFAULT_FINANCE_QUERY, serialiseFinanceUrl } from '../financeUrl';
import { FINANCE_REQUEST_PATH, PIN_ACCOUNT as A, PIN_ACCOUNT_UPPER, PINNED_REQUESTS } from './financeRequestPins';

/** The hook's getter (useAdminFilters.ts, U-9): the canonical key's non-empty value, else the first non-empty alias. */
function getterFor<V>(field: AdminFilterField<V>, params: URLSearchParams) {
  return (key: string): string | null => {
    const canonical = params.get(key);
    if (canonical) return canonical;
    for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
      if (target !== key) continue;
      const value = params.get(legacy);
      if (value) return value;
    }
    return null;
  };
}

/** The hook's first parse of a link. */
function parseLink(link: string): FinanceFilters {
  const params = new URLSearchParams(link);
  const read = <V>(field: AdminFilterField<V>): V => {
    const parsed = field.parse(getterFor(field, params));
    return parsed === undefined ? field.defaultValue : parsed;
  };
  const S = FINANCE_FILTER_SPEC;
  return { window: read(S.window), account: read(S.account), tab: read(S.tab), sort: read(S.sort), group: read(S.group), show: read(S.show) };
}

const DEFAULTS: FinanceFilters = { window: FINANCE_DEFAULT_WINDOW, account: '', tab: '', sort: 'ai_cost', group: '', show: 'all' };
const requestOf = (filters: FinanceFilters) => `${FINANCE_REQUEST_PATH}?${serialiseFinanceUrl(toFinanceQuery(filters))}`;
const CUSTOM = { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } as const;

describe('the spec (U-5, U-9, SA-W7, SA-W11)', () => {
  it('is a module-level constant (the hook relies on its identity), keys in write order', () => {
    expect(again.FINANCE_FILTER_SPEC).toBe(FINANCE_FILTER_SPEC);
    expect(Object.keys(FINANCE_FILTER_SPEC)).toEqual(['window', 'account', 'tab', 'sort', 'group', 'show']);
    expect(FINANCE_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
    expect(FINANCE_FILTER_SPEC.window.aliases).toEqual({ preset: 'range' });
    expect(FINANCE_FILTER_SPEC.account.keys).toEqual(['account']);
    expect(FINANCE_FILTER_SPEC.account.aliases).toEqual({ accountId: 'account' });
    for (const key of ['tab', 'sort', 'group', 'show'] as const) expect(FINANCE_FILTER_SPEC[key].keys).toEqual([key]);
  });

  it('an empty link is every default', () => {
    expect(parseLink('')).toEqual(DEFAULTS);
  });

  it('reads the old keys as aliases, and the canonical key wins over its alias', () => {
    expect(parseLink(`preset=7d&accountId=${A}`)).toEqual({ ...DEFAULTS, window: { kind: 'preset', preset: '7d' }, account: A });
    expect(parseLink(`range=7d&preset=30d`).window).toEqual({ kind: 'preset', preset: '7d' });
    expect(parseLink(`account=${A}&accountId=22222222-2222-4222-8222-222222222222`).account).toBe(A);
  });

  it('lower-cases a business id (SA-W11), so the request is unchanged', () => {
    expect(parseLink(`account=${PIN_ACCOUNT_UPPER}`).account).toBe(A);
    expect(parseLink(`accountId=${PIN_ACCOUNT_UPPER}`).account).toBe(A);
  });

  it('writes the canonical keys only, never an alias and never a default', () => {
    const S = FINANCE_FILTER_SPEC;
    expect(S.window.serialise({ kind: 'preset', preset: '7d' })).toEqual({ range: '7d' });
    expect(S.window.serialise(CUSTOM)).toEqual({ range: 'custom', from: '2026-09-01', to: '2026-09-30' });
    expect(S.account.serialise(A)).toEqual({ account: A });
    expect(S.tab.serialise('accounts')).toEqual({ tab: 'accounts' });
    expect(S.group.serialise('trial')).toEqual({ group: 'trial' });
  });
});

describe('AC-173 bridge: every pinned state maps onto its pinned request', () => {
  it.each(PINNED_REQUESTS.map((pin) => [pin.row, pin.link, pin.request] as const))('row %i: ?%s', (_row, link, request) => {
    const filters = parseLink(link);
    expect(financeFilterRepair(filters)).toBeNull();
    expect(requestOf(filters)).toBe(request);
    // The tab's own onChange round trip changes nothing.
    expect({ ...filters, ...fromFinanceQuery(toFinanceQuery(filters)) }).toEqual(filters);
  });
});

describe('U-4 per key (BD-30, AC-175): a bad value drops only its own filter', () => {
  const kept = { account: A, tab: '' as const };

  it.each([
    ['an unknown range', `range=year&account=${A}`],
    ['an unknown old preset', `preset=year&accountId=${A}`],
    ['custom with no dates', `range=custom&account=${A}`],
    ['from after to', `range=custom&from=2026-09-30&to=2026-09-01&account=${A}`],
    ['an end after today UTC', `range=custom&from=2026-09-01&to=2999-01-01&account=${A}`],
    ['more than 92 days', `range=custom&from=2026-01-01&to=2026-09-30&account=${A}`],
    ['an impossible date', `range=custom&from=2026-02-30&to=2026-03-02&account=${A}`],
    ['a one-sided window (SA-W6)', `range=custom&from=2026-09-01&account=${A}`],
    ['minute bounds (SA-W6)', `range=custom&from=2026-09-01T10:00&to=2026-09-02T10:00&account=${A}`],
    ['instant bounds (SA-W6)', `from=2026-09-01T10:00:00Z&to=2026-09-02T10:00:00Z&account=${A}`],
    ['a page extra the finance page does not offer', `range=90d&account=${A}`],
  ])('%s → This month; the business is kept', (_name, link) => {
    expect(parseLink(link)).toEqual({ ...DEFAULTS, ...kept });
  });

  it('from / to with no range is an implied custom window (U-7) when valid', () => {
    expect(parseLink('from=2026-09-01&to=2026-09-30').window).toEqual(CUSTOM);
  });

  it("a preset's client dates are dropped (the server resolves its own window)", () => {
    expect(parseLink('range=7d&from=2026-09-01&to=2026-09-30').window).toEqual({ kind: 'preset', preset: '7d' });
  });

  it.each([
    ['a malformed account (old key)', 'range=7d&accountId=acme&tab=accounts&sort=margin'],
    ['a malformed account (new key)', 'range=7d&account=acme&tab=accounts&sort=margin'],
  ])('%s → all businesses; the window and the tab keys are kept', (_name, link) => {
    expect(parseLink(link)).toEqual({ ...DEFAULTS, window: { kind: 'preset', preset: '7d' }, tab: 'accounts', sort: 'margin' });
  });

  it.each([
    ['tab=overview', 'tab=overview'],
    ['an empty tab', 'tab='],
  ])('%s → the Overview; the window and the business are kept', (_name, tab) => {
    expect(parseLink(`range=30d&account=${A}&${tab}`)).toEqual({ ...DEFAULTS, window: { kind: 'preset', preset: '30d' }, account: A });
  });

  it.each([
    ['a malformed sort', 'sort=name', 'sort'],
    ['a malformed show', 'show=x', 'show'],
    ['an unknown group word', 'group=vip', 'group'],
    ['a malformed tier group', 'group=tier:Bad!', 'group'],
  ])('%s → that one key at its default; the tab and the other keys are kept', (_name, bad, key) => {
    const good = { sort: 'margin', group: 'trial', show: 'negative' } as const;
    const params = new URLSearchParams({ tab: 'accounts', ...good });
    params.delete(key);
    const filters = parseLink(`${params.toString()}&${bad}`);
    expect(filters).toEqual({ ...DEFAULTS, tab: 'accounts', ...good, [key]: DEFAULTS[key as keyof typeof good] });
  });

  it('a repeated key: the first value wins', () => {
    expect(parseLink('preset=7d&preset=30d').window).toEqual({ kind: 'preset', preset: '7d' });
    expect(parseLink('tab=accounts&sort=margin&sort=paid').sort).toBe('margin');
  });

  it('unknown keys are ignored (the hook keeps them in the address bar)', () => {
    expect(parseLink('range=today&name=Acme&utm_source=x')).toEqual({ ...DEFAULTS, window: { kind: 'preset', preset: 'today' } });
  });
});

describe('SA-W3: cross-key repair (the dependent key is the bad filter)', () => {
  it('a business with the tab keys keeps the business and drops tab, sort, group and show', () => {
    const filters = parseLink(`tab=accounts&account=${A}&sort=margin&group=trial`);
    expect(filters).toEqual({ ...DEFAULTS, account: A, tab: 'accounts', sort: 'margin', group: 'trial' });
    const fix = financeFilterRepair(filters);
    expect(fix).toEqual({ tab: '', sort: 'ai_cost', group: '', show: 'all' });
    // The request ignores them already, so the clean-up sends the same request.
    expect(requestOf(filters)).toBe(requestOf({ ...filters, ...fix }));
    expect(requestOf(filters)).toBe(`${FINANCE_REQUEST_PATH}?preset=this_month&accountId=${A}`);
  });

  it('sort / group / show without the tab are dropped; the window is kept', () => {
    const filters = parseLink('range=30d&sort=margin&show=active');
    const fix = financeFilterRepair(filters);
    expect(fix).toEqual({ sort: 'ai_cost', group: '', show: 'all' });
    expect(requestOf(filters)).toBe(`${FINANCE_REQUEST_PATH}?preset=30d`);
    expect(requestOf({ ...filters, ...fix })).toBe(requestOf(filters));
  });

  it('a valid state needs no repair', () => {
    expect(financeFilterRepair(DEFAULTS)).toBeNull();
    expect(financeFilterRepair({ ...DEFAULTS, tab: 'accounts', sort: 'paid' })).toBeNull();
    expect(financeFilterRepair({ ...DEFAULTS, account: A })).toBeNull();
  });
});

describe('the request bridge', () => {
  it('toFinanceQuery: the tab only with no business; an empty account or group is null', () => {
    expect(toFinanceQuery(DEFAULTS)).toEqual(DEFAULT_FINANCE_QUERY);
    expect(toFinanceQuery({ ...DEFAULTS, account: A, tab: 'accounts' }).tab).toBeNull();
    expect(toFinanceQuery({ ...DEFAULTS, window: CUSTOM })).toEqual({ ...DEFAULT_FINANCE_QUERY, preset: 'custom', from: '2026-09-01', to: '2026-09-30' });
  });

  it('toFinanceQuery is defensive: a value the spec never holds sends the default window', () => {
    expect(toFinanceQuery({ ...DEFAULTS, window: { kind: 'custom', from: '2026-09-01', to: null } }).preset).toBe('this_month');
    expect(toFinanceQuery({ ...DEFAULTS, window: { kind: 'linked', from: '2026-09-01T10:00', to: null } }).preset).toBe('this_month');
  });

  it('fromFinanceQuery maps the Accounts tab’s query back', () => {
    expect(fromFinanceQuery({ ...DEFAULT_FINANCE_QUERY, tab: 'accounts', sort: 'margin', group: 'trial', show: 'active' })).toEqual({
      ...DEFAULTS,
      tab: 'accounts',
      sort: 'margin',
      group: 'trial',
      show: 'active',
    });
    expect(fromFinanceQuery({ ...DEFAULT_FINANCE_QUERY, preset: 'custom', from: '2026-09-01', to: '2026-09-30' }).window).toEqual(CUSTOM);
    expect(fromFinanceQuery({ ...DEFAULT_FINANCE_QUERY, preset: 'custom' }).window).toEqual(FINANCE_DEFAULT_WINDOW);
  });
});

describe('SA-W4: Clear', () => {
  it('resets the window, the business, sort, group and show, and keeps the tab', () => {
    expect(FINANCE_CLEAR_PATCH).toEqual({ window: FINANCE_DEFAULT_WINDOW, account: '', sort: 'ai_cost', group: '', show: 'all' });
    expect('tab' in FINANCE_CLEAR_PATCH).toBe(false);
  });

  it('can clear only when one of those is not at its default (the tab alone does not count)', () => {
    expect(financeCanClear(DEFAULTS)).toBe(false);
    expect(financeCanClear({ ...DEFAULTS, tab: 'accounts' })).toBe(false);
    expect(financeCanClear({ ...DEFAULTS, window: { kind: 'preset', preset: '7d' } })).toBe(true);
    expect(financeCanClear({ ...DEFAULTS, window: { kind: 'preset', preset: 'this_month' } })).toBe(false);
    expect(financeCanClear({ ...DEFAULTS, account: A })).toBe(true);
    expect(financeCanClear({ ...DEFAULTS, tab: 'accounts', show: 'negative' })).toBe(true);
  });
});

describe('SA-W5: the custom-window rules the shared control does not check', () => {
  const NOW = new Date('2026-10-16T12:00:00.000Z');

  it('names the route’s own sentence for an end after today and for more than 92 days', () => {
    expect(financeWindowProblem({ kind: 'custom', from: '2026-10-01', to: '2026-10-17' }, NOW)).toBe('The end date must not be after today (UTC)');
    expect(financeWindowProblem({ kind: 'custom', from: '2026-07-15', to: '2026-10-15' }, NOW)).toBe('The window may be at most 92 days');
  });

  it('accepts today and exactly 92 days; a preset is never refused', () => {
    expect(financeWindowProblem({ kind: 'custom', from: '2026-10-16', to: '2026-10-16' }, NOW)).toBeNull();
    expect(financeWindowProblem({ kind: 'custom', from: '2026-07-16', to: '2026-10-15' }, NOW)).toBeNull();
    expect(financeWindowProblem({ kind: 'preset', preset: '30d' }, NOW)).toBeNull();
  });
});

// ── DF-6 (§11L.5, DF6-FR-7, DF6-FR-8, SA-W-DF6-4 / -5) ───────────────────────
describe('DF-6: since it started in the URL state and the request', () => {
  const SINCE = { kind: 'extra', extra: 'since_start' } as const;

  it('DF6-FR-7: range=since_start and the legacy preset=since_start both parse, with the business', () => {
    expect(parseLink(`range=since_start&account=${A}`)).toEqual({ ...DEFAULTS, window: SINCE, account: A });
    expect(parseLink(`preset=since_start&accountId=${A}`)).toEqual({ ...DEFAULTS, window: SINCE, account: A });
    expect(again.FINANCE_WINDOW_EXTRAS).toEqual(['since_start']);
  });

  it('only since_start is admitted among the extras', () => {
    expect(parseLink('range=90d').window).toEqual(FINANCE_DEFAULT_WINDOW);
    expect(parseLink('range=last_month').window).toEqual(FINANCE_DEFAULT_WINDOW);
  });

  it('SA-W-DF6-4: with a business it is sent; with none the default window is sent (never a request the route refuses)', () => {
    expect(requestOf({ ...DEFAULTS, window: SINCE, account: A })).toBe(`${FINANCE_REQUEST_PATH}?preset=since_start&accountId=${A}`);
    expect(requestOf({ ...DEFAULTS, window: SINCE })).toBe(`${FINANCE_REQUEST_PATH}?preset=this_month`);
  });

  it('fromFinanceQuery maps it back to the extra', () => {
    expect(fromFinanceQuery({ ...DEFAULT_FINANCE_QUERY, preset: 'since_start', accountId: A }).window).toEqual(SINCE);
  });

  it('DF6-FR-8 (a): no business → the window falls back to This month, nothing else changes, same request', () => {
    const filters = parseLink('range=since_start');
    expect(filters).toEqual({ ...DEFAULTS, window: SINCE });
    const fix = financeFilterRepair(filters);
    expect(fix).toEqual({ window: FINANCE_DEFAULT_WINDOW });
    expect(requestOf({ ...filters, ...fix })).toBe(requestOf(filters));
  });

  it('DF6-FR-8 (b): a bad business is dropped by its own parser, then (a)', () => {
    const filters = parseLink('range=since_start&account=acme');
    expect(filters.account).toBe('');
    expect(financeFilterRepair(filters)).toEqual({ window: FINANCE_DEFAULT_WINDOW });
  });

  it('DF6-FR-8 (c): dates beside it are ignored and the choice is kept', () => {
    const filters = parseLink(`range=since_start&from=2026-10-01&to=2026-10-02&account=${A}`);
    expect(filters.window).toEqual(SINCE);
    expect(financeFilterRepair(filters)).toBeNull();
    expect(requestOf(filters)).toBe(`${FINANCE_REQUEST_PATH}?preset=since_start&accountId=${A}`);
  });

  it('DF6-FR-8 (d): with tab=accounts and a business the tab goes (the business wins); the window stays', () => {
    const filters = parseLink(`range=since_start&tab=accounts&account=${A}`);
    expect(financeFilterRepair(filters)).toEqual({ tab: '', sort: 'ai_cost', group: '', show: 'all' });
    expect(requestOf(filters)).toBe(`${FINANCE_REQUEST_PATH}?preset=since_start&accountId=${A}`);
  });

  it('with no business and stray tab keys, the window is repaired first, then the keys (each a URL-only write)', () => {
    const filters = parseLink('range=since_start&sort=margin');
    const first = financeFilterRepair(filters);
    expect(first).toEqual({ window: FINANCE_DEFAULT_WINDOW });
    const next = { ...filters, ...first };
    expect(financeFilterRepair(next)).toEqual({ sort: 'ai_cost', group: '', show: 'all' });
    expect(requestOf(next)).toBe(requestOf(filters));
  });

  it('Clear resets it, and it counts as a non-default window', () => {
    expect(financeCanClear({ ...DEFAULTS, window: SINCE, account: A })).toBe(true);
    expect(FINANCE_CLEAR_PATCH.window).toEqual(FINANCE_DEFAULT_WINDOW);
    expect(financeWindowProblem(SINCE, new Date())).toBeNull();
  });
});
