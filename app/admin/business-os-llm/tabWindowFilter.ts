/**
 * The window field both filter tabs of the Business OS AI page use (Admin
 * Layout Standard L-9a, workplan §2.4, SA Q-3). Pure: no React, no fetch, no
 * `'use client'`.
 *
 * Moved here from `activityFilters.ts` (L-8a) unchanged, so Activity and Costs
 * share one rule for "the route takes two whole dates": the shared window field
 * with two kinds of value ignored on arrival (U-4), a linked window (minute or
 * instant bounds) and a one-sided custom window.
 *
 * SA M-1 (L-8): it spreads `windowFilter(...)` and overrides `parse` only, so
 * `keys`, `serialise` and `equals: windowEquals` are kept. An outside change
 * re-parses every field, and only a structural `equals` keeps the filters'
 * identity (no read when the URL changes around an unchanged window).
 */

import {
  windowFilter,
  type AdminWindowExtra,
  type AdminWindowValue,
} from '@/app/admin/components/layout/adminWindow';
import type { AdminFilterField } from '@/app/admin/components/layout/useAdminFilters';

export function wholeDateWindowFilter(options: {
  defaultValue: AdminWindowValue;
  /** The tab's own extra windows (D-2 (b)), after Custom. */
  extras: readonly AdminWindowExtra[];
}): AdminFilterField<AdminWindowValue> {
  const base = windowFilter({ defaultValue: options.defaultValue, extras: options.extras });
  return {
    ...base,
    parse: (get) => {
      const value = base.parse(get);
      if (value === undefined || value.kind === 'linked') return undefined;
      if (value.kind === 'custom' && (value.from === null || value.to === null)) return undefined;
      return value;
    },
  };
}
