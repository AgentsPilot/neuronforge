/**
 * @jest-environment node
 *
 * The Costs & credits tab's URL contract (Admin Layout Standard L-9a, workplan
 * §2.4, §5.6 U-1 to U-10): each key's parse, invalid values ignored (U-4),
 * linked and one-sided windows ignored (the route takes two whole dates), the
 * projection's order with defaults omitted (U-3), and the route's query
 * unchanged for the default view (SA N-4: parity with the tab's old
 * `presetQuery(30)`).
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { windowEquals } from '@/app/admin/components/layout/adminWindow';
import { utcDateDaysAgo } from '../costFormat';
import {
  COSTS_DEFAULT_WINDOW,
  COSTS_FILTER_SPEC,
  COSTS_WINDOW_EXTRAS,
  costsRouteSearch,
  type CostsFilters,
} from '../costsFilters';
import { ACTIVITY_FILTER_SPEC } from '../activityFilters';

const A = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 86_400_000;

const getter = (query: string) => {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) || null;
};

function parseField<K extends keyof CostsFilters>(key: K, query: string): CostsFilters[K] | undefined {
  const field = COSTS_FILTER_SPEC[key] as AdminFilterField<CostsFilters[K]>;
  return field.parse(getter(query));
}

const DEFAULTS: CostsFilters = { window: COSTS_DEFAULT_WINDOW, account: '' };

/** The same projection the hook writes: spec order, defaults omitted. */
function project(filters: CostsFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(COSTS_FILTER_SPEC) as (keyof CostsFilters)[]) {
    const field = COSTS_FILTER_SPEC[key] as AdminFilterField<CostsFilters[typeof key]>;
    const equals = field.equals ?? Object.is;
    if (equals(filters[key], field.defaultValue)) continue;
    for (const [name, value] of Object.entries(field.serialise(filters[key]))) params.append(name, value);
  }
  return params.toString();
}

const span = (search: string) => {
  const params = new URLSearchParams(search);
  return (Date.parse(`${params.get('to')}T00:00:00Z`) - Date.parse(`${params.get('from')}T00:00:00Z`)) / DAY_MS;
};

