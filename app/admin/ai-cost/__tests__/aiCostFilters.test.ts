/**
 * @jest-environment node
 *
 * The AI cost page's ONE URL spec and its report request (Money MK-3b,
 * SA-Q-MK3-2, T-8). Moved here and retargeted from the retired Summary &
 * checks spec's tests (`costsFilters.test.ts`, SA-CR-MK3B F-2): the parse of
 * `tab`, the window and the business (U-4: anything invalid is ignored), the
 * projection (U-3: defaults omitted, spec order, `tab` first), and the report
 * request `reportSearch` (whole UTC days; a linked window → the covering days;
 * `system` → every business; the default This month, Finance's).
 */

import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { windowEquals } from '@/app/admin/components/layout/adminWindow';
import { utcDateDaysAgo } from '@/app/admin/business-os-llm/costFormat';

import {
  AI_COST_CLEAR_PATCH,
  AI_COST_FILTER_SPEC,
  aiCostCanClear,
  reportAccountOf,
  reportDates,
  reportSearch,
  type AiCostFilters,
} from '../aiCostFilters';

const A = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-12T15:00:00.000Z');

/** The hook's getter: the canonical key, else an old name mapped to it (U-9). */
function parseField<K extends keyof AiCostFilters>(key: K, query: string): AiCostFilters[K] | undefined {
  const field = AI_COST_FILTER_SPEC[key] as AdminFilterField<AiCostFilters[K]>;
  const params = new URLSearchParams(query);
  return field.parse((name) => {
    const value = params.get(name);
    if (value) return value;
    for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
      if (target === name && params.get(legacy)) return params.get(legacy);
    }
    return null;
  });
}

const DEFAULTS = Object.fromEntries(
  Object.entries(AI_COST_FILTER_SPEC).map(([key, field]) => [key, field.defaultValue])
) as unknown as AiCostFilters;

/** The same projection the hook writes: spec order, defaults omitted. */
function project(filters: AiCostFilters): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(AI_COST_FILTER_SPEC) as (keyof AiCostFilters)[]) {
    const field = AI_COST_FILTER_SPEC[key] as AdminFilterField<AiCostFilters[typeof key]>;
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
  it('tab first, then the window, the business and the Calls keys', () => {
    const keys = Object.values(AI_COST_FILTER_SPEC).flatMap((field) => [...field.keys]);
    expect(keys.slice(0, 5)).toEqual(['tab', 'scope', 'range', 'from', 'to']);
    expect(keys).toContain('account');
    expect(keys).toContain('group_by');
  });

  it('defaults: Summary & checks, This month, every business', () => {
    expect(DEFAULTS.tab).toBe('checks');
    expect(DEFAULTS.window).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(DEFAULTS.account).toBe('');
  });

  it('the window field keeps windowEquals and the window keys, and reads the old dateFrom / dateTo (U-9)', () => {
    expect(AI_COST_FILTER_SPEC.window.equals).toBe(windowEquals);
    expect(AI_COST_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
    expect(AI_COST_FILTER_SPEC.window.aliases).toEqual({ dateFrom: 'from', dateTo: 'to' });
    expect(AI_COST_FILTER_SPEC.account.aliases).toEqual({ user: 'account' });
  });
});

describe('parse (U-4: anything invalid is ignored)', () => {
  it('tab: checks or calls', () => {
    expect(parseField('tab', 'tab=calls')).toBe('calls');
    expect(parseField('tab', 'tab=checks')).toBe('checks');
    expect(parseField('tab', 'tab=costs')).toBeUndefined();
  });

  it('window: the standard presets, 90 days, a two-sided custom window and a linked pair of instants', () => {
    expect(parseField('window', 'range=today')).toEqual({ kind: 'preset', preset: 'today' });
    expect(parseField('window', 'range=7d')).toEqual({ kind: 'preset', preset: '7d' });
    expect(parseField('window', 'range=this_month')).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(parseField('window', 'range=90d')).toEqual({ kind: 'extra', extra: '90d' });
    expect(parseField('window', 'range=custom&from=2026-07-01&to=2026-07-31')).toEqual({ kind: 'custom', from: '2026-07-01', to: '2026-07-31' });
    expect(parseField('window', 'dateFrom=2026-10-01T10:00:00.000Z&dateTo=2026-10-02T10:00:00.000Z')).toEqual({
      kind: 'linked',
      from: '2026-10-01T10:00:00.000Z',
      to: '2026-10-02T10:00:00.000Z',
    });
  });

  it.each([
    ['an extra another page owns', 'range=48h'],
    ['24 hours (SA-Q-MK3-3: gone)', 'range=24h'],
    ['yesterday (an Activity extra)', 'range=yesterday'],
    ['since_start (Finance DF-6 only)', 'range=since_start'],
    ['a minute bound (the route refuses it)', 'range=custom&from=2026-10-01T10:00&to=2026-10-02'],
    ['a one-sided custom window (to only)', 'to=2026-10-01'],
    ['a one-sided custom window (from only)', 'from=2026-10-01'],
    ['from after to', 'from=2026-10-05&to=2026-10-01'],
    ['not a date', 'from=yesterday&to=today'],
  ])('window ignores %s', (_name, query) => {
    expect(parseField('window', query)).toBeUndefined();
  });

  it('account: a UUID, or `system` (a Calls drill value); the old `user` key too', () => {
    expect(parseField('account', `account=${A}`)).toBe(A);
    expect(parseField('account', `user=${A}`)).toBe(A);
    expect(parseField('account', 'account=system')).toBe('system');
    expect(parseField('account', 'account=not-a-uuid')).toBeUndefined();
  });
});

