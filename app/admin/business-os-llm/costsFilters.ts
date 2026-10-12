/**
 * The Costs & credits tab's filter spec and its request builder (Admin Layout
 * Standard L-9a, workplan §2.4). Pure: no React, no fetch, no `'use client'`.
 *
 * Every filter is in the URL (U-1): the window (`range`, `from`, `to`) and the
 * business (`account`). Costs had no URL before, so there are no aliases.
 * `tab` (the page's) is not a spec key, so the hook keeps it.
 *
 * The report route (`app/api/admin/business-os/credits/report/route.ts`) takes
 * two whole dates or neither, and an account UUID. A value it could not take is
 * ignored on arrival (U-4): a linked window, a one-sided custom window, a range
 * this tab does not offer, an account that is not a UUID. The route's size cap
 * (92 days) stays with the route and shows its own message, as typing one
 * always has.
 *
 * The request is unchanged: `from`, `to`, then `accountId` when one is chosen.
 * The default 30 days resolves to today minus 29 to today, exactly what the tab
 * sent before L-9a (`presetQuery(30)`); 7 and 90 days likewise.
 */

import { resolveWindow, type AdminWindowExtra, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';

import { wholeDateWindowFilter } from './tabWindowFilter';

export interface CostsFilters {
  /** Default 30 days. Always two whole dates when sent (the route takes both or neither). */
  window: AdminWindowValue;
  /** One business; request param `accountId`. '' = every business. */
  account: string;
}

export const COSTS_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: '30d' };

/** The window this tab offered beyond the standard five (D-2 (b)), after Custom. */
export const COSTS_WINDOW_EXTRAS: readonly AdminWindowExtra[] = ['90d'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Module-level, so its identity is stable (the hook requires it). Keys are written in this order. */
export const COSTS_FILTER_SPEC: AdminFilterSpec<CostsFilters> = {
  window: wholeDateWindowFilter({ defaultValue: COSTS_DEFAULT_WINDOW, extras: COSTS_WINDOW_EXTRAS }),
  account: textFilter({ key: 'account', defaultValue: '', isValid: (raw) => UUID.test(raw) }),
};

/** The two whole dates a window means at `now`; anything the route cannot take falls back to the default. */
function datesOf(window: AdminWindowValue, now: Date): { from: string; to: string } {
  const resolved = resolveWindow(window, now);
  if (resolved.kind === 'dates' && resolved.from !== null && resolved.to !== null) {
    return { from: resolved.from, to: resolved.to };
  }
  const fallback = resolveWindow(COSTS_DEFAULT_WINDOW, now);
  return fallback.kind === 'dates' && fallback.from !== null && fallback.to !== null
    ? { from: fallback.from, to: fallback.to }
    : { from: '', to: '' };
}

/**
 * The report route's query string: `from=…&to=…[&accountId=…]`. The caller
 * resolves this once per filter change, so Refresh and Try again re-send the
 * same dates, as the tab always did.
 */
export function costsRouteSearch(filters: CostsFilters, now: Date): string {
  const { from, to } = datesOf(filters.window, now);
  const params = new URLSearchParams({ from, to });
  if (filters.account) params.set('accountId', filters.account);
  return params.toString();
}
