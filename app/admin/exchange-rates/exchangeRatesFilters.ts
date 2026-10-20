/**
 * The Exchange rates filter (Admin Exchange Rates slice 1c.2; requirement
 * ADMIN_EXCHANGE_RATES_REQUIREMENT.md §5.5.1, FR-14 to FR-16, SQ-8, SQ-9,
 * SA-1c-5). The user's page review asked for "a filter on the top, in the same
 * standard as the rest of the admin pages filters", showing only enabled
 * currencies by default (§3.3 comment 2).
 *
 * Only Show lives in the address bar, through `useAdminFilters` (Admin Layout
 * Standard §5.6), under the key `currencies`: `show` is Finance's Accounts key
 * and `status` its Plans key, and slice 2 puts this view in the same address
 * bar (SQ-8, SA-1c-1). The default `enabled` is never written (U-3) and an
 * unknown value is ignored (U-4). The search text is page state only and is
 * not in this spec at all: a page-only field would still be READ from an
 * inbound link, and free text never travels in the URL (layout standard U-1
 * exception (1)). The Businesses list (`app/admin/users/usersFilters.ts`) is
 * the pattern.
 *
 * Everything here is pure: no React, no fetch. The filter runs in the page
 * over the plain read's rows; the route takes no filter parameter.
 *
 * Module-level on purpose: the hook relies on the spec's identity being stable.
 */

import { formatCount } from '@/app/admin/components/layout/adminFormat';
import { textFilter, type AdminFilterSpec } from '@/app/admin/components/layout/useAdminFilters';
import type { ExchangeRateWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

/** The Show values, in the select's order. `enabled` is the default. */
export const CURRENCY_SHOWS = ['enabled', 'disabled', 'all'] as const;
export type CurrencyShow = (typeof CURRENCY_SHOWS)[number];

export const DEFAULT_CURRENCY_SHOW: CurrencyShow = 'enabled';

/** The select's options and labels (§5.5.1). */
export const CURRENCY_SHOW_OPTIONS: ReadonlyArray<{ value: CurrencyShow; label: string }> = [
  { value: 'enabled', label: 'Enabled only' },
  { value: 'disabled', label: 'Disabled only' },
  { value: 'all', label: 'All' },
];

export function isCurrencyShow(raw: string): raw is CurrencyShow {
  return (CURRENCY_SHOWS as readonly string[]).includes(raw);
}

/** Anything that is not one of the three values reads as the default. */
export function toCurrencyShow(raw: string): CurrencyShow {
  return isCurrencyShow(raw) ? raw : DEFAULT_CURRENCY_SHOW;
}

export interface ExchangeRatesFilters {
  /** Narrowed with `toCurrencyShow` at the use site (the Businesses pattern). */
  currencies: string;
}

export const EXCHANGE_RATES_FILTER_SPEC: AdminFilterSpec<ExchangeRatesFilters> = {
  // `currencies=enabled` is valid and parses to the default; the hook's write then removes it (U-3).
  currencies: textFilter({ key: 'currencies', defaultValue: DEFAULT_CURRENCY_SHOW, isValid: isCurrencyShow }),
};

/** The filtered empty state (SA-1c-5). */
export const NO_MATCHING_CURRENCIES = 'No currencies match these filters.';

/**
 * Show and Search together. Search is trimmed and matched case-insensitively
 * as a literal substring of the code or the name: never a RegExp built from
 * what the admin typed (SA-1c-5). An empty search matches every row.
 */
export function matchesCurrencyFilter(rate: ExchangeRateWire, show: CurrencyShow, search: string): boolean {
  if (show === 'enabled' && !rate.isEnabled) return false;
  if (show === 'disabled' && rate.isEnabled) return false;
  const term = search.trim().toLowerCase();
  if (term === '') return true;
  return rate.currencyCode.toLowerCase().includes(term) || rate.currencyName.toLowerCase().includes(term);
}

/**
 * The rows the table shows, in the payload's order. A held code (switched in
 * this view under the current filter, SQ-9) stays visible even when it no
 * longer matches, so the row and the keyboard focus do not vanish under the
 * admin.
 */
export function visibleRates(
  rates: readonly ExchangeRateWire[],
  show: CurrencyShow,
  search: string,
  held: ReadonlySet<string>
): ExchangeRateWire[] {
  return rates.filter((rate) => matchesCurrencyFilter(rate, show, search) || held.has(rate.currencyCode));
}

/** "Showing N of X currencies": N is what is shown (held rows included), X every currency. */
export function currencyCountLine(shown: number, total: number): string {
  return `Showing ${formatCount(shown)} of ${formatCount(total)} ${total === 1 ? 'currency' : 'currencies'}`;
}
