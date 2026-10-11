/**
 * AI cost & usage's pure filter module (Admin Layout Standard L-2a, workplan
 * §3.5 and §4.1): the validators that mirror the drill-down route, the
 * narrowed window parse (the old `parseLinkedWindow` cases, ported), the
 * request mapping, and the scope / breadcrumb / row-click patches.
 */

import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';
import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

import {
  ANALYTICS_DEFAULT_WINDOW,
  ANALYTICS_FILTER_SPEC,
  analyticsRequestParams,
  drillPatch,
  isAccountValue,
  isAgentValue,
  isDimensionValue,
  isExecutionValue,
  narrowAnalyticsWindow,
  normaliseForScope,
  rowClickPatch,
  scopeSwitchPatch,
  type AnalyticsFilters,
} from '../analyticsFilters';
import type { BreakdownDimension } from '../analyticsTypes';

const UUID = '99999999-9999-4999-8999-999999999999';
const UPPER_UUID = 'ABCDEF12-3456-4789-8ABC-DEF123456789';

const DEFAULTS: AnalyticsFilters = {
  scope: 'bos',
  window: ANALYTICS_DEFAULT_WINDOW,
  account: '',
  category: 'all',
  groupBy: 'provider',
  provider: '',
  model: '',
  activity: '',
  requestType: '',
  feature: '',
  component: '',
  endpoint: '',
  agent: '',
  execution: '',
};

const withFilters = (patch: Partial<AnalyticsFilters>): AnalyticsFilters => ({ ...DEFAULTS, ...patch });

/** A `get` over a plain query string, as the hook hands it to a field (canonical keys only). */
const getter = (query: string) => {
  const params = new URLSearchParams(query);
  return (key: string) => params.get(key) || null;
};

describe('validators mirror the route (§4.1, SA S-2)', () => {
  it('a dimension is 1 to 200 characters with no control character', () => {
    expect(isDimensionValue('a')).toBe(true);
    expect(isDimensionValue('x'.repeat(200))).toBe(true);
    // Real values carry slashes, dots and colons (model ids, endpoint paths).
    expect(isDimensionValue('meta-llama/llama-3.1:70b')).toBe(true);
    expect(isDimensionValue('/api/v2/business-os/chat')).toBe(true);
    expect(isDimensionValue('')).toBe(false);
    expect(isDimensionValue('x'.repeat(201))).toBe(false);
    for (const code of [0, 9, 10, 31, 127]) {
      expect(isDimensionValue(`a${String.fromCharCode(code)}b`)).toBe(false);
    }
    expect(isDimensionValue(`a${String.fromCharCode(32)}b`)).toBe(true);
  });

  it('account: a UUID in either case, or "system"', () => {
    expect(isAccountValue(UUID)).toBe(true);
    expect(isAccountValue(UPPER_UUID)).toBe(true);
    expect(isAccountValue('system')).toBe(true);
    expect(isAccountValue('System')).toBe(false);
    expect(isAccountValue('xyz')).toBe(false);
    expect(isAccountValue(`${UUID}0`)).toBe(false);
  });

  it('agent: a UUID or "no-agent"; execution: a UUID or "single-" plus a UUID', () => {
    expect(isAgentValue(UUID)).toBe(true);
    expect(isAgentValue(UPPER_UUID)).toBe(true);
    expect(isAgentValue('no-agent')).toBe(true);
    expect(isAgentValue('agent-1')).toBe(false);
    expect(isExecutionValue(UUID)).toBe(true);
    expect(isExecutionValue(`single-${UPPER_UUID}`)).toBe(true);
    expect(isExecutionValue('single-')).toBe(false);
    expect(isExecutionValue('execution-1')).toBe(false);
  });

  it('scope, category and group by accept their sets only', () => {
    expect(ANALYTICS_FILTER_SPEC.scope.parse(getter('scope=all'))).toBe('all');
    expect(ANALYTICS_FILTER_SPEC.scope.parse(getter('scope=bos'))).toBe('bos');
    expect(ANALYTICS_FILTER_SPEC.scope.parse(getter('scope=maybe'))).toBeUndefined();
    for (const category of ['creation', 'execution', 'memory', 'system']) {
      expect(ANALYTICS_FILTER_SPEC.category.parse(getter(`category=${category}`))).toBe(category);
    }
    expect(ANALYTICS_FILTER_SPEC.category.parse(getter('category=other'))).toBeUndefined();
    const dims: BreakdownDimension[] = ['provider', 'model', 'activity', 'user', 'agent', 'execution', 'request_type', 'feature', 'component', 'endpoint'];
    for (const dim of dims) expect(ANALYTICS_FILTER_SPEC.groupBy.parse(getter(`group_by=${dim}`))).toBe(dim);
    expect(ANALYTICS_FILTER_SPEC.groupBy.parse(getter('group_by=nope'))).toBeUndefined();
  });

  it('every field reads and writes its canonical key; account also reads the legacy user (U-9)', () => {
    expect(ANALYTICS_FILTER_SPEC.account.keys).toEqual(['account']);
    expect(ANALYTICS_FILTER_SPEC.account.aliases).toEqual({ user: 'account' });
    expect(ANALYTICS_FILTER_SPEC.groupBy.keys).toEqual(['group_by']);
    expect(ANALYTICS_FILTER_SPEC.requestType.keys).toEqual(['request_type']);
    expect(ANALYTICS_FILTER_SPEC.window.keys).toEqual(['range', 'from', 'to']);
    expect(ANALYTICS_FILTER_SPEC.window.aliases).toEqual({ dateFrom: 'from', dateTo: 'to' });
    expect(ANALYTICS_FILTER_SPEC.provider.parse(getter(`provider=${'x'.repeat(201)}`))).toBeUndefined();
    expect(ANALYTICS_FILTER_SPEC.agent.parse(getter('agent=no-agent'))).toBe('no-agent');
    expect(ANALYTICS_FILTER_SPEC.execution.parse(getter('execution=nope'))).toBeUndefined();
  });
});

