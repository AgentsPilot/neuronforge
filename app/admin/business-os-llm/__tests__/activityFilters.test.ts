/**
 * @jest-environment node
 *
 * The Activity tab's URL contract (Admin Layout Standard L-8a, workplan §2.4,
 * §5.6 U-1 to U-10): each key's parse, invalid values ignored (U-4), linked and
 * one-sided windows ignored (the route takes two whole dates), the projection's
 * order with defaults omitted (U-3), and the route's query unchanged for the
 * default view.
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { windowEquals } from '@/app/admin/components/layout/adminWindow';
import { resolvePreset } from '../activityPresets';
import {
  ACTIVITY_DEFAULT_WINDOW,
  ACTIVITY_FILTER_SPEC,
  ACTIVITY_WINDOW_EXTRAS,
  activityRouteSearch,
  type ActivityFilters,
} from '../activityFilters';

const A = '11111111-1111-4111-8111-111111111111';

const getter = (query: string) => {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) || null;
};

function parseField<K extends keyof ActivityFilters>(key: K, query: string): ActivityFilters[K] | undefined {
  const field = ACTIVITY_FILTER_SPEC[key] as AdminFilterField<ActivityFilters[K]>;
  return field.parse(getter(query));
}

const DEFAULTS: ActivityFilters = {
  window: ACTIVITY_DEFAULT_WINDOW,
  account: '',
  area: '',
  outcome: '',
  trigger: '',
  minCost: '',
  sort: 'time',
};

/** The same projection the hook writes: spec order, defaults omitted. */
function project(filters: ActivityFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(ACTIVITY_FILTER_SPEC) as (keyof ActivityFilters)[]) {
    const field = ACTIVITY_FILTER_SPEC[key] as AdminFilterField<ActivityFilters[typeof key]>;
    const equals = field.equals ?? Object.is;
    if (equals(filters[key], field.defaultValue)) continue;
    for (const [name, value] of Object.entries(field.serialise(filters[key]))) params.append(name, value);
  }
  return params.toString();
}

