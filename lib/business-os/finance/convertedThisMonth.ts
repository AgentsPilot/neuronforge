/**
 * Converted this month, the pure rule (Money MK-5b; KPI restructure review
 * §5.1 F-K5b, Q-12, G-1 to G-3; BD-9).
 *
 * An account CONVERTED this month when its first plan payment above $0 (read
 * by the caller, current billing mode only) was paid in the current calendar
 * month in UTC. It is COUNTED when it is also paying now (F-K5's numerator);
 * one that converted this month and no longer pays is LISTED as "converted, no
 * longer paying", never counted. "This month" is always the month of `now`,
 * whatever window the page shows (BD-9, like K-1).
 *
 * PURE: the first payments, the paying set and `now` are passed in. No read,
 * no clock, no mode.
 *
 * @module lib/business-os/finance/convertedThisMonth
 */

import type { FinanceMonthSpan } from './financeTypes';

/** The most rows the list carries; the figure counts every account. */
export const CONVERTED_SHOWN_LIMIT = 100;

/** `[first day of now's UTC month, first day of the next)`, as ISO text. */
export function currentUtcMonth(now: Date): FinanceMonthSpan {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

export interface ConvertedAccount {
  accountId: string;
  firstPaymentAt: string;
  payingNow: boolean;
}

export interface ConvertedResult {
  /** Converted this month AND paying now: the figure. */
  converted: number;
  /** Converted this month and no longer paying: listed only. */
  stopped: number;
  /** Every converted account, newest first payment first, then by id. Not capped. */
  accounts: ConvertedAccount[];
}

/** Within `[from, to)`; an unreadable date is never "this month". */
function inMonth(iso: string, month: FinanceMonthSpan): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at >= Date.parse(month.from) && at < Date.parse(month.to);
}

export function convertedThisMonth(input: {
  firstPayments: ReadonlyArray<{ accountId: string; paidAt: string }>;
  /** Only these accounts are considered (the plan rows the figure is over). */
  accountIds: ReadonlySet<string>;
  payingIds: ReadonlySet<string>;
  month: FinanceMonthSpan;
}): ConvertedResult {
  const accounts: ConvertedAccount[] = [];
  for (const first of input.firstPayments) {
    if (!input.accountIds.has(first.accountId)) continue;
    if (!inMonth(first.paidAt, input.month)) continue;
    accounts.push({ accountId: first.accountId, firstPaymentAt: first.paidAt, payingNow: input.payingIds.has(first.accountId) });
  }
  accounts.sort(
    (a, b) =>
      Date.parse(b.firstPaymentAt) - Date.parse(a.firstPaymentAt) || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0)
  );
  const converted = accounts.filter((a) => a.payingNow).length;
  return { converted, stopped: accounts.length - converted, accounts };
}
