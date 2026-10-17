/**
 * The finance page's URL filter state (Finance F-4, Admin Layout Standard
 * §5.6 U-1 to U-10; requirement §11G, AC-173 to AC-177, BD-28 to BD-31).
 * Pure: no `'use client'`, no React, no fetch.
 *
 * The page URL is the projection of ONE spec owned by `useAdminFilters`:
 * canonical `range` / `from` / `to` / `account`, with the old keys read
 * forever and never written (U-9: `preset` → `range`, `accountId` →
 * `account`). The Accounts tab's `tab`, `sort`, `group` and `show` keep their
 * names (SA-Q44) and are fields of the same spec, so every change is one write
 * (SA-W2, a recorded page deviation: `tab` is a hook key here).
 *
 * A bad value drops only its own filter, silently (U-4, BD-30, AC-175). The
 * window keeps only what the finance route takes, two whole dates with `to`
 * not after today UTC and at most 92 days; a minute or instant bound, a
 * one-sided window or a window the route would refuse falls back to This
 * month (SA-W6, E-61, as Analytics and Activity).
 *
 * THE REQUEST IS NOT THE PAGE URL. `toFinanceQuery` + `serialiseFinanceUrl`
 * are the only bridge (U-8), and the request is byte-identical to before F-4
 * for every state a valid link or an in-page choice reaches (AC-173, pinned in
 * `__tests__/financeRequest.pin.render.test.tsx`).
 *
 * DF-6 (§11L.5, DF6-FR-7 to DF6-FR-9): `range=since_start` is Finance's one
 * window extra. The field always parses it; `toFinanceQuery` sends it only with
 * a business (else the default window, so the route's 400 is never asked for,
 * SA-W-DF6-4); the cross-key repair drops it without a business (U-4).
 */