describe('the narrowed window (SA Q-4; the ported parseLinkedWindow cases)', () => {
  const FROM = '2026-09-25T08:14:00.000Z';
  const TO = '2026-09-26T08:14:00.000Z';
  const parse = (query: string) => ANALYTICS_FILTER_SPEC.window.parse(getter(query));

  it('accepts both bounds as instants with an offset, kept byte for byte', () => {
    expect(parse(`from=${FROM}&to=${TO}`)).toEqual({ kind: 'linked', from: FROM, to: TO });
    expect(parse('from=2026-09-25T08:14:00%2B03:00&to=2026-09-26T08:14:00%2B03:00')).toEqual({
      kind: 'linked',
      from: '2026-09-25T08:14:00+03:00',
      to: '2026-09-26T08:14:00+03:00',
    });
    expect(parse('from=2026-10-11T00:00:00.000Z&to=2026-10-11T23:59:59.999999Z')).toEqual({
      kind: 'linked',
      from: '2026-10-11T00:00:00.000Z',
      to: '2026-10-11T23:59:59.999999Z',
    });
  });

  it.each([
    [`from=${FROM}`],
    [`to=${TO}`],
    ['from=2026-09-25T08:14&to=2026-09-26T08:14'], // the minute form: the route refuses it
    [`from=${TO}&to=${FROM}`], // reversed
    ['from=garbage&to=nonsense'],
    ['from=2026-09-25'], // one-sided whole date
    ['range=custom&to=2026-09-26'],
    [`from=2026-09-25&to=${TO}`], // a date beside an instant
  ])('ignores %s (the default 30 days applies)', (query) => {
    expect(parse(query)).toBeUndefined();
  });

  it('a whole-date pair is now a custom range (was ignored; U-7)', () => {
    expect(parse('from=2026-09-25&to=2026-09-26')).toEqual({ kind: 'custom', from: '2026-09-25', to: '2026-09-26' });
  });

  it('orders bounds by time, not by string (SA S-1)', () => {
    // 10:00+03:00 is 07:00Z: after 08:00Z as text, before it in time.
    expect(parse('from=2026-09-25T10:00:00%2B03:00&to=2026-09-25T08:00:00.000Z')).toEqual({
      kind: 'linked',
      from: '2026-09-25T10:00:00+03:00',
      to: '2026-09-25T08:00:00.000Z',
    });
    // Before it as text, after it in time: reversed, so ignored.
    expect(parse('from=2026-09-25T08:00:00.000Z&to=2026-09-25T10:00:00%2B03:00')).toBeUndefined();
  });

  it('presets and the two extras pass; any other extra does not', () => {
    for (const preset of ['today', '7d', '30d', 'this_month']) expect(parse(`range=${preset}`)).toEqual({ kind: 'preset', preset });
    expect(parse('range=24h')).toEqual({ kind: 'extra', extra: '24h' });
    expect(parse('range=90d')).toEqual({ kind: 'extra', extra: '90d' });
    expect(parse('range=week')).toBeUndefined();
    expect(narrowAnalyticsWindow(undefined)).toBeUndefined();
    expect(narrowAnalyticsWindow({ kind: 'none' })).toEqual({ kind: 'none' });
  });
});

