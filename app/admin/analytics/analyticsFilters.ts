/**
 * AI cost & usage's filter spec, its request-param builder and its drill
 * helpers (Admin Layout Standard L-2a, workplan §3.5 and §4). Pure: no React,
 * no fetch (mirrors `auditTrailFilters.ts`).
 *
 * Every filter is in the URL (U-1), drill clicks and breadcrumbs included. The
 * old names `dateFrom`, `dateTo` and `user` are read forever and rewritten
 * (U-9), so every inbound link (the Health spend tile, the Businesses panel,
 * the AI activity cutover notice) opens the same view.
 *
 * The validators mirror the route's own schema
 * (`app/api/admin/token-usage/drill-down/route.ts`): a value the route would
 * refuse with a 400 is ignored on arrival (U-4), and a value it accepts is
 * never dropped (SA S-2).
 *
 * The route is unchanged: it still receives `breakdownBy`, `user`, `period`,
 * `dateFrom` and `dateTo`, in the page's historical param order.
 */

import { textFilter, type AdminFilterField, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import {
  boundForm,
  resolveWindow,
  windowFilter,
  type AdminWindowExtra,
  type AdminWindowValue,
} from '@/app/admin/components/layout/adminWindow';
import {
  BOS_HIDDEN_DIMENSIONS,
  bosDrillTarget,
  type BreakdownDimension,
  type Filters,
  type Scope,
} from './analyticsTypes';

export interface AnalyticsFilters {
  /** Default 'bos' (user decision, 2026-09-25). */
  scope: Scope;
  /** Default 30 days. */
  window: AdminWindowValue;
  /** One account; request param `user`. '' = every account. */
  account: string;
  /** 'all' or one AgentsPilot category (All scope only). */
  category: string;
  /** The table's dimension; request param `breakdownBy`. */
  groupBy: BreakdownDimension;
  provider: string;
  model: string;
  activity: string;
  /** Request param `request_type`. */
  requestType: string;
  feature: string;
  component: string;
  endpoint: string;
  /** All scope only. */
  agent: string;
  /** All scope only. */
  execution: string;
}

/** The fields a drill click or a breadcrumb sets, and that carry a readable label. */
export type DrillField =
  | 'provider'
  | 'model'
  | 'activity'
  | 'requestType'
  | 'feature'
  | 'component'
  | 'endpoint'
  | 'account'
  | 'agent'
  | 'execution';

export const ANALYTICS_PATH = '/admin/analytics';

export const ANALYTICS_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: '30d' };

/** The two windows this page offered beyond the standard five (D-2 (b)). */
export const ANALYTICS_WINDOW_EXTRAS: readonly AdminWindowExtra[] = ['24h', '90d'];

const BREAKDOWN_DIMENSIONS: readonly BreakdownDimension[] = [
  'provider',
  'model',
  'activity',
  'user',
  'agent',
  'execution',
  'request_type',
  'feature',
  'component',
  'endpoint',
];
const SCOPES: readonly Scope[] = ['bos', 'all'];
const CATEGORIES: readonly string[] = ['all', 'creation', 'execution', 'memory', 'system'];

/** The route's `UUID_RE`, case-insensitive like it (SA S-2). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIMENSION_MAX = 200;

export const isUuid = (raw: string): boolean => UUID.test(raw);

/** The route's `dimension`: 1 to 200 characters, no control character (code points 0-31 and 127). */
export function isDimensionValue(raw: string): boolean {
  if (raw.length < 1 || raw.length > DIMENSION_MAX) return false;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

export const isAccountValue = (raw: string): boolean => raw === 'system' || isUuid(raw);
export const isAgentValue = (raw: string): boolean => raw === 'no-agent' || isUuid(raw);
export const isExecutionValue = (raw: string): boolean =>
  isUuid(raw) || (raw.startsWith('single-') && isUuid(raw.slice(7)));

/** One key holding one of a fixed set of values; anything else is ignored (U-4). */
function enumFilter<T extends string>(key: string, values: readonly T[], defaultValue: T): AdminFilterField<T> {
  return {
    keys: [key],
    defaultValue,
    parse: (get) => {
      const raw = get(key);
      return values.find((value) => value === raw);
    },
    serialise: (value) => ({ [key]: value }),
  };
}

/**
 * The window narrowed to what this route can take (SA Q-4, a recorded page
 * deviation from U-7). A custom window needs both dates. A linked window needs
 * both bounds as instants with an offset, from not after to, compared by time
 * (`Date.parse`), never as strings, because two offsets can disagree with the
 * string order (SA S-1). The route's Zod refuses the minute form, and a
 * one-sided window would be sent with the route's own "now minus 30 days" for
 * the missing side, a different window. Anything else: undefined, the default
 * (and the URL is cleaned).
 */
export function narrowAnalyticsWindow(value: AdminWindowValue | undefined): AdminWindowValue | undefined {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case 'none':
    case 'preset':
    case 'extra':
      return value;
    case 'custom':
      return value.from !== null && value.to !== null ? value : undefined;
    case 'linked': {
      const { from, to } = value;
      if (from === null || to === null) return undefined;
      if (boundForm(from) !== 'instant' || boundForm(to) !== 'instant') return undefined;
      return Date.parse(from) <= Date.parse(to) ? value : undefined;
    }
  }
}