import { customRangeProblem } from '@/app/admin/components/adminWindowPresets';
import { windowEquals, windowFilter, type AdminWindowExtra, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { textFilter, type AdminFilterField, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import type { FinanceAccountsShow, FinanceAccountsSort } from '@/lib/business-os/finance/financeTypes';

import {
  DEFAULT_FINANCE_QUERY,
  FINANCE_ACCOUNTS_SHOWS,
  FINANCE_ACCOUNTS_SORTS,
  FINANCE_GROUP_SHAPE,
  type FinanceQuery,
} from './financeUrl';

export interface FinanceFilters {
  /** Default This month. Only a preset or a custom window with two whole dates the route accepts. */
  window: AdminWindowValue;
  /** '' = all businesses; otherwise a lower-case UUID (SA-W11). */
  account: string;
  /** '' = Overview. Only with no business (SA-W84). */
  tab: '' | 'accounts';
  /** The Accounts tab's sort; only with the tab (E-48). */
  sort: FinanceAccountsSort;
  /** '' = every group; a `FINANCE_GROUP_SHAPE` key. Only with the tab. */
  group: string;
  /** The Accounts tab's show filter; only with the tab. */
  show: FinanceAccountsShow;
}

export const FINANCE_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: 'this_month' };

/** DF-6 (SA-W-DF6-5): Finance's own window extra; the bar offers it only with a business picked. */
export const FINANCE_WINDOW_EXTRAS = ['since_start'] as const satisfies readonly AdminWindowExtra[];

/** DF-6: the "Since it started" window. */
export function isSinceStart(value: AdminWindowValue): boolean {
  return value.kind === 'extra' && value.extra === 'since_start';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * The shared window field, with the old `preset` key read as `range` (SA-W7:
 * on this field, no shared change) and `parse` narrowed to what the route
 * takes (SA-W6). `keys`, `serialise` and the structural `equals` are kept
 * (L-8 SA M-1), so a re-read around an unchanged window keeps its identity.
 * The clock is read here, as the page's old parser did: a past window inside
 * 92 days never becomes invalid later, and the cap is the route's own rule.
 */
function financeWindowField(): AdminFilterField<AdminWindowValue> {
  const base = windowFilter({ defaultValue: FINANCE_DEFAULT_WINDOW, extras: FINANCE_WINDOW_EXTRAS });
  return {
    ...base,
    aliases: { preset: 'range' },
    parse: (get) => {
      const value = base.parse(get);
      if (value === undefined || value.kind === 'linked') return undefined;
      // DF-6: `since_start` is the one extra; whether a business is picked is the repair's job.
      if (value.kind === 'extra' && !isSinceStart(value)) return undefined;
      if (value.kind === 'custom') {
        if (value.from === null || value.to === null) return undefined;
        if (customRangeProblem(value.from, value.to, new Date()) !== null) return undefined;
      }
      return value;
    },
  };
}

/** A business id in any case; lower-cased on read, as the old parser did (SA-W11), so the request is unchanged. */
const accountField: AdminFilterField<string> = {
  keys: ['account'],
  aliases: { accountId: 'account' },
  defaultValue: '',
  parse: (get) => {
    const raw = get('account');
    return raw !== null && UUID.test(raw) ? raw.toLowerCase() : undefined;
  },
  serialise: (value): Readonly<Record<string, string>> => (value === '' ? {} : { account: value }),
};

/** Module-level, so its identity is stable (the hook requires it). Keys are written in this order. */
export const FINANCE_FILTER_SPEC: AdminFilterSpec<FinanceFilters> = {
  window: financeWindowField(),
  account: accountField,
  tab: choiceFilter('tab', ['accounts'] as const, ''),
  sort: choiceFilter('sort', FINANCE_ACCOUNTS_SORTS, DEFAULT_FINANCE_QUERY.sort),
  group: textFilter({ key: 'group', defaultValue: '', isValid: (raw) => FINANCE_GROUP_SHAPE.test(raw) }),
  show: choiceFilter('show', FINANCE_ACCOUNTS_SHOWS, DEFAULT_FINANCE_QUERY.show),
};

/** The window part of the request; anything the route cannot take is the default (defensive: the spec never holds it). */
function windowQuery(window: AdminWindowValue, account: string): Pick<FinanceQuery, 'preset' | 'from' | 'to'> {
  if (window.kind === 'preset') return { preset: window.preset, from: null, to: null };
  // DF-6 (SA-W-DF6-4): only with a business, as the tab only without one; else the default below.
  if (isSinceStart(window) && account !== '') return { preset: 'since_start', from: null, to: null };
  if (window.kind === 'custom' && window.from !== null && window.to !== null) {
    return { preset: 'custom', from: window.from, to: window.to };
  }
  return { preset: DEFAULT_FINANCE_QUERY.preset, from: null, to: null };
}

/**
 * The ONLY input to `serialiseFinanceUrl` (U-8). The tab is sent only with no
 * business; `sort` / `group` / `show` are carried as they are, because the
 * serialiser already writes them only with the tab. So a combination the
 * repair below will clean is never sent, and the clean-up sends nothing.
 */
export function toFinanceQuery(filters: FinanceFilters): FinanceQuery {
  return {
    ...windowQuery(filters.window, filters.account),
    accountId: filters.account === '' ? null : filters.account,
    tab: filters.tab === 'accounts' && filters.account === '' ? 'accounts' : null,
    sort: filters.sort,
    group: filters.group === '' ? null : filters.group,
    show: filters.show,
  };
}

/** The Accounts tab's `onChange` (its API stays `FinanceQuery`) → a patch for the hook. */
export function fromFinanceQuery(query: FinanceQuery): Partial<FinanceFilters> {
  const window: AdminWindowValue =
    query.preset === 'since_start'
      ? { kind: 'extra', extra: 'since_start' }
      : query.preset === 'custom'
        ? query.from !== null && query.to !== null
          ? { kind: 'custom', from: query.from, to: query.to }
          : FINANCE_DEFAULT_WINDOW
        : { kind: 'preset', preset: query.preset };
  return {
    window,
    account: query.accountId ?? '',
    tab: query.tab ?? '',
    sort: query.sort,
    group: query.group ?? '',
    show: query.show,
  };
}

const TAB_KEYS_DEFAULT: Pick<FinanceFilters, 'sort' | 'group' | 'show'> = {
  sort: DEFAULT_FINANCE_QUERY.sort,
  group: '',
  show: DEFAULT_FINANCE_QUERY.show,
};

const tabKeysAtDefault = (filters: FinanceFilters) =>
  filters.sort === TAB_KEYS_DEFAULT.sort && filters.group === TAB_KEYS_DEFAULT.group && filters.show === TAB_KEYS_DEFAULT.show;

/**
 * Cross-key U-4 (SA-W3): the dependent key is the bad filter. With a business
 * picked the tab and its keys go (the business wins, as a pick already drops
 * the tab, M3-FR-1); with no tab, `sort` / `group` / `show` go. Null when the
 * combination is already valid.
 *
 * DF-6 (DF6-FR-8 (a)): "Since it started" with no business: the window is the
 * dependent, bad filter and falls back to This month. Nothing else changes.
 */
export function financeFilterRepair(filters: FinanceFilters): Partial<FinanceFilters> | null {
  if (filters.account === '' && isSinceStart(filters.window)) return { window: FINANCE_DEFAULT_WINDOW };
  if (filters.account !== '' && (filters.tab !== '' || !tabKeysAtDefault(filters))) {
    return { tab: '', ...TAB_KEYS_DEFAULT };
  }
  if (filters.tab === '' && !tabKeysAtDefault(filters)) return { ...TAB_KEYS_DEFAULT };
  return null;
}

/** SA-W4 (a), U-3 read literally: Clear resets every filter and keeps `tab`. */
export const FINANCE_CLEAR_PATCH: Partial<FinanceFilters> = {
  window: FINANCE_DEFAULT_WINDOW,
  account: '',
  ...TAB_KEYS_DEFAULT,
};

/** Clear is enabled while any field it resets is not at its default (SA-W4). */
export function financeCanClear(filters: FinanceFilters): boolean {
  return !windowEquals(filters.window, FINANCE_DEFAULT_WINDOW) || filters.account !== '' || !tabKeysAtDefault(filters);
}

/**
 * SA-W5 (a): the route's own custom-window rules that the shared Window
 * control does not check (SA Q-11), so a window the route would refuse is
 * never applied, never sent and never in the URL. Null for anything else.
 */
export function financeWindowProblem(value: AdminWindowValue, now: Date): string | null {
  if (value.kind !== 'custom' || value.from === null || value.to === null) return null;
  return customRangeProblem(value.from, value.to, now);
}