describe('analyticsRequestParams (§3.5, Q-13, F-54)', () => {
  const NOW = new Date('2026-10-11T09:15:00.000Z');
  const request = (patch: Partial<AnalyticsFilters>) => analyticsRequestParams(withFilters(patch), NOW);

  it('keeps the historical param order, with user for the account and request_type for the request type', () => {
    const params = request({
      scope: 'all',
      groupBy: 'agent',
      provider: 'openai',
      model: 'gpt-4o',
      activity: 'chat',
      requestType: 'completion',
      feature: 'f',
      component: 'c',
      endpoint: '/e',
      account: UUID,
      agent: 'no-agent',
      execution: `single-${UUID}`,
      category: 'memory',
    });
    expect([...params.keys()]).toEqual([
      'breakdownBy',
      'scope',
      'provider',
      'model',
      'activity',
      'request_type',
      'feature',
      'component',
      'endpoint',
      'user',
      'agent',
      'execution',
      'category',
      'period',
    ]);
    expect(params.get('breakdownBy')).toBe('agent');
    expect(params.get('user')).toBe(UUID);
    expect(params.get('request_type')).toBe('completion');
  });

  it('the defaults: breakdownBy and scope always, period=30, nothing else', () => {
    expect(request({}).toString()).toBe('breakdownBy=provider&scope=bos&period=30');
  });

  it('category all is not sent', () => {
    expect(request({ scope: 'all', category: 'all' }).has('category')).toBe(false);
  });

  it.each<[AdminWindowValue, string]>([
    [{ kind: 'extra', extra: '24h' }, '1'],
    [{ kind: 'preset', preset: '7d' }, '7'],
    [{ kind: 'preset', preset: '30d' }, '30'],
    [{ kind: 'extra', extra: '90d' }, '90'],
  ])('%j stays the rolling server period=%s (Q-13, F-94)', (window, period) => {
    const params = request({ window });
    expect(params.get('period')).toBe(period);
    expect(params.has('dateFrom')).toBe(false);
    expect(params.has('dateTo')).toBe(false);
  });

  it.each(['today', 'this_month'] as const)('%s sends its explicit UTC bounds, end of day with microseconds', (preset) => {
    const { from, to } = resolveAdminWindow(preset, NOW);
    const params = request({ window: { kind: 'preset', preset } });
    expect(params.get('dateFrom')).toBe(`${from}T00:00:00.000Z`);
    expect(params.get('dateTo')).toBe(`${to}T23:59:59.999999Z`);
    expect(params.has('period')).toBe(false);
  });

  it('F-54: a custom range is whole UTC days on both sides, whatever the local timezone', () => {
    const params = request({ window: { kind: 'custom', from: '2026-09-25', to: '2026-09-26' } });
    expect(params.get('dateFrom')).toBe('2026-09-25T00:00:00.000Z');
    expect(params.get('dateTo')).toBe('2026-09-26T23:59:59.999999Z');
    expect(params.has('period')).toBe(false);
  });

  it('a linked window is sent verbatim', () => {
    const params = request({ window: { kind: 'linked', from: '2026-09-25T08:14:00+03:00', to: '2026-09-26T08:14:00.000Z' } });
    expect(params.get('dateFrom')).toBe('2026-09-25T08:14:00+03:00');
    expect(params.get('dateTo')).toBe('2026-09-26T08:14:00.000Z');
    expect(params.has('period')).toBe(false);
  });

  it('no window sends no window param (the route default)', () => {
    const params = request({ window: { kind: 'none' } });
    expect(params.has('period') || params.has('dateFrom') || params.has('dateTo')).toBe(false);
  });
});

