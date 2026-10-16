/**
 * The finance page's REQUEST serialiser (slice 1a, L-4; Finance F-4): the
 * query the page sends to `/api/admin/business-os/finance`, and the lists the
 * route shares with the page.
 *
 * Finance F-4 (Admin Layout Standard §5.6, AC-173): the page URL is no longer
 * read or written here. It is the projection of `FINANCE_FILTER_SPEC` in
 * `financeFilters.ts` (canonical `range` / `account`, the old `preset` /
 * `accountId` read as aliases), and `toFinanceQuery` maps that state onto
 * `FinanceQuery` for `serialiseFinanceUrl`, which is unchanged, so the request
 * is byte-identical (pinned by `__tests__/financeRequest.pin.render.test.tsx`).
 * Only ids and enums ever reach the request, never a business name. The server
 * re-validates everything with its own strict schema.
 *
 * Slice 6a (Money M-3, SA-Q43, SA-Q44, E-48, SA-W84): `tab` (`accounts`;
 * absent = Overview), `sort`, `group` and `show`, written only with the tab
 * and with no business. Defaults are never written.
 *
 * PURE ON PURPOSE (SA-W83, SA-WR-42): no `'use client'`, no React, no Next, no
 * server-only module, and no runtime import at all since F-4. The route
 * imports `FINANCE_GROUP_SHAPE` and the two enum lists from here, so the page
 * and the route share ONE definition. A source rule pins this purity.
 */

import type { AdminWindowChoice } from '@/app/admin/components/adminWindowPresets';
import type { FinanceAccountsShow, FinanceAccountsSort } from '@/lib/business-os/finance/financeTypes';

export interface FinanceQuery {
  preset: AdminWindowChoice;
  /** Set only for `custom`. */
  from: string | null;
  /** Set only for `custom`. */
  to: string | null;
  accountId: string | null;
  /** Slice 6a: `accounts`, or null for the Overview. Never set with a business picked. */
  tab: 'accounts' | null;
  /** Slice 6a: the Accounts tab's sort (default `ai_cost`). */
  sort: FinanceAccountsSort;
  /** Slice 6a: a plan group key (by shape, SA-W83), or null for every group. */
  group: string | null;
  /** Slice 6a: the Accounts tab's show filter (default `all`). */
  show: FinanceAccountsShow;
}

export const DEFAULT_FINANCE_QUERY: FinanceQuery = {
  preset: 'this_month',
  from: null,
  to: null,
  accountId: null,
  tab: null,
  sort: 'ai_cost',
  group: null,
  show: 'all',
};

/** Slice 6a (SA-Q44): the Accounts tab's sort options, in the order the page offers them. */
export const FINANCE_ACCOUNTS_SORTS = ['ai_cost', 'margin', 'paid', 'credits'] as const satisfies readonly FinanceAccountsSort[];
/** Slice 6a (SA-Q44): the Accounts tab's show options. */
export const FINANCE_ACCOUNTS_SHOWS = ['all', 'active', 'negative'] as const satisfies readonly FinanceAccountsShow[];

/**
 * SA-W83: a plan group key by SHAPE, so no tier is written here or in the
 * route. A well-formed tier that is not configured matches no row ("No
 * accounts match this filter"), never an error.
 */
export const FINANCE_GROUP_SHAPE = /^(trial|founding_partner|comped|unknown_held|tier_set|tier:[a-z0-9_-]{1,40})$/;

/**
 * Write the filters back: `preset` always, `from` / `to` only for custom,
 * `accountId` only when set; `tab` only for Accounts with no business picked,
 * and `sort` / `group` / `show` only with the tab and only when not the default.
 */
export function serialiseFinanceUrl(query: FinanceQuery): string {
  const params = new URLSearchParams();
  params.set('preset', query.preset);
  if (query.preset === 'custom' && query.from !== null && query.to !== null) {
    params.set('from', query.from);
    params.set('to', query.to);
  }
  if (query.accountId !== null) params.set('accountId', query.accountId);
  if (query.tab === 'accounts' && query.accountId === null) {
    params.set('tab', 'accounts');
    if (query.sort !== DEFAULT_FINANCE_QUERY.sort) params.set('sort', query.sort);
    if (query.group !== null) params.set('group', query.group);
    if (query.show !== DEFAULT_FINANCE_QUERY.show) params.set('show', query.show);
  }
  return params.toString();
}