describe('the projection (U-3: defaults omitted, spec order)', () => {
  it('the defaults project to nothing', () => {
    expect(project(DEFAULTS)).toBe('');
  });

  it('tab first, then the window, then the business', () => {
    expect(project({ ...DEFAULTS, tab: 'calls', window: { kind: 'extra', extra: '90d' }, account: A })).toBe(
      `tab=calls&range=90d&account=${A}`
    );
    expect(project({ ...DEFAULTS, window: { kind: 'custom', from: '2026-07-01', to: '2026-07-31' } })).toBe(
      'range=custom&from=2026-07-01&to=2026-07-31'
    );
  });
});

describe('Clear keeps the tab', () => {
  it('the clear patch names every filter but the tab, and a cleared view cannot clear', () => {
    expect(Object.keys(AI_COST_CLEAR_PATCH)).not.toContain('tab');
    expect(aiCostCanClear({ ...DEFAULTS, tab: 'calls' })).toBe(false);
    expect(aiCostCanClear({ ...DEFAULTS, ...AI_COST_CLEAR_PATCH, tab: 'calls' } as AiCostFilters)).toBe(false);
    expect(aiCostCanClear({ ...DEFAULTS, account: A })).toBe(true);
    expect(aiCostCanClear({ ...DEFAULTS, scope: 'all' })).toBe(true);
  });
});

describe('the report request (reportSearch)', () => {
  // Money MK-2 (SA-7, ruled): the default is This month, the first UTC day of the month to today.
  it('the default is This month: the first UTC day of the month to today, no accountId', () => {
    const search = reportSearch(DEFAULTS.window, '', NOW);
    expect([...new URLSearchParams(search).keys()]).toEqual(['from', 'to']);
    expect(Object.fromEntries(new URLSearchParams(search))).toEqual({ from: '2026-10-01', to: utcDateDaysAgo(0, NOW) });
    expect(span(search)).toBe(11);
  });

  it('30 days spans 29 days; 7 days and 90 days span 6 and 89, ending today (UTC)', () => {
    expect(Object.fromEntries(new URLSearchParams(reportSearch({ kind: 'preset', preset: '30d' }, '', NOW)))).toEqual({
      from: utcDateDaysAgo(29, NOW),
      to: utcDateDaysAgo(0, NOW),
    });
    expect(span(reportSearch({ kind: 'preset', preset: '7d' }, '', NOW))).toBe(6);
    const ninety = reportSearch({ kind: 'extra', extra: '90d' }, '', NOW);
    expect(span(ninety)).toBe(89);
    expect(new URLSearchParams(ninety).get('to')).toBe('2026-10-12');
  });

  it('a custom window is sent as typed, and a business as accountId', () => {
    expect(reportSearch({ kind: 'custom', from: '2026-07-01', to: '2026-07-31' }, A, NOW)).toBe(`from=2026-07-01&to=2026-07-31&accountId=${A}`);
  });

  it('SA-Q-MK3-3: a linked window becomes the whole UTC days that cover it, and says so', () => {
    const linked = { kind: 'linked' as const, from: '2026-10-10T22:30:00.000Z', to: '2026-10-11T08:00:00.000Z' };
    expect(reportSearch(linked, '', NOW)).toBe('from=2026-10-10&to=2026-10-11');
    expect(reportDates(linked, NOW).covering).toBe(true);
    expect(reportDates({ kind: 'preset', preset: '7d' }, NOW).covering).toBe(false);
  });

  it('SA-Q-MK3-4: `system` reads every business; only a UUID is sent', () => {
    expect(reportAccountOf('system')).toBeNull();
    expect(reportAccountOf(A)).toBe(A);
    expect(reportSearch(DEFAULTS.window, 'system', NOW)).toBe(`from=2026-10-01&to=${utcDateDaysAgo(0, NOW)}`);
  });
});
