/**
 * @jest-environment node
 *
 * Money M-1 (T10, AC-113, SA-W56): every link out of the account summary
 * carries the account and the SAME window, in the target page's own keys.
 *
 * Each href is parsed back through the TARGET'S OWN filter spec (imported here,
 * in the test only; `financeLinks.ts` imports nothing from another page), and
 * the parsed window is resolved with the target's own `resolveWindow` at the
 * same instant. A key the target would ignore parses to `undefined`, which
 * fails here, so a link can never silently drop the window or the account.
 */

import { ANALYTICS_FILTER_SPEC } from '@/app/admin/analytics/analyticsFilters';
import { ACTIVITY_FILTER_SPEC } from '@/app/admin/business-os-llm/activityFilters';
import { COSTS_FILTER_SPEC } from '@/app/admin/business-os-llm/costsFilters';
import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';
import { resolveWindow } from '@/app/admin/components/layout/adminWindow';
import { USERS_FILTER_SPEC } from '@/app/admin/users/usersFilters';
import type { FinanceWindowChoice } from '@/lib/business-os/finance/financeTypes';
import {
  activityHref,
  analyticsHref,
  businessesHref,
  costsHref,
  section3AnalyticsHref,
  type FinanceLinkWindow,
} from '../financeLinks';

const A = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-14T15:30:00.000Z');

/** The payload's window for a choice, as the server resolves it. */
function windowFor(preset: FinanceWindowChoice): FinanceLinkWindow {
  if (preset === 'custom') return { preset, from: '2026-09-20', to: '2026-10-03' };
  return { preset, ...resolveAdminWindow(preset, NOW) };
}

const PRESETS: FinanceWindowChoice[] = ['today', '7d', '30d', 'this_month', 'custom'];

/** The hook's getter: a canonical key's non-empty value, else null. */
const paramsOf = (href: string) => new URL(href, 'http://admin.test').searchParams;
const getter = (params: URLSearchParams) => (key: string) => params.get(key) || null;

function datesOfParsed(value: ReturnType<typeof ACTIVITY_FILTER_SPEC.window.parse>) {
  expect(value).toBeDefined();
  const resolved = resolveWindow(value!, NOW);
  expect(resolved.kind).toBe('dates');
  return resolved.kind === 'dates' ? { from: resolved.from, to: resolved.to } : null;
}

describe.each([
  ['Activity', activityHref, ACTIVITY_FILTER_SPEC, 'activity'],
  ['Costs & credits', costsHref, COSTS_FILTER_SPEC, 'costs'],
] as const)('%s link', (_name, hrefOf, spec, tab) => {
  it.each(PRESETS)('window %s: the target parses the same dates and the account; nothing else is sent', (preset) => {
    const window = windowFor(preset);
    const href = hrefOf(A, window);
    expect(href.startsWith('/admin/business-os-llm?')).toBe(true);
    const params = paramsOf(href);
    expect(params.get('tab')).toBe(tab);
    const get = getter(params);
    expect(spec.account.parse(get)).toBe(A);
    const parsed = spec.window.parse(get);
    expect(datesOfParsed(parsed)).toEqual({ from: window.from, to: window.to });
    // A preset stays a preset (same rule, same dates); custom stays custom.
    expect(parsed?.kind).toBe(preset === 'custom' ? 'custom' : 'preset');
    // Every key is one the target owns (or the page's tab): none is ignored.
    const owned = new Set(['tab', ...spec.window.keys, ...spec.account.keys]);
    for (const key of params.keys()) expect({ key, owned: owned.has(key) }).toEqual({ key, owned: true });
  });
});

