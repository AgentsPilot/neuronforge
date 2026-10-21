/**
 * The Exchange rates history window (Admin Exchange Rates slice 1d, D-8,
 * §5.6, FR-28 to FR-33; SA §13.6 SQ-25 to SQ-29, SA-1d-2).
 *
 * The Window control above the history table holds an `AdminWindowValue` in
 * the view's own state (never the URL: Finance's always-mounted filter hook
 * owns `range` / `from` / `to` on the tab, SQ-25). The page resolves it at
 * each read with the clock of that moment and sends whole UTC dates `from` /
 * `to` (SQ-27); the route turns them into half-open instants (SQ-28).
 *
 * PURE: no React, no fetch, no `'use client'`. Not in the `layoutFolder`
 * registry (like `changedByText.ts`): it is this page's helper, not a shared
 * layout primitive.
 */

import { resolveWindow, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import {
  HISTORY_DEFAULT_PRESET,
  type HistoryWindowDates,
} from '@/lib/admin/exchangeRates/exchangeRateRules';

/** The window on first open and after a second click on the pressed preset: This month (D-8). */
export const HISTORY_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: HISTORY_DEFAULT_PRESET };

/**
 * The whole UTC dates a window means at `now`. Anything that is not two
 * non-null dates (a half-typed custom range, a value this page never sets)
 * falls back to the default, so a read always carries both dates (the
 * `costsFilters.datesOf` shape).
 */
export function historyWindowDates(value: AdminWindowValue, now: Date): HistoryWindowDates {
  const resolved = resolveWindow(value, now);
  if (resolved.kind === 'dates' && resolved.from !== null && resolved.to !== null) {
    return { from: resolved.from, to: resolved.to };
  }
  const fallback = resolveWindow(HISTORY_DEFAULT_WINDOW, now);
  return fallback.kind === 'dates' && fallback.from !== null && fallback.to !== null
    ? { from: fallback.from, to: fallback.to }
    : { from: '', to: '' };
}

/** The GET's window parameters, `from` and `to`, resolved at `now`. */
export function historyWindowParams(value: AdminWindowValue, now: Date): URLSearchParams {
  const { from, to } = historyWindowDates(value, now);
  return new URLSearchParams({ from, to });
}

/**
 * The period words captions and empty messages use (FR-32), keyed by the
 * window the rows were READ under (SA-1d-2), never the control's current value.
 * One helper, so the overall list and the per-currency view cannot disagree.
 */
export function historyPeriodText(value: AdminWindowValue): string {
  if (value.kind === 'preset') {
    switch (value.preset) {
      case 'today':
        return 'today';
      case '7d':
        return 'in the last 7 days';
      case '30d':
        return 'in the last 30 days';
      case 'this_month':
        return 'this month';
    }
  }
  if (value.kind === 'custom' && value.from !== null && value.to !== null) {
    return `from ${value.from} to ${value.to} (UTC)`;
  }
  return historyPeriodText(HISTORY_DEFAULT_WINDOW);
}