const WINDOW_FIELD = windowFilter({
  defaultValue: ANALYTICS_DEFAULT_WINDOW,
  aliases: { dateFrom: 'from', dateTo: 'to' },
  extras: ANALYTICS_WINDOW_EXTRAS,
});

const dimensionFilter = (key: string) => textFilter({ key, defaultValue: '', isValid: isDimensionValue });

/** Spec order is URL order (the hook appends in this order). */
export const ANALYTICS_FILTER_SPEC: AdminFilterSpec<AnalyticsFilters> = {
  scope: enumFilter<Scope>('scope', SCOPES, 'bos'),
  window: { ...WINDOW_FIELD, parse: (get) => narrowAnalyticsWindow(WINDOW_FIELD.parse(get)) },
  account: textFilter({ key: 'account', defaultValue: '', aliases: ['user'], isValid: isAccountValue }),
  category: enumFilter<string>('category', CATEGORIES, 'all'),
  groupBy: enumFilter<BreakdownDimension>('group_by', BREAKDOWN_DIMENSIONS, 'provider'),
  provider: dimensionFilter('provider'),
  model: dimensionFilter('model'),
  activity: dimensionFilter('activity'),
  requestType: dimensionFilter('request_type'),
  feature: dimensionFilter('feature'),
  component: dimensionFilter('component'),
  endpoint: dimensionFilter('endpoint'),
  agent: textFilter({ key: 'agent', defaultValue: '', isValid: isAgentValue }),
  execution: textFilter({ key: 'execution', defaultValue: '', isValid: isExecutionValue }),
};

/** The rolling server windows: `period=N` (Q-13; F-94 stays as recorded). */
const ROLLING_PERIOD_DAYS: Readonly<Record<string, number>> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

/**
 * The route's query, in the page's historical param order: breakdownBy, scope,
 * provider, model, activity, request_type, feature, component, endpoint, user,
 * agent, execution, category, then the window.
 *
 * 24 hours, 7 days, 30 days and 90 days stay the route's rolling `period=N`.
 * Today, This month and a custom range go out as explicit UTC instants: from at
 * 00:00:00.000Z, to at 23:59:59.999999Z (L-1c SA S-1), so the custom range is
 * whole UTC days on both sides (F-54; it used to mix UTC and local time).
 * Linked bounds are sent verbatim, as they always were.
 *
 * Callers pass the scope-normalised filters (`normaliseForScope`), so a
 * combination the route refuses in Business OS scope is never sent.
 */
export function analyticsRequestParams(filters: AnalyticsFilters, now: Date): URLSearchParams {
  const params = new URLSearchParams({ breakdownBy: filters.groupBy, scope: filters.scope });
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.model) params.set('model', filters.model);
  if (filters.activity) params.set('activity', filters.activity);
  if (filters.requestType) params.set('request_type', filters.requestType);
  if (filters.feature) params.set('feature', filters.feature);
  if (filters.component) params.set('component', filters.component);
  if (filters.endpoint) params.set('endpoint', filters.endpoint);
  if (filters.account) params.set('user', filters.account);
  if (filters.agent) params.set('agent', filters.agent);
  if (filters.execution) params.set('execution', filters.execution);
  if (filters.category && filters.category !== 'all') params.set('category', filters.category);

  const value = filters.window;
  switch (value.kind) {
    case 'none':
      break;
    case 'extra':
      params.set('period', String(ROLLING_PERIOD_DAYS[value.extra]));
      break;
    case 'preset': {
      const rolling = ROLLING_PERIOD_DAYS[value.preset];
      if (rolling !== undefined) {
        params.set('period', String(rolling));
        break;
      }
      const resolved = resolveWindow(value, now);
      if (resolved.kind === 'dates') setWholeDays(params, resolved.from, resolved.to);
      break;
    }
    case 'custom':
      setWholeDays(params, value.from, value.to);
      break;
    case 'linked':
      if (value.from !== null) params.set('dateFrom', value.from);
      if (value.to !== null) params.set('dateTo', value.to);
      break;
  }
  return params;
}

