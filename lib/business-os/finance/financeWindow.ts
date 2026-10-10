/**
 * The finance page's windows (finance & business health slice 1a). Pure: the
 * request's one clock (`now`) is passed in.
 *
 * - The selected window: inclusive UTC dates → the half-open instants read.
 *   For a preset the dates are resolved HERE from `now`; client dates are
 *   never used (SA-Q2, SA-W6).
 * - K-1's two spans (SA-Q12): this calendar month to `now`, and the SAME
 *   elapsed span of the previous month, clamped to that month's length.
 *
 * @module lib/business-os/finance/financeWindow
 */

import { resolveAdminWindow } from '@/app/admin/components/adminWindowPresets';
import { CHARGING_CUTOVER_FLOOR_MS } from '@/lib/business-os/credits/aiActivity';
import { windowInstants } from '@/lib/business-os/credits/creditReport';
import type { FinanceWindowChoice } from './financeTypes';

export interface FinanceWindowQuery {
  preset: FinanceWindowChoice;
  /** Used only for `custom` (validated by the route). */
  from?: string | null;
  to?: string | null;
}

export interface ResolvedFinanceWindow {
  preset: FinanceWindowChoice;
  from: string;
  to: string;
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** A half-open span `[from, to)`. Empty when `from === to`. */
export interface FinanceSpan {
  from: Date;
  to: Date;
}

export interface K1Spans {
  current: FinanceSpan;
  previous: FinanceSpan;
  /**
   * True when the previous span starts before charging went live: the
   * comparison has no honest baseline, so K-1 is grey "Not enough history"
   * and the previous span is not read (code, not data).
   */
  previousBeforeCutover: boolean;
}

/** The window the page reads. A custom window must already have passed the route's checks. */
export function resolveFinanceWindow(query: FinanceWindowQuery, now: Date): ResolvedFinanceWindow {
  let dates: { from: string; to: string };
  if (query.preset === 'custom') {
    if (!query.from || !query.to) throw new Error('A custom window needs both dates');
    dates = { from: query.from, to: query.to };
  } else {
    dates = resolveAdminWindow(query.preset, now);
  }
  const { start, end } = windowInstants(dates);
  return { preset: query.preset, from: dates.from, to: dates.to, start, end };
}

/** K-1's spans. `Date.UTC` rolls month −1 back into the previous year. */
export function k1Spans(now: Date): K1Spans {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1);
  const previousStart = Date.UTC(year, month - 1, 1);
  const elapsed = now.getTime() - monthStart;
  const previousLength = monthStart - previousStart;

  return {
    current: { from: new Date(monthStart), to: new Date(now.getTime()) },
    previous: { from: new Date(previousStart), to: new Date(previousStart + Math.min(elapsed, previousLength)) },
    previousBeforeCutover: previousStart < CHARGING_CUTOVER_FLOOR_MS,
  };
}

/** An empty span has nothing to read: its figure is an exact 0 without a query. */
export function isEmptySpan(span: FinanceSpan): boolean {
  return span.to.getTime() <= span.from.getTime();
}