describe('AI cost & usage link (SA-W56)', () => {
  it.each(PRESETS)('window %s: the target parses the same dates and the account', (preset) => {
    const window = windowFor(preset);
    const href = analyticsHref(A, window);
    expect(href.startsWith('/admin/analytics?')).toBe(true);
    const params = paramsOf(href);
    const get = getter(params);
    expect(ANALYTICS_FILTER_SPEC.account.parse(get)).toBe(A);
    // `scope` left out: its default is Business OS.
    expect(params.has('scope')).toBe(false);
    expect(ANALYTICS_FILTER_SPEC.scope.parse(get)).toBeUndefined();
    expect(ANALYTICS_FILTER_SPEC.scope.defaultValue).toBe('bos');
    const parsed = ANALYTICS_FILTER_SPEC.window.parse(get);
    expect(datesOfParsed(parsed)).toEqual({ from: window.from, to: window.to });
    // Its 7d / 30d are rolling (period=N), so those go out as the payload's exact dates.
    if (preset === 'today' || preset === 'this_month') expect(parsed).toEqual({ kind: 'preset', preset });
    else expect(parsed).toEqual({ kind: 'custom', from: window.from, to: window.to });
    const owned = new Set([...ANALYTICS_FILTER_SPEC.window.keys, ...ANALYTICS_FILTER_SPEC.account.keys]);
    for (const key of params.keys()) expect({ key, owned: owned.has(key) }).toEqual({ key, owned: true });
  });

  it('Section 3 (CR G-8): the window always; the account only when one is picked', () => {
    const window = windowFor('7d');
    expect(section3AnalyticsHref(A, window)).toBe(analyticsHref(A, window));
    const all = paramsOf(section3AnalyticsHref(null, window));
    expect(all.has('account')).toBe(false);
    expect(datesOfParsed(ANALYTICS_FILTER_SPEC.window.parse(getter(all)))).toEqual({ from: window.from, to: window.to });
  });
});

describe('Businesses link (SA-Q33, SA-W67)', () => {
  it('status=all and the one-shot account key, which the Businesses spec reads as page-only', () => {
    const href = businessesHref(A);
    expect(href).toBe(`/admin/users?status=all&account=${A}`);
    const get = getter(paramsOf(href));
    expect(USERS_FILTER_SPEC.status.parse(get)).toBe('all');
    expect(USERS_FILTER_SPEC.account.parse(get)).toBe(A);
    expect(USERS_FILTER_SPEC.account.pageOnly).toBe(true);
  });
});

describe('only the id travels (AC-113)', () => {
  it('no link carries anything but the id: no name, no email', () => {
    const window = windowFor('this_month');
    for (const href of [activityHref(A, window), costsHref(A, window), analyticsHref(A, window), businessesHref(A)]) {
      const values = [...paramsOf(href).values()];
      expect(values).toContain(A);
      for (const value of values) expect(value).toMatch(/^[a-z0-9_-]+$/);
    }
  });
});

// Slice 6a (AC-144, M3-FR-7): a separate import, so the lines above stay unedited.
import { accountViewHref } from '../financeLinks';
import { DEFAULT_FINANCE_QUERY, parseFinanceUrl } from '../financeUrl';

describe('slice 6a: accountViewHref, an Accounts row → the one-account view on the same window (AC-144)', () => {
  it.each(PRESETS)('%s: parsed back through parseFinanceUrl gives exactly the window and the id, and no tab key', (preset) => {
    const window = windowFor(preset);
    const href = accountViewHref(A, window);
    expect(href.startsWith('/admin/finance?')).toBe(true);
    const params = paramsOf(href);
    const parsed = parseFinanceUrl(params, NOW);
    expect(parsed.notice).toBeNull();
    expect(parsed.query).toEqual({
      ...DEFAULT_FINANCE_QUERY,
      preset,
      from: preset === 'custom' ? window.from : null,
      to: preset === 'custom' ? window.to : null,
      accountId: A,
    });
    expect([...params.keys()]).toEqual(preset === 'custom' ? ['preset', 'from', 'to', 'accountId'] : ['preset', 'accountId']);
    for (const value of params.values()) expect(value).toMatch(/^[a-z0-9_-]+$/);
  });
});
