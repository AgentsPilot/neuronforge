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
 *     "Costs & credits" tab in Money M-5; since Money MK-3a it is the AI cost
 *     page's Summary & checks tab, `/admin/ai-cost?tab=checks` (SA-6: no
 *     internal link relies on the redirect from the old address).
 *   - AI calls & usage: since Money MK-3b the AI cost page's Calls tab,
 *     `/admin/ai-cost?tab=calls`. Its 7d and 30d are whole UTC days now, as
 *     Finance's (SA-Q-MK3-3), so the window goes out exactly as for Summary &
 *     checks: the same preset, or the custom dates. The old per-page mapping
 *     (7d and 30d as custom dates, because that page's were rolling) is gone.
 *   - Businesses: `status=all` (so a business with no recent sign-in is on the
 *     list) and the one-shot `account` key (SA-Q33, SA-W67). No window.
 *
 * Only the account ID travels, never a name or an email. Paths and keys are
 * literals: this file imports nothing from another admin page (their specs are
 * imported by the contract test only, which parses every href back).
 *
 * DF-6 (DF6-FR-10, E-77, SA-Q95): `since_start` NEVER goes out as
 * `range=since_start`. While its span is at most the targets' own cap
 * (`ADMIN_WINDOW_MAX_DAYS` inclusive days, from the shared presets module, E-83)
 * it goes out as the payload's custom dates; past it, the link carries the
 * account only and the target opens on its own default. Both window helpers
 * switch exhaustively on the choice, so no new choice can fall through.
 */

import type { FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { ADMIN_WINDOW_MAX_DAYS, inclusiveDays } from '@/app/admin/components/adminWindowPresets';

/** The window the payload resolved: inclusive UTC dates and the choice. */
export type FinanceLinkWindow = Pick<FinanceWindowInfo, 'preset' | 'from' | 'to'>;

function setDates(params: URLSearchParams, window: FinanceLinkWindow): void {
  params.set('range', 'custom');
  params.set('from', window.from);
  params.set('to', window.to);
}

/** DF-6 (SA-Q95): a since-start span goes out as dates only while every target accepts it. */
function sinceStartFitsLinks(window: FinanceLinkWindow): boolean {
  return inclusiveDays(window.from, window.to) <= ADMIN_WINDOW_MAX_DAYS;
}

/** Activity and Charge checks: the same preset, or the custom dates. */
function wholeDayWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  switch (window.preset) {
    case 'today':
    case '7d':
    case '30d':
    case 'this_month':
      params.set('range', window.preset);
      return;
    case 'custom':
      setDates(params, window);
      return;
    case 'since_start':
      if (sinceStartFitsLinks(window)) setDates(params, window);
      return;
    default: {
      const unreachable: never = window.preset;
      return unreachable;
    }
  }
}

/**
 * The page that runs the cost report and the Leak check (Money M-5, R-3, R-4):
 * since Money MK-3a the AI cost page, on its Summary & checks tab.
 */
const AI_COST_PATH = '/admin/ai-cost';
const CHECKS_TAB = 'checks';
/** Money MK-3b: the AI cost page's Calls tab (the old AI calls & usage). */
const CALLS_TAB = 'calls';
/** The AI cost page's anchor for the recorded block and the Leak check (MK-3a, A-K3's target). */
const LEAK_ANCHOR = '#costs-leak';

export function activityHref(accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('tab', 'activity');
  wholeDayWindow(params, window);
  params.set('account', accountId);
  return `/admin/business-os-llm?${params.toString()}`;
}

/** AI cost, Summary & checks, for this business on the same window, in that page's own keys (MK-3a). */
export function costsHref(accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('tab', CHECKS_TAB);
  wholeDayWindow(params, window);
  params.set('account', accountId);
  return `${AI_COST_PATH}?${params.toString()}`;
}

/**
 * Money MK-3a (C-7): Section 3's "Recorded above charged" line → the AI cost
 * page's recorded block and Leak check, on the same window, and the business
 * when one is picked. Same keys as `costsHref`.
 */
export function aiCostRecordedHref(accountId: string | null, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('tab', CHECKS_TAB);
  wholeDayWindow(params, window);
  if (accountId !== null) params.set('account', accountId);
  return `${AI_COST_PATH}?${params.toString()}${LEAK_ANCHOR}`;
}

/** An AI cost Calls address (F-5: typed, so the K-1 tile can take it as a cross-page link). */
export type AnalyticsHref = `/admin/ai-cost?${string}`;

/** The Calls tab with the window and, when given, the business. `scope` is left out: its default is `bos`. */
function callsHref(accountId: string | null, window: FinanceLinkWindow): AnalyticsHref {
  const params = new URLSearchParams();
  params.set('tab', CALLS_TAB);
  wholeDayWindow(params, window);
  if (accountId !== null) params.set('account', accountId);
  return `${AI_COST_PATH}?${params.toString()}`;
}

/** AI cost, Calls (the old AI calls & usage), for this business on the same window (MK-3b). */
export function analyticsHref(accountId: string, window: FinanceLinkWindow): AnalyticsHref {
  return callsHref(accountId, window);
}

/** Businesses, with this business's drawer opened once on arrival (SA-Q33, SA-W67). */
export function businessesHref(accountId: string): string {
  const params = new URLSearchParams();
  params.set('status', 'all');
  params.set('account', accountId);
  return `/admin/users?${params.toString()}`;
}

/** Section 3's Calls link (CR G-8; MK-3b: the AI cost page's Calls tab): the window always, the account when one is picked. */
export function section3AnalyticsHref(accountId: string | null, window: FinanceLinkWindow): AnalyticsHref {
  return callsHref(accountId, window);
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