describe('the spec', () => {
  it('owns exactly these keys, in this order; tab is not among them', () => {
    const keys = Object.values(COSTS_FILTER_SPEC).flatMap((field) => [...field.keys]);
    expect(keys).toEqual(['range', 'from', 'to', 'account']);
    expect(keys).not.toContain('tab');
  });

  it('has no aliases (Costs had no URL before)', () => {
    for (const field of Object.values(COSTS_FILTER_SPEC)) {
      expect(Object.keys(field.aliases ?? {})).toEqual([]);
    }
  });

  // Money MK-2 (SA-7, ruled): the default moved from 30 days to This month.
  it('defaults to This month, every business', () => {
    expect(COSTS_DEFAULT_WINDOW).toEqual({ kind: 'preset', preset: 'this_month' });
    const defaults = Object.fromEntries(Object.entries(COSTS_FILTER_SPEC).map(([key, field]) => [key, field.defaultValue]));
    expect(defaults).toEqual(DEFAULTS);
  });

  it('lists 90 days after the standard five (D-2 (b))', () => {
    expect(COSTS_WINDOW_EXTRAS).toEqual(['90d']);
  });

  it('SA M-1: the window field keeps windowEquals and the window keys (the shared wrapper, SA Q-3)', () => {
    expect(COSTS_FILTER_SPEC.window.equals).toBe(windowEquals);
    expect(COSTS_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
    // One wrapper for both tabs: the same rule, different defaults.
    expect(ACTIVITY_FILTER_SPEC.window.equals).toBe(windowEquals);
    expect(ACTIVITY_FILTER_SPEC.window.parse(getter('range=custom&from=2026-10-01T10:00&to=2026-10-02'))).toBeUndefined();
  });
});

describe('parse (U-4: anything invalid is ignored)', () => {
  it('window: the standard presets, 90 days and a two-sided custom window', () => {
    expect(parseField('window', 'range=today')).toEqual({ kind: 'preset', preset: 'today' });
    expect(parseField('window', 'range=7d')).toEqual({ kind: 'preset', preset: '7d' });
    expect(parseField('window', 'range=this_month')).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(parseField('window', 'range=90d')).toEqual({ kind: 'extra', extra: '90d' });
    expect(parseField('window', 'range=custom&from=2026-07-01&to=2026-07-31')).toEqual({
      kind: 'custom',
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it.each([
    ['an extra another page owns', 'range=48h'],
    ['24 hours (not this tab)', 'range=24h'],
    ['yesterday (an Activity extra, not a Costs one)', 'range=yesterday'],
    ['last month (an Activity extra)', 'range=last_month'],
    ['a minute bound (linked)', 'range=custom&from=2026-10-01T10:00&to=2026-10-02'],
    ['an instant bound (linked)', 'from=2026-10-01T10:00:00Z&to=2026-10-02T10:00:00Z'],
    ['a one-sided custom window (to only)', 'to=2026-10-01'],
    ['a one-sided custom window (from only)', 'from=2026-10-01'],
    ['from after to', 'from=2026-10-05&to=2026-10-01'],
    ['not a date', 'from=yesterday&to=today'],
  ])('window ignores %s', (_name, query) => {
    expect(parseField('window', query)).toBeUndefined();
  });

  it('account: a UUID only', () => {
    expect(parseField('account', `account=${A}`)).toBe(A);
    expect(parseField('account', 'account=not-a-uuid')).toBeUndefined();
    expect(parseField('account', 'account=')).toBeUndefined();
  });
});

describe('the projection (U-3: defaults omitted, spec order)', () => {
  it('the defaults project to nothing', () => {
    expect(project(DEFAULTS)).toBe('');
  });

  it('window first, then account', () => {
    expect(project({ window: { kind: 'extra', extra: '90d' }, account: A })).toBe(`range=90d&account=${A}`);
    expect(project({ window: { kind: 'custom', from: '2026-07-01', to: '2026-07-31' }, account: '' })).toBe(
      'range=custom&from=2026-07-01&to=2026-07-31',
    );
    expect(project({ window: COSTS_DEFAULT_WINDOW, account: A })).toBe(`account=${A}`);
  });
});

describe('the route query (unchanged for the same filter values)', () => {
  const now = new Date('2026-10-12T15:00:00.000Z');

  // Money MK-2 (SA-7, SA-PIN-MK2, ruled): was "equals presetQuery(30)", today minus 29 to today.
  it('the default is This month: the first UTC day of the month to today, no accountId', () => {
    const search = costsRouteSearch(DEFAULTS, now);
    expect([...new URLSearchParams(search).keys()]).toEqual(['from', 'to']);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({
      from: '2026-10-01',
      to: utcDateDaysAgo(0, now),
    });
    expect(span(search)).toBe(11);
  });

  it('30 days is still offered and still spans 29 days (no longer the default)', () => {
    const search = costsRouteSearch({ window: { kind: 'preset', preset: '30d' }, account: '' }, now);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({ from: utcDateDaysAgo(29, now), to: utcDateDaysAgo(0, now) });
  });

  it('7 days and 90 days span 6 and 89 days, ending today (UTC)', () => {
    const seven = costsRouteSearch({ window: { kind: 'preset', preset: '7d' }, account: '' }, now);
    const ninety = costsRouteSearch({ window: { kind: 'extra', extra: '90d' }, account: '' }, now);
    expect(span(seven)).toBe(6);
    expect(span(ninety)).toBe(89);
    expect(new URLSearchParams(ninety).get('from')).toBe(utcDateDaysAgo(89, now));
    expect(new URLSearchParams(ninety).get('to')).toBe('2026-10-12');
  });

  it('a custom window is sent as typed, and the account as accountId', () => {
    const search = costsRouteSearch({ window: { kind: 'custom', from: '2026-07-01', to: '2026-07-31' }, account: A }, now);
    expect(search).toBe(`from=2026-07-01&to=2026-07-31&accountId=${A}`);
  });
});

// Finance DF-6 (E-76, U-4): Finance's own "Since it started" is not an extra of this page.
describe('DF-6: range=since_start is ignored here', () => {
  it('parses to undefined, so the page keeps its default window', () => {
    expect(COSTS_WINDOW_EXTRAS).not.toContain('since_start');
    expect(parseField('window', 'range=since_start')).toBeUndefined();
  });
});
