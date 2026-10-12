/**
 * The Activity tab's filter spec and its request builder (Admin Layout Standard
 * L-8a, workplan §2.4). Pure: no React, no fetch, no `'use client'`.
 *
 * Every filter is in the URL (U-1). Activity had no URL before, so there are no
 * aliases. `tab` (the page's) and `actionId` (B3, U-10) are not spec keys, so
 * the hook keeps them.
 *
 * The validators follow the route's own schema
 * (`app/api/admin/business-os/ai-activity/route.ts`) where the browser can:
 * a value the route would refuse is ignored on arrival (U-4). Two things the
 * browser cannot check without importing a server module (refused by the
 * page's source guard): an area not in the catalog, and the route's size caps
 * (a minimum cost of $1,000,000 or more, a custom window over its day limit).
 * Those reach the route and show its own message, as a typed value always has;
 * Clear recovers (recorded page deviation, SA Q-7).
 *
 * The request is unchanged: `from`, `to`, `sort`, then each set filter, in the
 * order the tab always sent them.
 */

import { resolveWindow, type AdminWindowExtra, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { textFilter, type AdminFilterField, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';

import type { ActivityOutcome, ActivitySort, ActivityTrigger } from './activityTypes';
import { wholeDateWindowFilter } from './tabWindowFilter';

export interface ActivityFilters {
  /** Default This month. Always two whole dates when sent (the route needs both). */
  window: AdminWindowValue;
  /** One business; request param `accountId`. '' = every business. */
  account: string;
  area: string;
  outcome: '' | ActivityOutcome;
  trigger: '' | ActivityTrigger;
  /** Request param `minCostUsd`; URL key `min_cost`. */
  minCost: string;
  sort: ActivitySort;
}

/** The page the tiles link to (the tab rides along in the search string). */
export const ACTIVITY_PATH = '/admin/business-os-llm';

export const ACTIVITY_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: 'this_month' };

/** The four windows this tab offered beyond the standard five (D-2 (b)), after Custom. */
export const ACTIVITY_WINDOW_EXTRAS: readonly AdminWindowExtra[] = ['yesterday', 'this_week', 'last_week', 'last_month'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A catalog area name: lower snake case, 1 to 64 characters. */
const AREA = /^[a-z][a-z0-9_]{0,63}$/;
/** The route's format rule only; its size and precision rules stay with the route. */
const MIN_COST = /^\d+(\.\d+)?$/;

/**
 * A well-formed minimum cost (digits, an optional decimal part). One rule for
 * the URL parse and the bar's Apply (QA-L8a-1): a value the URL would drop is
 * never applied, so it can never be dropped later by a re-parse (a tab switch).
 */
export const isMinCostValue = (raw: string): boolean => MIN_COST.test(raw);

const OUTCOMES: readonly ActivityOutcome[] = ['succeeded', 'failed'];
const TRIGGERS: readonly ActivityTrigger[] = ['owner', 'scheduled', 'external'];
const SORTS: readonly ActivitySort[] = ['time', 'cost'];

/** One key holding one of a fixed set of values; anything else is ignored (U-4). */
function choiceFilter<T extends string, D extends T | ''>(key: string, values: readonly T[], defaultValue: D): AdminFilterField<T | D> {
  return {
    keys: [key],
    defaultValue,
    parse: (get) => {
      const raw = get(key);
      return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;
    },
    serialise: (value) => (value === '' ? {} : { [key]: value }),
  };
}

/** Module-level, so its identity is stable (the hook requires it). Keys are written in this order. */
export const ACTIVITY_FILTER_SPEC: AdminFilterSpec<ActivityFilters> = {
  // The shared two-whole-dates window (moved to tabWindowFilter.ts in L-9a, SA Q-3; same code).
  window: wholeDateWindowFilter({ defaultValue: ACTIVITY_DEFAULT_WINDOW, extras: ACTIVITY_WINDOW_EXTRAS }),
  account: textFilter({ key: 'account', defaultValue: '', isValid: (raw) => UUID.test(raw) }),
  area: textFilter({ key: 'area', defaultValue: '', isValid: (raw) => AREA.test(raw) }),
  outcome: choiceFilter('outcome', OUTCOMES, ''),
  trigger: choiceFilter('trigger', TRIGGERS, ''),
  minCost: textFilter({ key: 'min_cost', defaultValue: '', isValid: isMinCostValue }),
  sort: choiceFilter('sort', SORTS, 'time'),
};

/** The two whole dates a window means at `now`; anything the route cannot take falls back to the default. */
function datesOf(window: AdminWindowValue, now: Date): { from: string; to: string } {
  const resolved = resolveWindow(window, now);
  if (resolved.kind === 'dates' && resolved.from !== null && resolved.to !== null) {
    return { from: resolved.from, to: resolved.to };
  }
  const fallback = resolveWindow(ACTIVITY_DEFAULT_WINDOW, now);
  return fallback.kind === 'dates' && fallback.from !== null && fallback.to !== null
    ? { from: fallback.from, to: fallback.to }
    : { from: '', to: '' };
}

/**
 * The list route's query string. Only what is set is sent: the route is strict
 * and refuses empty values rather than guessing at them. The caller resolves
 * this once per filter change, so Refresh re-sends the same dates.
 */
export function activityRouteSearch(filters: ActivityFilters, now: Date): string {
  const { from, to } = datesOf(filters.window, now);
  const params = new URLSearchParams({ from, to, sort: filters.sort });
  if (filters.account) params.set('accountId', filters.account);
  if (filters.area) params.set('area', filters.area);
  if (filters.outcome) params.set('outcome', filters.outcome);
  if (filters.trigger) params.set('trigger', filters.trigger);
  if (filters.minCost) params.set('minCostUsd', filters.minCost);
  return params.toString();
}