describe('the spec', () => {
  it('owns exactly these keys, in this order; tab and actionId are not among them', () => {
    const keys = Object.values(ACTIVITY_FILTER_SPEC).flatMap((field) => [...field.keys]);
    expect(keys).toEqual(['range', 'from', 'to', 'account', 'area', 'outcome', 'trigger', 'min_cost', 'sort']);
    expect(keys).not.toContain('tab');
    expect(keys).not.toContain('actionId');
  });

  it('has no aliases (Activity had no URL before)', () => {
    for (const field of Object.values(ACTIVITY_FILTER_SPEC)) {
      expect(Object.keys(field.aliases ?? {})).toEqual([]);
    }
  });

  it('defaults to This month, newest first, every filter off', () => {
    const defaults = Object.fromEntries(
      Object.entries(ACTIVITY_FILTER_SPEC).map(([key, field]) => [key, field.defaultValue]),
    );
    expect(defaults).toEqual(DEFAULTS);
  });

  it('lists the four extras after the standard five', () => {
    expect(ACTIVITY_WINDOW_EXTRAS).toEqual(['yesterday', 'this_week', 'last_week', 'last_month']);
  });

  it('SA M-1: the window field keeps windowEquals, so a re-parse keeps the filters identity', () => {
    expect(ACTIVITY_FILTER_SPEC.window.equals).toBe(windowEquals);
    expect(ACTIVITY_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
  });
});

describe('parse (U-4: anything invalid is ignored)', () => {
  it('window: presets, the four extras and a two-sided custom window', () => {
    expect(parseField('window', 'range=7d')).toEqual({ kind: 'preset', preset: '7d' });
    expect(parseField('window', 'range=yesterday')).toEqual({ kind: 'extra', extra: 'yesterday' });
    expect(parseField('window', 'range=last_month')).toEqual({ kind: 'extra', extra: 'last_month' });
    expect(parseField('window', 'range=custom&from=2026-09-01&to=2026-09-30')).toEqual({
      kind: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it.each([
    ['an extra another page owns', 'range=48h'],
    ['24 hours (not this tab)', 'range=24h'],
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
  });

  it('area: lower snake case, 1 to 64 characters', () => {
    expect(parseField('area', 'area=website')).toBe('website');
    expect(parseField('area', 'area=lead_scoring')).toBe('lead_scoring');
    expect(parseField('area', 'area=Website')).toBeUndefined();
    expect(parseField('area', `area=${'a'.repeat(65)}`)).toBeUndefined();
    expect(parseField('area', 'area=a%20b')).toBeUndefined();
  });

  it('outcome, trigger and sort: their fixed values only', () => {
    expect(parseField('outcome', 'outcome=failed')).toBe('failed');
    expect(parseField('outcome', 'outcome=maybe')).toBeUndefined();
    expect(parseField('trigger', 'trigger=scheduled')).toBe('scheduled');
    expect(parseField('trigger', 'trigger=cron')).toBeUndefined();
    expect(parseField('sort', 'sort=cost')).toBe('cost');
    expect(parseField('sort', 'sort=price')).toBeUndefined();
  });

  it("min_cost: the route's format rule (digits, an optional decimal part)", () => {
    expect(parseField('minCost', 'min_cost=0.01')).toBe('0.01');
    expect(parseField('minCost', 'min_cost=5')).toBe('5');
    expect(parseField('minCost', 'min_cost=abc')).toBeUndefined();
    expect(parseField('minCost', 'min_cost=-1')).toBeUndefined();
    expect(parseField('minCost', 'min_cost=.5')).toBeUndefined();
  });
});

describe('the projection (U-3)', () => {
  it('omits every default', () => {
    expect(project(DEFAULTS)).toBe('');
  });

  it('writes the set filters in spec order', () => {
    expect(
      project({
        window: { kind: 'extra', extra: 'yesterday' },
        account: A,
        area: 'website',
        outcome: 'failed',
        trigger: 'owner',
        minCost: '0.01',
        sort: 'cost',
      }),
    ).toBe(`range=yesterday&account=${A}&area=website&outcome=failed&trigger=owner&min_cost=0.01&sort=cost`);
    expect(project({ ...DEFAULTS, window: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } })).toBe(
      'range=custom&from=2026-09-01&to=2026-09-30',
    );
  });
});

describe('activityRouteSearch', () => {
  const now = new Date('2026-10-14T09:00:00.000Z');

  it("gives exactly today's parameter set for the default view: from, to, sort", () => {
    const params = new URLSearchParams(activityRouteSearch(DEFAULTS, now));
    expect([...params.keys()]).toEqual(['from', 'to', 'sort']);
    expect(params.get('from')).toBe(resolvePreset('this_month', now).from);
    expect(params.get('to')).toBe(resolvePreset('this_month', now).to);
    expect(params.get('sort')).toBe('time');
  });

  it('adds only the set filters, under the route names, in the order the tab always sent them', () => {
    const search = activityRouteSearch(
      {
        window: { kind: 'extra', extra: 'last_week' },
        account: A,
        area: 'website',
        outcome: 'failed',
        trigger: 'owner',
        minCost: '0.01',
        sort: 'cost',
      },
      now,
    );
    const lastWeek = resolvePreset('last_week', now);
    expect(search).toBe(
      `from=${lastWeek.from}&to=${lastWeek.to}&sort=cost&accountId=${A}&area=website&outcome=failed&trigger=owner&minCostUsd=0.01`,
    );
    const onlyTrigger = new URLSearchParams(activityRouteSearch({ ...DEFAULTS, trigger: 'scheduled' }, now));
    expect([...onlyTrigger.keys()]).toEqual(['from', 'to', 'sort', 'trigger']);
  });

  it('sends a custom window as its two dates', () => {
    const params = new URLSearchParams(
      activityRouteSearch({ ...DEFAULTS, window: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } }, now),
    );
    expect(params.get('from')).toBe('2026-09-01');
    expect(params.get('to')).toBe('2026-09-30');
  });
});