function setWholeDays(params: URLSearchParams, from: string | null, to: string | null): void {
  if (from !== null) params.set('dateFrom', `${from}T00:00:00.000Z`);
  if (to !== null) params.set('dateTo', `${to}T23:59:59.999999Z`);
}

/**
 * What Business OS scope cannot hold (C3-4): agent, execution, a category other
 * than all, and the agent / execution group-bys (back to provider). `{}` when
 * nothing needs fixing, so a caller can tell.
 */
export function normaliseForScope(filters: AnalyticsFilters): Partial<AnalyticsFilters> {
  if (filters.scope !== 'bos') return {};
  const patch: Partial<AnalyticsFilters> = {};
  if (filters.agent !== '') patch.agent = '';
  if (filters.execution !== '') patch.execution = '';
  if (filters.category !== 'all') patch.category = 'all';
  if (BOS_HIDDEN_DIMENSIONS.has(filters.groupBy)) patch.groupBy = 'provider';
  return patch;
}

/**
 * The scope switch as one patch. Entering Business OS clears every selection
 * that does not exist there in the same event, so the very next request is
 * already valid for the route (C3-4). Switching back to "All" restores nothing.
 */
export function scopeSwitchPatch(next: Scope, filters: AnalyticsFilters): Partial<AnalyticsFilters> {
  return next === 'bos' ? { scope: next, ...normaliseForScope({ ...filters, scope: next }) } : { scope: next };
}

const DRILL_DEFAULTS: Readonly<Pick<AnalyticsFilters, DrillField | 'category'>> = {
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

/**
 * A breadcrumb (SA M-1). Today a breadcrumb REPLACES the whole drill state, so
 * the patch names all eleven drill, business and category fields, each at its
 * default unless kept; it never names group by, scope or window, which a
 * breadcrumb keeps. "All Data" is `drillPatch({})`.
 */
export function drillPatch(keep: Partial<Pick<AnalyticsFilters, DrillField | 'category'>>): Partial<AnalyticsFilters> {
  const patch: Partial<AnalyticsFilters> = { ...DRILL_DEFAULTS };
  for (const key of Object.keys(DRILL_DEFAULTS) as Array<DrillField | 'category'>) {
    const kept = keep[key];
    if (kept !== undefined) patch[key] = kept;
  }
  return patch;
}

/** The filter a row of each dimension sets. */
export const DIMENSION_FIELD: Readonly<Record<BreakdownDimension, DrillField>> = {
  provider: 'provider',
  model: 'model',
  activity: 'activity',
  request_type: 'requestType',
  feature: 'feature',
  component: 'component',
  endpoint: 'endpoint',
  user: 'account',
  agent: 'agent',
  execution: 'execution',
};

/** Where a row click goes next on the "All" path (the page's historical switch, as a table). */
const NEXT_DIMENSION: Readonly<Record<BreakdownDimension, BreakdownDimension>> = {
  provider: 'model',
  model: 'activity',
  activity: 'agent',
  request_type: 'agent',
  feature: 'agent',
  component: 'agent',
  endpoint: 'agent',
  user: 'agent',
  agent: 'execution',
  execution: 'execution',
};

/** The filters under their dimension names, the shape `bosDrillTarget` reads. */
function byDimension(filters: AnalyticsFilters): Filters {
  return {
    provider: filters.provider,
    model: filters.model,
    activity: filters.activity,
    user: filters.account,
    agent: filters.agent,
    execution: filters.execution,
    request_type: filters.requestType,
    feature: filters.feature,
    component: filters.component,
    endpoint: filters.endpoint,
  };
}

/**
 * A drill click on a (non-call) row as one patch: the row's filter and the next
 * group-by. Business OS scope never drills into agents (C3-2, FYI-2): it goes
 * to the next Business OS dimension instead, or stays put when none is left.
 */
export function rowClickPatch(item: { id: string }, filters: AnalyticsFilters): Partial<AnalyticsFilters> {
  const clicked = filters.groupBy;
  const field = DIMENSION_FIELD[clicked];
  const next: AnalyticsFilters = { ...filters, [field]: item.id };
  let nextBreakdown = NEXT_DIMENSION[clicked];
  if (filters.scope === 'bos' && BOS_HIDDEN_DIMENSIONS.has(nextBreakdown)) {
    nextBreakdown = bosDrillTarget(byDimension(next), clicked) ?? clicked;
  }
  return { [field]: item.id, groupBy: nextBreakdown };
}
