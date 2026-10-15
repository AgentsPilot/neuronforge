/**
 * The finance page's URL filters (finance & business health slice 1a, L-4,
 * SA-F11 condition 1): one pure parse / serialise pair.
 *
 * Only ids and enums ever reach the URL (`preset`, `from`, `to`, `accountId`),
 * never a business name. An invalid value falls back to the default (This
 * month, All businesses) with a small notice; it never crashes the page. The
 * server re-validates everything with its own strict schema, so the URL is
 * input, never authority.
 *
 * Slice 6a (Money M-3, SA-Q43, SA-Q44, E-48, SA-W84): four more keys, `tab`
 * (`accounts`; absent = Overview), `sort`, `group` and `show`. `sort`,
 * `group` and `show` are read only with `tab=accounts`; `tab` together with
 * `accountId` is invalid (the route returns 400 for both, and this parser
 * mirrors it with the default plus the notice). Defaults are never written.
 *
 * PURE ON PURPOSE (SA-W83, SA-WR-42): no `'use client'`, no React, no Next, no
 * server-only module; its only runtime import is `adminWindowPresets`. The
 * route imports `FINANCE_GROUP_SHAPE` and the two enum lists from here, so the
 * page and the route share ONE definition. A source rule pins this purity.
 */

import {
  ADMIN_WINDOW_CHOICES,
  customRangeProblem,
  type AdminWindowChoice,
} from '@/app/admin/components/adminWindowPresets';
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

/** The only keys the page reads or writes. */
export const FINANCE_URL_KEYS = ['preset', 'from', 'to', 'accountId', 'tab', 'sort', 'group', 'show'] as const;

export const FINANCE_URL_NOTICE = 'The link had a filter this page could not use, so the default view is shown.';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the filters from the URL. Unknown keys are ignored; anything invalid gives the default plus a notice. */
export function parseFinanceUrl(params: URLSearchParams, now: Date): { query: FinanceQuery; notice: string | null } {
  const invalid = { query: DEFAULT_FINANCE_QUERY, notice: FINANCE_URL_NOTICE };

  for (const key of FINANCE_URL_KEYS) {
    if (params.getAll(key).length > 1) return invalid;
  }

  const rawPreset = params.get('preset');
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const rawAccount = params.get('accountId');
  const rawTab = params.get('tab');
  const rawSort = params.get('sort');
  const rawGroup = params.get('group');
  const rawShow = params.get('show');

  let preset: AdminWindowChoice = DEFAULT_FINANCE_QUERY.preset;
  if (rawPreset !== null) {
    if (!(ADMIN_WINDOW_CHOICES as readonly string[]).includes(rawPreset)) return invalid;
    preset = rawPreset as AdminWindowChoice;
  }

  let accountId: string | null = null;
  if (rawAccount !== null && rawAccount !== '') {
    if (!UUID_PATTERN.test(rawAccount)) return invalid;
    accountId = rawAccount.toLowerCase();
  }

  // Slice 6a: the route's rules, mirrored (SA-W84, E-48).
  let tab: FinanceQuery['tab'] = null;
  if (rawTab !== null) {
    if (rawTab !== 'accounts' || accountId !== null) return invalid;
    tab = 'accounts';
  }
  if (tab === null && (rawSort !== null || rawGroup !== null || rawShow !== null)) return invalid;
  let sort: FinanceAccountsSort = DEFAULT_FINANCE_QUERY.sort;
  if (rawSort !== null) {
    if (!(FINANCE_ACCOUNTS_SORTS as readonly string[]).includes(rawSort)) return invalid;
    sort = rawSort as FinanceAccountsSort;
  }
  let group: string | null = null;
  if (rawGroup !== null) {
    if (!FINANCE_GROUP_SHAPE.test(rawGroup)) return invalid;
    group = rawGroup;
  }
  let show: FinanceAccountsShow = DEFAULT_FINANCE_QUERY.show;
  if (rawShow !== null) {
    if (!(FINANCE_ACCOUNTS_SHOWS as readonly string[]).includes(rawShow)) return invalid;
    show = rawShow as FinanceAccountsShow;
  }
  const tabPart = { tab, sort, group, show };

  if (preset === 'custom') {
    if (rawFrom === null || rawTo === null || customRangeProblem(rawFrom, rawTo, now) !== null) return invalid;
    return { query: { preset, from: rawFrom, to: rawTo, accountId, ...tabPart }, notice: null };
  }

  // A preset's dates are resolved by the server's clock: client dates are dropped.
  return { query: { preset, from: null, to: null, accountId, ...tabPart }, notice: null };
}

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
