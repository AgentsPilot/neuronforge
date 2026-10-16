/**
 * The finance page's links out to the other admin pages (Money M-1, finance
 * health §11D.3 M1-FR-7, SA-Q34 as amended by SA-W56). Pure: no React, no
 * fetch, no `'use client'`.
 *
 * Every link carries the account and the window the finance page is showing,
 * in each target's OWN URL keys:
 *   - Business OS AI Activity and Charge checks: `range=<preset>` for Today,
 *     7d, 30d and This month (both resolve a preset through the same
 *     `resolveAdminWindow` Finance uses), and `range=custom&from&to` for custom.
 *     Charge checks (`/admin/finance/charges`) took over the Business OS AI
 *     "Costs & credits" tab in Money M-5, so its links carry no `tab`.
 *   - AI calls & usage: `range=today` / `range=this_month` are equal presets
 *     there; its 7d and 30d are ROLLING (`period=N`), not Finance's whole UTC
 *     days, so 7d, 30d and custom go out as `range=custom` with the payload's
 *     own dates, which that page sends as whole UTC days.
 *   - Businesses: `status=all` (so a business with no recent sign-in is on the
 *     list) and the one-shot `account` key (SA-Q33, SA-W67). No window.
 *
 * Only the account ID travels, never a name or an email. Paths and keys are
 * literals: this file imports nothing from another admin page (their specs are
 * imported by the contract test only, which parses every href back).
 */

import type { FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';

/** The window the payload resolved: inclusive UTC dates and the choice. */
export type FinanceLinkWindow = Pick<FinanceWindowInfo, 'preset' | 'from' | 'to'>;

/** Activity and Charge checks: the same preset, or the custom dates. */
function wholeDayWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  if (window.preset === 'custom') {
    params.set('range', 'custom');
    params.set('from', window.from);
    params.set('to', window.to);
  } else {
    params.set('range', window.preset);
  }
}

/** AI calls & usage: equal presets where they exist, otherwise the exact dates (SA-W56). */
function analyticsWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  if (window.preset === 'today' || window.preset === 'this_month') {
    params.set('range', window.preset);
  } else {
    params.set('range', 'custom');
    params.set('from', window.from);
    params.set('to', window.to);
  }
}

/** The page that runs the cost report and the Leak check (Money M-5, R-3, R-4). */
const CHARGE_CHECKS_PATH = '/admin/finance/charges';

export function activityHref(accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('tab', 'activity');
  wholeDayWindow(params, window);
  params.set('account', accountId);
  return `/admin/business-os-llm?${params.toString()}`;
}

/** Charge checks for this business on the same window, in that page's own keys; no `tab` (M-5 R-3). */
export function costsHref(accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  wholeDayWindow(params, window);
  params.set('account', accountId);
  return `${CHARGE_CHECKS_PATH}?${params.toString()}`;
}

/** An AI calls & usage address (F-5: typed, so the K-1 tile can take it as a cross-page link). */
export type AnalyticsHref = `/admin/analytics?${string}`;

/** AI calls & usage. `scope` is left out: its default is `bos`. */
export function analyticsHref(accountId: string, window: FinanceLinkWindow): AnalyticsHref {
  const params = new URLSearchParams();
  analyticsWindow(params, window);
  params.set('account', accountId);
  return `/admin/analytics?${params.toString()}`;
}

/** Businesses, with this business's drawer opened once on arrival (SA-Q33, SA-W67). */
export function businessesHref(accountId: string): string {
  const params = new URLSearchParams();
  params.set('status', 'all');
  params.set('account', accountId);
  return `/admin/users?${params.toString()}`;
}

/** Section 3's "AI calls & usage" link (CR G-8): the window always, the account when one is picked. */
export function section3AnalyticsHref(accountId: string | null, window: FinanceLinkWindow): AnalyticsHref {
  if (accountId !== null) return analyticsHref(accountId, window);
  const params = new URLSearchParams();
  analyticsWindow(params, window);
  return `/admin/analytics?${params.toString()}`;
}

/** K-1 always measures this calendar month in UTC, whatever the page window is. */
const K1_WINDOW: FinanceLinkWindow = { preset: 'this_month', from: '', to: '' };

/**
 * Finance F-5 (SA-W7 (a), F5-R1): the "Charged AI cost" tile's link to AI calls
 * & usage. It carries the TILE's own period, This month (UTC), and the
 * business when one is picked; never the page window, so the target opens the
 * period the tile measures. Built through Section 3's helper, whose This month
 * is the preset itself (the dates are not used for it).
 */
export function k1AnalyticsHref(accountId: string | null): AnalyticsHref {
  return section3AnalyticsHref(accountId, K1_WINDOW);
}

/**
 * Money M-4 (M4-FR-1, SA-W99): Section 3's "Leak check" link, to the page that
 * runs the Leak check: Charge checks since Money M-5 (R-4; before, the Business
 * OS AI "Costs & credits" tab). No window travels (the Leak check takes at most
 * 7 days); the business does, in that page's own `account` key, when one is
 * picked. Literal keys, so this file still imports only the wire types.
 */
export function leakCheckHref(accountId: string | null): string {
  if (accountId === null) return CHARGE_CHECKS_PATH;
  const params = new URLSearchParams();
  params.set('account', accountId);
  return `${CHARGE_CHECKS_PATH}?${params.toString()}`;
}

/**
 * Slice 6a (M3-FR-7, AC-144): an Accounts tab row → this page's one-account
 * view on the same window. Only the id and the window travel, in this page's
 * own keys (`preset`, `from` / `to` for custom, `accountId`); never `tab`, a
 * sort, a filter or a name. Literal keys, so this file still imports only the
 * wire types.
 */
export function accountViewHref(accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('preset', window.preset);
  if (window.preset === 'custom') {
    params.set('from', window.from);
    params.set('to', window.to);
  }
  params.set('accountId', accountId);
  return `/admin/finance?${params.toString()}`;
}