describe('normaliseForScope and scopeSwitchPatch (C3-4)', () => {
  it('Business OS drops agent, execution, a category and the hidden group-bys', () => {
    expect(normaliseForScope(withFilters({ agent: UUID, execution: UUID, category: 'memory', groupBy: 'agent' }))).toEqual({
      agent: '',
      execution: '',
      category: 'all',
      groupBy: 'provider',
    });
    expect(normaliseForScope(withFilters({ groupBy: 'execution' }))).toEqual({ groupBy: 'provider' });
  });

  it('is empty when nothing needs fixing, and in the All scope', () => {
    expect(normaliseForScope(DEFAULTS)).toEqual({});
    expect(normaliseForScope(withFilters({ groupBy: 'feature', feature: 'f' }))).toEqual({});
    expect(normaliseForScope(withFilters({ scope: 'all', agent: UUID, category: 'memory', groupBy: 'agent' }))).toEqual({});
  });

  it('switching to Business OS cleans up in the same patch; switching to All restores nothing', () => {
    const all = withFilters({ scope: 'all', agent: UUID, category: 'memory', groupBy: 'execution', provider: 'openai' });
    expect(scopeSwitchPatch('bos', all)).toEqual({ scope: 'bos', agent: '', category: 'all', groupBy: 'provider' });
    expect(scopeSwitchPatch('all', DEFAULTS)).toEqual({ scope: 'all' });
  });
});

describe('drillPatch: one case per breadcrumb level (SA M-1)', () => {
  // Today's state deep in a drill, with a business from the Businesses link and a category.
  const deep = withFilters({
    scope: 'all',
    groupBy: 'execution',
    window: { kind: 'preset', preset: '7d' },
    account: UUID,
    category: 'memory',
    provider: 'openai',
    model: 'gpt-4o',
    activity: 'chat',
    requestType: 'completion',
    feature: 'f',
    component: 'c',
    endpoint: '/e',
    agent: 'no-agent',
    execution: `single-${UUID}`,
  });

  const CLEARED = {
    provider: '',
    model: '',
    activity: '',
    requestType: '',
    feature: '',
    component: '',
    endpoint: '',
    account: '',
    agent: '',
    execution: '',
    category: 'all',
  };

  const after = (keep: Partial<AnalyticsFilters>) => ({ ...deep, ...drillPatch(keep) });

  it('names all eleven drill, business and category fields, and never group by, scope or window', () => {
    const patch = drillPatch({ provider: 'openai' });
    expect(Object.keys(patch).sort()).toEqual(Object.keys(CLEARED).sort());
    expect('groupBy' in patch || 'scope' in patch || 'window' in patch).toBe(false);
  });

  it('All Data clears every drill filter, the business and the category; keeps scope, window and group by', () => {
    expect(drillPatch({})).toEqual(CLEARED);
    const view = after({});
    expect(view.scope).toBe('all');
    expect(view.window).toEqual({ kind: 'preset', preset: '7d' });
    expect(view.groupBy).toBe('execution');
  });

  it.each<[string, Partial<AnalyticsFilters>]>([
    ['provider', { provider: 'openai' }],
    ['model', { provider: 'openai', model: 'gpt-4o' }],
    ['activity', { provider: 'openai', model: 'gpt-4o', activity: 'chat' }],
    ['user (account)', { provider: 'openai', model: 'gpt-4o', activity: 'chat', account: UUID }],
    ['request type', { provider: 'openai', model: 'gpt-4o', activity: 'chat', requestType: 'completion' }],
    ['feature', { provider: 'openai', model: 'gpt-4o', activity: 'chat', feature: 'f' }],
    ['component', { provider: 'openai', model: 'gpt-4o', activity: 'chat', component: 'c' }],
    ['endpoint', { provider: 'openai', model: 'gpt-4o', activity: 'chat', endpoint: '/e' }],
    [
      'agent',
      {
        provider: 'openai',
        model: 'gpt-4o',
        activity: 'chat',
        requestType: 'completion',
        feature: 'f',
        component: 'c',
        endpoint: '/e',
        account: UUID,
        agent: 'no-agent',
      },
    ],
  ])('the %s breadcrumb keeps exactly its levels', (_level, keep) => {
    expect(drillPatch(keep)).toEqual({ ...CLEARED, ...keep });
  });

  it('a business that arrived by link is dropped by a breadcrumb that does not keep it, as today', () => {
    const fromBusinesses = withFilters({ account: UUID, provider: 'openai', model: 'gpt-4o' });
    expect({ ...fromBusinesses, ...drillPatch({ provider: 'openai' }) }.account).toBe('');
  });
});

