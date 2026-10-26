/**
 * The AI cost page's ONE URL filter spec, and the two requests it drives
 * (Money MK-3b, SA-Q-MK3-2, SA-CR-MK3A DV-1). Pure: no React, no fetch, no
 * `'use client'`.
 *
 * Finance's pattern (`financeFilters.ts`, SA-W2): `tab` is a field of the same
 * spec, so a tab switch, a window or a business change is one write, and the
 * window and the business are ONE value on both tabs.
 *
 *   tab        `checks` (Summary & checks, the default, omitted) or `calls`
 *   window     the Calls tab's field (`range` / `from` / `to`, the old
 *              `dateFrom` / `dateTo` read forever): This month by default;
 *              Today, 7 days, 30 days, This month, Custom, 90 days; a linked
 *              window (exact instants, the Health tile's) is kept
 *   account    a business (UUID), or `system` on the Calls tab; the old `user`
 *              read forever
 *   …          the Calls tab's own keys (scope, category, group_by, the drill
 *              keys, agent, execution), defined once in `analyticsFilters.ts`
 *
 * The report request (Summary & checks and the strip, on both tabs) is two
 * whole UTC dates and a business UUID: `reportSearch`. A linked window becomes
 * the whole UTC days that cover it (SA-Q-MK3-3), and `system` reads every
 * business (SA-Q-MK3-4). The Calls request is `analyticsRequestParams`, the
 * route's own historical shape. Neither request reads the tab or the Calls
 * keys it does not need, so a drill on the Calls tab never re-reads the report.
 */

import { resolveWindow, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import type { AdminFilterField, AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import { ANALYTICS_DEFAULT_WINDOW, ANALYTICS_FILTER_SPEC, isUuid, type AnalyticsFilters } from '@/app/admin/analytics/analyticsFilters';

export type AiCostTab = 'checks' | 'calls';

export const AI_COST_PATH = '/admin/ai-cost';

export interface AiCostFilters extends AnalyticsFilters {
  /** '' is not used: the default tab is `checks`, omitted from the URL. */
  tab: AiCostTab;
}

const TABS: readonly AiCostTab[] = ['checks', 'calls'];

const TAB_FIELD: AdminFilterField<AiCostTab> = {
  keys: ['tab'],
  defaultValue: 'checks',
  parse: (get) => TABS.find((tab) => tab === get('tab')),
  serialise: (value) => ({ tab: value }),
};

/** Module-level (the hook needs a stable identity). `tab` first, then the Calls spec in its own order. */
export const AI_COST_FILTER_SPEC: AdminFilterSpec<AiCostFilters> = {
  tab: TAB_FIELD,
  ...ANALYTICS_FILTER_SPEC,
};

/** The Calls tab's own keys: reset when leaving it, so Summary & checks' URL carries none (Finance's TAB_RESET). */
export const CALLS_ONLY_RESET: Partial<AiCostFilters> = {
  scope: ANALYTICS_FILTER_SPEC.scope.defaultValue,
  category: ANALYTICS_FILTER_SPEC.category.defaultValue,
  groupBy: ANALYTICS_FILTER_SPEC.groupBy.defaultValue,
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

/** Clear: every filter to its default, the tab kept (a Clear never changes the tab). */
export const AI_COST_CLEAR_PATCH: Partial<AiCostFilters> = {
  ...CALLS_ONLY_RESET,
  window: ANALYTICS_DEFAULT_WINDOW,
  account: '',
};

/** Clear's enabled state: anything but the tab away from its default. */
export function aiCostCanClear(filters: AiCostFilters): boolean {
  for (const key of Object.keys(AI_COST_CLEAR_PATCH) as Array<keyof AiCostFilters>) {
    const field = AI_COST_FILTER_SPEC[key] as AdminFilterField<unknown>;
    const equals = field.equals ?? Object.is;
    if (!equals(filters[key], field.defaultValue)) return true;
  }
  return false;
}

/** The date part (UTC) of a bound: a whole date as is, an instant or a minute through `Date`. */
function utcDateOf(bound: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bound)) return bound;
  const ms = Date.parse(bound);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/**
 * The whole UTC days a window means at `now`, for the report. A linked window
 * becomes the days that cover it (SA-Q-MK3-3); anything the report cannot take
 * falls back to the default, This month.
 */
export function reportDates(window: AdminWindowValue, now: Date): { from: string; to: string; covering: boolean } {
  const resolved = resolveWindow(window, now);
  if (resolved.kind === 'dates' && resolved.from !== null && resolved.to !== null) {
    return { from: resolved.from, to: resolved.to, covering: false };
  }
  if (resolved.kind === 'linked' && resolved.from !== null && resolved.to !== null) {
    const from = utcDateOf(resolved.from);
    const to = utcDateOf(resolved.to);
    if (from !== null && to !== null && from <= to) return { from, to, covering: true };
  }
  const fallback = resolveWindow(ANALYTICS_DEFAULT_WINDOW, now);
  return fallback.kind === 'dates' && fallback.from !== null && fallback.to !== null
    ? { from: fallback.from, to: fallback.to, covering: false }
    : { from: '', to: '', covering: false };
}

/** The business the report takes: a UUID only; `system` (a Calls drill value) reads every business. */
export const reportAccountOf = (account: string): string | null => (isUuid(account) ? account : null);

/**
 * The report route's query string: `from=…&to=…[&accountId=…]`, the request
 * Charge checks always sent (Pin C). The caller resolves it once per window or
 * business change, so Refresh and Try again re-send the same dates.
 */
export function reportSearch(window: AdminWindowValue, account: string, now: Date): string {
  const { from, to } = reportDates(window, now);
  const params = new URLSearchParams({ from, to });
  const accountId = reportAccountOf(account);
  if (accountId) params.set('accountId', accountId);
  return params.toString();
}
