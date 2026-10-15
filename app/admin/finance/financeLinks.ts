/**
 * The finance page's links out to the other admin pages (Money M-1, finance
 * health §11D.3 M1-FR-7, SA-Q34 as amended by SA-W56). Pure: no React, no
 * fetch, no `'use client'`.
 *
 * Every link carries the account and the window the finance page is showing,
 * in each target's OWN URL keys:
 *   - Business OS AI Activity and Costs & credits: `range=<preset>` for Today,
 *     7d, 30d and This month (both resolve a preset through the same
 *     `resolveAdminWindow` Finance uses), and `range=custom&from&to` for custom.
 *   - AI cost & usage: `range=today` / `range=this_month` are equal presets
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

/** Activity and Costs: the same preset, or the custom dates. */
function wholeDayWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  if (window.preset === 'custom') {
    params.set('range', 'custom');
    params.set('from', window.from);
    params.set('to', window.to);
  } else {
    params.set('range', window.preset);
  }
}

/** AI cost & usage: equal presets where they exist, otherwise the exact dates (SA-W56). */
function analyticsWindow(params: URLSearchParams, window: FinanceLinkWindow): void {
  if (window.preset === 'today' || window.preset === 'this_month') {
    params.set('range', window.preset);
  } else {
    params.set('range', 'custom');
    params.set('from', window.from);
    params.set('to', window.to);
  }
}

function businessOsAiHref(tab: 'activity' | 'costs', accountId: string, window: FinanceLinkWindow): string {
  const params = new URLSearchParams();
  params.set('tab', tab);
  wholeDayWindow(params, window);
  params.set('account', accountId);
  return `/admin/business-os-llm?${params.toString()}`;
}

export function activityHref(accountId: string, window: FinanceLinkWindow): string {
  return businessOsAiHref('activity', accountId, window);
}

export function costsHref(accountId: string, window: FinanceLinkWindow): string {
  return businessOsAiHref('costs', accountId, window);
}

/** AI cost & usage. `scope` is left out: its default is `bos`. */
export function analyticsHref(accountId: string, window: FinanceLinkWindow): string {
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

/** Section 3's "AI cost & usage" link (CR G-8): the window always, the account when one is picked. */
export function section3AnalyticsHref(accountId: string | null, window: FinanceLinkWindow): string {
  if (accountId !== null) return analyticsHref(accountId, window);
  const params = new URLSearchParams();
  analyticsWindow(params, window);
  return `/admin/analytics?${params.toString()}`;
}