describe('rowClickPatch (the P-4, P-5, P-10, P-11 paths at unit level)', () => {
  const ROW = { id: 'row-1' };

  it.each<[BreakdownDimension, Partial<AnalyticsFilters>]>([
    ['provider', { provider: 'row-1', groupBy: 'model' }],
    ['model', { model: 'row-1', groupBy: 'activity' }],
    ['activity', { activity: 'row-1', groupBy: 'agent' }],
    ['request_type', { requestType: 'row-1', groupBy: 'agent' }],
    ['feature', { feature: 'row-1', groupBy: 'agent' }],
    ['component', { component: 'row-1', groupBy: 'agent' }],
    ['endpoint', { endpoint: 'row-1', groupBy: 'agent' }],
    ['user', { account: 'row-1', groupBy: 'agent' }],
    ['agent', { agent: 'row-1', groupBy: 'execution' }],
    ['execution', { execution: 'row-1', groupBy: 'execution' }],
  ])('All scope: a %s row', (dim, expected) => {
    expect(rowClickPatch(ROW, withFilters({ scope: 'all', groupBy: dim }))).toEqual(expected);
  });

  it.each<[BreakdownDimension, Partial<AnalyticsFilters>]>([
    ['provider', { provider: 'row-1', groupBy: 'model' }],
    ['model', { model: 'row-1', groupBy: 'activity' }],
    ['activity', { activity: 'row-1', groupBy: 'feature' }],
    ['request_type', { requestType: 'row-1', groupBy: 'feature' }],
    ['endpoint', { endpoint: 'row-1', groupBy: 'feature' }],
    ['feature', { feature: 'row-1', groupBy: 'component' }],
    ['component', { component: 'row-1', groupBy: 'feature' }],
    ['user', { account: 'row-1', groupBy: 'feature' }],
  ])('Business OS scope: a %s row never goes to agents', (dim, expected) => {
    expect(rowClickPatch(ROW, withFilters({ groupBy: dim }))).toEqual(expected);
  });

  it('P-5: a User row with feature and component filtered goes to Model', () => {
    expect(rowClickPatch(ROW, withFilters({ groupBy: 'user', feature: 'f', component: 'c' }))).toEqual({
      account: 'row-1',
      groupBy: 'model',
    });
  });

  it('P-11: with every Business OS dimension filtered, a row click stays put', () => {
    const filters = withFilters({ groupBy: 'component', account: UUID, provider: 'p', model: 'm', activity: 'a', feature: 'f' });
    expect(rowClickPatch(ROW, filters)).toEqual({ component: 'row-1', groupBy: 'component' });
  });
});
