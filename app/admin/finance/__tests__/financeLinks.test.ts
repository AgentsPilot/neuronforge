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
// Money MK-3b (SA-CR-MK3B F-2, ruled): the AI cost page's ONE spec (the retired Summary & checks spec is gone).
import { AI_COST_FILTER_SPEC } from '@/app/admin/ai-cost/aiCostFilters';
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
function windowFor(preset: Exclude<FinanceWindowChoice, 'since_start'>): FinanceLinkWindow {
  if (preset === 'custom') return { preset, from: '2026-09-20', to: '2026-10-03' };
  return { preset, ...resolveAdminWindow(preset, NOW) };
}

const PRESETS: Exclude<FinanceWindowChoice, 'since_start'>[] = ['today', '7d', '30d', 'this_month', 'custom'];

/** The hook's getter: a canonical key's non-empty value, else null. */
const paramsOf = (href: string) => new URL(href, 'http://admin.test').searchParams;
const getter = (params: URLSearchParams) => (key: string) => params.get(key) || null;

function datesOfParsed(value: ReturnType<typeof ACTIVITY_FILTER_SPEC.window.parse>) {
  expect(value).toBeDefined();
  const resolved = resolveWindow(value!, NOW);
  expect(resolved.kind).toBe('dates');
  return resolved.kind === 'dates' ? { from: resolved.from, to: resolved.to } : null;
}

// Money M-5 (R-3): Costs & credits became its own page, Charge checks, so
// each link names its target path. Money MK-3a (ruled): Charge checks is the
// AI cost page's Summary & checks tab, so that link carries `tab=checks` too.
describe.each([
  ['Activity', activityHref, ACTIVITY_FILTER_SPEC, '/admin/business-os-llm?', 'activity'],
  ['AI cost, Summary & checks', costsHref, AI_COST_FILTER_SPEC, '/admin/ai-cost?', 'checks'],
] as const)('%s link', (_name, hrefOf, spec, prefix, tab) => {
  it.each(PRESETS)('window %s: the target parses the same dates and the account; nothing else is sent', (preset) => {
    const window = windowFor(preset);
    const href = hrefOf(A, window);
    expect(href.startsWith(prefix)).toBe(true);
    const params = paramsOf(href);
    expect(params.get('tab')).toBe(tab);
    const get = getter(params);
    expect(spec.account.parse(get)).toBe(A);
    const parsed = spec.window.parse(get);
    expect(datesOfParsed(parsed)).toEqual({ from: window.from, to: window.to });
    // A preset stays a preset (same rule, same dates); custom stays custom.
    expect(parsed?.kind).toBe(preset === 'custom' ? 'custom' : 'preset');
    // Every key is one the target owns (or Activity's page tab): none is ignored.
    const owned = new Set([...(tab === null ? [] : ['tab']), ...spec.window.keys, ...spec.account.keys]);
    for (const key of params.keys()) expect({ key, owned: owned.has(key) }).toEqual({ key, owned: true });
  });
});

