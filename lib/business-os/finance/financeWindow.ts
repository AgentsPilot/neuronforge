/**
 * The finance page's windows (finance & business health slice 1a). Pure: the
 * request's one clock (`now`) is passed in.
 *
 * - The selected window: inclusive UTC dates → the half-open instants read.
 *   For a preset the dates are resolved HERE from `now`; client dates are
 *   never used (SA-Q2, SA-W6).
 * - DF-6 (§11L, E-75, SA-Q92): `since_start` is two INSTANTS, not whole
 *   days: from the charging cut-over (`CHARGING_CUTOVER_FLOOR_MS`) to `now`.
 *   It uses no plan-row fact and no account clock (DF6-W-4); client dates are
 *   ignored, as for every preset. The route allows it only with a business.
 * - K-1's two spans (SA-Q12): this calendar month to `now`, and the SAME
 *   elapsed span of the previous month, clamped to that month's length.
 *
 * @module lib/business-os/finance/financeWindow
 */

import { resolveAdminWindow, todayUtc } from '@/app/admin/components/adminWindowPresets';
import { CHARGING_CUTOVER_FLOOR_MS } from '@/lib/business-os/credits/aiActivity';
import { windowInstants } from '@/lib/business-os/credits/creditReport';
import type { FinanceWindowChoice } from './financeTypes';

export interface FinanceWindowQuery {
  preset: FinanceWindowChoice;
  /** Used only for `custom` (validated by the route); ignored for every other choice. */
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

/** DF-6 (SA-W-DF6-8): the cut-over's UTC date, computed so the `from` label cannot drift from the constant. */
const CUTOVER_DATE = new Date(CHARGING_CUTOVER_FLOOR_MS).toISOString().slice(0, 10);

/** The window the page reads. A custom window must already have passed the route's checks. */
export function resolveFinanceWindow(query: FinanceWindowQuery, now: Date): ResolvedFinanceWindow {
  if (query.preset === 'since_start') {
    // DF6-W-1 / DF6-W-2: start at the cut-over instant, end at this request's clock (exclusive).
    // Start = the floor, so cutoverClamp gives after_cutover and every margin is computed (AC-258).
    return {
      preset: 'since_start',
      from: CUTOVER_DATE,
      to: todayUtc(now),
      start: new Date(CHARGING_CUTOVER_FLOOR_MS),
      end: new Date(now.getTime()),
    };
  }
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

/**
 * K-1's spans. `Date.UTC` rolls month −1 back into the previous year.
 *
 * MK2-FU-1 (SA-WP-FU SA-Q-FU-1): the CURRENT span ends at the next UTC
 * midnight, the same instant This month's window ends (`windowInstants`), so
 * F-K3 counts exactly what Section 3 and the AI cost page's A-K1 count. No
 * ledger row is dated after the read, so it still means "month to date". The
 * PREVIOUS span (the trend's fairness: the same elapsed time last month) is
 * unchanged.
 */
export function k1Spans(now: Date): K1Spans {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1);
  const previousStart = Date.UTC(year, month - 1, 1);
  const nextMidnight = Date.UTC(year, month, now.getUTCDate() + 1);
  const elapsed = now.getTime() - monthStart;
  const previousLength = monthStart - previousStart;

  return {
    current: { from: new Date(monthStart), to: new Date(nextMidnight) },
    previous: { from: new Date(previousStart), to: new Date(previousStart + Math.min(elapsed, previousLength)) },
    previousBeforeCutover: previousStart < CHARGING_CUTOVER_FLOOR_MS,
  };
}

/** An empty span has nothing to read: its figure is an exact 0 without a query. */
export function isEmptySpan(span: FinanceSpan): boolean {
  return span.to.getTime() <= span.from.getTime();
}