// Money MK-3b (ruled): AI calls & usage is the AI cost page's Calls tab; its 7d and 30d are whole UTC days
// now (SA-Q-MK3-3), so the link carries Finance's preset as it is, as the Summary & checks link does.
describe('AI cost Calls link (SA-W56; MK-3b)', () => {
  it.each(PRESETS)('window %s: the target parses the same dates and the account', (preset) => {
    const window = windowFor(preset);
    const href = analyticsHref(A, window);
    expect(href.startsWith('/admin/ai-cost?tab=calls&')).toBe(true);
    const params = paramsOf(href);
    const get = getter(params);
    expect(ANALYTICS_FILTER_SPEC.account.parse(get)).toBe(A);
    // `scope` left out: its default is Business OS.
    expect(params.has('scope')).toBe(false);
    expect(ANALYTICS_FILTER_SPEC.scope.parse(get)).toBeUndefined();
    expect(ANALYTICS_FILTER_SPEC.scope.defaultValue).toBe('bos');
    const parsed = ANALYTICS_FILTER_SPEC.window.parse(get);
    expect(datesOfParsed(parsed)).toEqual({ from: window.from, to: window.to });
    // MK-3b: every preset stays a preset (whole UTC days on the Calls tab too); custom stays custom.
    if (preset === 'custom') expect(parsed).toEqual({ kind: 'custom', from: window.from, to: window.to });
    else expect(parsed).toEqual({ kind: 'preset', preset });
    const owned = new Set(['tab', ...ANALYTICS_FILTER_SPEC.window.keys, ...ANALYTICS_FILTER_SPEC.account.keys]);
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
// Finance F-4: the link keeps the old keys (SA-W9) and is read back through this page's own spec.
import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';
import { FINANCE_FILTER_SPEC } from '../financeFilters';

/** The hook's U-9 getter: the canonical key's non-empty value, else the first non-empty alias. */
const aliasGetter = (field: AdminFilterField<unknown>, params: URLSearchParams) => (key: string) => {
  const canonical = params.get(key);
  if (canonical) return canonical;
  for (const [legacy, target] of Object.entries(field.aliases ?? {})) {
    if (target === key && params.get(legacy)) return params.get(legacy);
  }
  return null;
};

describe('slice 6a: accountViewHref, an Accounts row → the one-account view on the same window (AC-144)', () => {
  it.each(PRESETS)('%s: parsed back through FINANCE_FILTER_SPEC (aliases) gives exactly the window and the id, and no tab key', (preset) => {
    const window = windowFor(preset);
    const href = accountViewHref(A, window);
    expect(href.startsWith('/admin/finance?')).toBe(true);
    const params = paramsOf(href);
    const S = FINANCE_FILTER_SPEC;
    expect(S.window.parse(aliasGetter(S.window as AdminFilterField<unknown>, params))).toEqual(
      preset === 'custom' ? { kind: 'custom', from: window.from, to: window.to } : { kind: 'preset', preset }
    );
    expect(S.account.parse(aliasGetter(S.account as AdminFilterField<unknown>, params))).toBe(A);
    for (const key of ['tab', 'sort', 'group', 'show'] as const) {
      expect({ key, parsed: S[key].parse(aliasGetter(S[key] as AdminFilterField<unknown>, params)) }).toEqual({ key, parsed: undefined });
    }
    expect([...params.keys()]).toEqual(preset === 'custom' ? ['preset', 'from', 'to', 'accountId'] : ['preset', 'accountId']);
    for (const value of params.values()) expect(value).toMatch(/^[a-z0-9_-]+$/);
  });
});

// Money M-4 (SA-W99, T8-B): `leakCheckHref` and its cases were removed by Money MK-3b (SA-CR-MK3A DV-5):
// it had no caller since MK-3a, whose Section 3 line links through `aiCostRecordedHref` (tested below).

// ── Finance F-5 (SA-W7 (a), F5-R1): the "Charged AI cost" tile's link ──────
import { k1AnalyticsHref } from '../financeLinks';

describe('Finance F-5: k1AnalyticsHref, the K-1 tile → AI cost & usage on the tile’s own period (F5-R1)', () => {
  it('all businesses: This month only, no account; the Analytics spec parses This month back', () => {
    const href = k1AnalyticsHref(null);
    // Money MK-3b (ruled): the AI cost page's Calls tab.
    expect(href).toBe('/admin/ai-cost?tab=calls&range=this_month');
    const get = getter(paramsOf(href));
    expect(ANALYTICS_FILTER_SPEC.window.parse(get)).toEqual({ kind: 'preset', preset: 'this_month' });
    expect(ANALYTICS_FILTER_SPEC.account.parse(get)).toBeUndefined();
  });

  it('a business picked: This month and the account, in the target’s own keys', () => {
    const href = k1AnalyticsHref(A);
    expect(href).toBe(`/admin/ai-cost?tab=calls&range=this_month&account=${A}`);
    const get = getter(paramsOf(href));
    expect(ANALYTICS_FILTER_SPEC.account.parse(get)).toBe(A);
    expect(ANALYTICS_FILTER_SPEC.window.parse(get)).toEqual({ kind: 'preset', preset: 'this_month' });
  });

  it('equals Section 3’s link when the page window is This month', () => {
    const window = windowFor('this_month');
    expect(k1AnalyticsHref(A)).toBe(section3AnalyticsHref(A, window));
    expect(k1AnalyticsHref(null)).toBe(section3AnalyticsHref(null, window));
  });

  it.each(['today', '7d', '30d', 'custom'] as const)('with a %s page window it still carries This month, never the window', (preset) => {
    const window = windowFor(preset);
    const params = paramsOf(k1AnalyticsHref(A));
    expect(params.get('range')).toBe('this_month');
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
    expect(k1AnalyticsHref(A)).not.toBe(section3AnalyticsHref(A, window));
  });
});

// ── Money M-5 (AC-193): no in-app link to the old Costs tab is left ──────────
import * as fs from 'fs';
import * as path from 'path';

describe('Money M-5: financeLinks.ts sends nothing to the old Costs & credits tab (AC-193)', () => {
  // Money MK-3a (ruled): the Costs links point at the AI cost page's Summary & checks tab, never at
  // the old Charge checks address (which only redirects now, SA-6).
  it('no link built here names tab=costs or the old Charge checks address; the Costs links name tab=checks', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/admin/finance/financeLinks.ts'), 'utf8');
    expect(source).not.toMatch(/'costs'/);
    expect(source).not.toContain('tab=costs');
    expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toContain('/admin/finance/charges');
    for (const preset of PRESETS) expect(paramsOf(costsHref(A, windowFor(preset))).get('tab')).toBe('checks');
    // MK-3b: nor the old AI calls & usage address; its links name tab=calls; the unused Leak link is gone.
    expect(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toContain("'/admin/analytics");
    for (const preset of PRESETS) expect(paramsOf(analyticsHref(A, windowFor(preset))).get('tab')).toBe('calls');
    expect(source).not.toMatch(/export function leakCheckHref/);
  });
});

// ── DF-6 (DF6-FR-10, E-77, SA-Q95, AC-269): links out never carry since_start ──
import { accountViewHref as accountViewHrefDf6, k1AnalyticsHref as k1Df6 } from '../financeLinks';

describe('DF-6: since-start links out', () => {
  // 2026-09-29 to 2026-12-29 is 92 inclusive days; to 2026-12-30 is 93.
  const FITS: FinanceLinkWindow = { preset: 'since_start', from: '2026-09-29', to: '2026-12-29' };
  const TOO_LONG: FinanceLinkWindow = { preset: 'since_start', from: '2026-09-29', to: '2026-12-30' };
  const HREFS = (window: FinanceLinkWindow) => [activityHref(A, window), costsHref(A, window), analyticsHref(A, window), section3AnalyticsHref(A, window)];

  it.each([
    ['Activity', activityHref, ACTIVITY_FILTER_SPEC],
    ['Charge checks', costsHref, AI_COST_FILTER_SPEC],
    ['AI cost Calls', analyticsHref, ANALYTICS_FILTER_SPEC],
  ] as const)('%s, at most 92 inclusive days: range=custom with the payload dates and the account, parsed back by the target', (_name, hrefOf, spec) => {
    const params = paramsOf(hrefOf(A, FITS));
    expect(params.get('range')).toBe('custom');
    expect([params.get('from'), params.get('to')]).toEqual(['2026-09-29', '2026-12-29']);
    const get = getter(params);
    expect(spec.account.parse(get)).toBe(A);
    expect(spec.window.parse(get)).toEqual({ kind: 'custom', from: '2026-09-29', to: '2026-12-29' });
  });

  it.each([
    ['Activity', activityHref, ACTIVITY_FILTER_SPEC],
    ['Charge checks', costsHref, AI_COST_FILTER_SPEC],
    ['AI cost Calls', analyticsHref, ANALYTICS_FILTER_SPEC],
  ] as const)('%s, 93 days or more: the account only and no window, so the target opens on its default', (_name, hrefOf, spec) => {
    const params = paramsOf(hrefOf(A, TOO_LONG));
    for (const key of ['range', 'from', 'to']) expect(params.get(key)).toBeNull();
    expect(spec.account.parse(getter(params))).toBe(A);
    expect(spec.window.parse(getter(params))).toBeUndefined();
  });

  it('E-77: no link ever carries since_start, at either length', () => {
    for (const href of [...HREFS(FITS), ...HREFS(TOO_LONG)]) expect(href).not.toContain('since_start');
  });

  // Money MK-3b (ruled): K-1 goes to the AI cost Calls tab; the Leak check link is removed (DV-5).
  it('Businesses and K-1 links are unchanged by since_start', () => {
    expect(businessesHref(A)).toBe(`/admin/users?status=all&account=${A}`);
    expect(k1Df6(A)).toBe(`/admin/ai-cost?tab=calls&range=this_month&account=${A}`);
  });

  it('SA-W-DF6-7 (recorded, unreachable): accountViewHref would write a request the finance route accepts', () => {
    expect(accountViewHrefDf6(A, FITS)).toBe(`/admin/finance?preset=since_start&accountId=${A}`);
  });
});

// ── Money MK-3a (C-7): Section 3's one line → the AI cost page's recorded block and Leak check ──
import { aiCostRecordedHref } from '../financeLinks';

describe('Money MK-3a: aiCostRecordedHref (C-7)', () => {
  it.each(PRESETS)('window %s with a business: Summary & checks, the same dates, the account, the Leak check anchor', (preset) => {
    const window = windowFor(preset);
    const href = aiCostRecordedHref(A, window);
    expect(href.startsWith('/admin/ai-cost?tab=checks&')).toBe(true);
    expect(href.endsWith('#costs-leak')).toBe(true);
    const params = paramsOf(href);
    const get = getter(params);
    expect(AI_COST_FILTER_SPEC.account.parse(get)).toBe(A);
    expect(datesOfParsed(AI_COST_FILTER_SPEC.window.parse(get))).toEqual({ from: window.from, to: window.to });
    // The same keys as the account summary's Costs link.
    expect(href.split('#')[0]).toBe(costsHref(A, window));
  });

  it('no business: the window only', () => {
    const window = windowFor('this_month');
    const params = paramsOf(aiCostRecordedHref(null, window));
    expect(params.has('account')).toBe(false);
    expect([...params.keys()]).toEqual(['tab', 'range']);
  });

  it('a since-start window too long for the target: no window, so the page opens on its default', () => {
    const params = paramsOf(aiCostRecordedHref(A, { preset: 'since_start', from: '2026-09-29', to: '2026-12-30' }));
    for (const key of ['range', 'from', 'to']) expect(params.get(key)).toBeNull();
    expect(params.get('account')).toBe(A);
  });
});
