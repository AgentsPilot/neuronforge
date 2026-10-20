'use client';

/**
 * Recent rate changes (Admin Exchange Rates slice 1a, SA-R4; slice 1c.1,
 * FR-18 / FR-19), written only by the database trigger on a rate change:
 * enable / disable changes are not here (the audit trail is their record).
 *
 * Two views, both at most HISTORY_LIMIT (10) rows inside the history window,
 * newest first, selected by the server (slice 1d, FR-29 / FR-30):
 *   - every currency: `payload.history` from the plain GET;
 *   - one currency: that currency's own read (`GET ?currency=XXX`, SQ-12),
 *     loaded by the view, which passes its rows, loading and error here.
 * The page shows exactly the rows it receives: nothing is trimmed here.
 *
 * The Window control (slice 1d, D-8, FR-28, SA-1d-5): the shared `DatePresets`
 * (Today, 7 days, 30 days, This month, Custom; both dates required), between
 * the heading row and the body, in every state (loading, error, empty, rows),
 * so an admin can always widen an empty window. Both views render it in the
 * same slot, so it is one control across opening and closing a panel. The
 * view owns its value; nothing here reads or writes the URL.
 *
 * Caption (SA Q-2, amends SA-1c-4; slice 1d, FR-32): "The newest
 * {HISTORY_LIMIT} changes {period}" only when the list reached the cap, else
 * "{n} change(s) {period}, newest first"; the one-currency view prefixes
 * "{CODE}: ". The cap comes from HISTORY_LIMIT. The period names the window
 * the rows were READ under (`rowsWindow`, SA-1d-2), never the control's
 * current value. Empty: "No rate changes in this period." / "No rate changes
 * for {CODE} in this period." (FR-33).
 *
 * Rates as stored strings, dates in UTC, the editor as the server's label
 * (name, else email, else "Unknown user"; the short id when the name lookup
 * failed), with the editor id as hover text. No Reason column: the column
 * exists but nothing writes it (SA §10 ruling 4). No percentage change:
 * nothing on this page does arithmetic on a rate (D-5). No fetch here.
 */

import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { DatePresets } from '@/app/admin/components/layout/DatePresets';
import {
  ADMIN_BUTTON,
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { HISTORY_LIMIT, type ExchangeRateHistoryWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

// Relative on purpose, like the view's imports: the alias path would spell the
// page route, which the G-4 guard (redundantPages.source.guard) refuses.
import { historyPeriodText } from '../historyWindow';
import { changedByText } from './changedByText';

/** The count line (SA Q-2; slice 1d, FR-32: `period` from `historyPeriodText`). Exported for the render test. */
export function historyCaption(count: number, currencyCode: string | null, period: string): string {
  const text =
    count === HISTORY_LIMIT
      ? `The newest ${HISTORY_LIMIT} changes ${period}`
      : `${count} ${count === 1 ? 'change' : 'changes'} ${period}, newest first`;
  return currencyCode ? `${currencyCode}: ${text}` : text;
}

export interface RateHistoryTableProps {
  /** The rows to show: the overall list, or the selected currency's own read. */
  rows: ExchangeRateHistoryWire[];
  /** The selected currency (null: every currency). */
  currencyCode: string | null;
  /** The selected currency's read is in flight and nothing is loaded yet. */
  loading?: boolean;
  /** Any read of the selected currency is in flight, a re-read over shown rows included (`aria-busy`). */
  busy?: boolean;
  /** The selected currency's read failed: shown here, inside the panel only. */
  error?: string | null;
  onRetry?: () => void;
  onShowAll: () => void;
  /** The applied history window: the control's value (slice 1d). */
  window: AdminWindowValue;
  /** Where a second click on the pressed preset goes back to: This month. */
  defaultWindow: AdminWindowValue;
  onWindowChange: (next: AdminWindowValue) => void;
  /** The window `rows` were read under: the caption's period (SA-1d-2). */
  rowsWindow: AdminWindowValue;
}

export function RateHistoryTable({
  rows,
  currencyCode,
  loading = false,
  busy = false,
  error = null,
  onRetry,
  onShowAll,
  window: windowValue,
  defaultWindow,
  onWindowChange,
  rowsWindow,
}: RateHistoryTableProps) {
  // No count line while loading, on an error, or over the empty state (which says it all).
  const showCount = !loading && !error && rows.length > 0;
  const period = historyPeriodText(rowsWindow);

  return (
    <div className="space-y-3" data-testid="rate-history" aria-busy={loading || busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">Recent rate changes</h2>
        <div className="flex items-center gap-3">
          {showCount && (
            <span className={ADMIN_COUNT_LINE} data-testid="rate-history-count">
              {historyCaption(rows.length, currencyCode, period)}
            </span>
          )}
          {currencyCode && (
            <button type="button" className={ADMIN_BUTTON} onClick={onShowAll}>
              Show all currencies
            </button>
          )}
        </div>
      </div>

      {/* SA-1d-5: the Window control, in every state, above the body. */}
      <DatePresets value={windowValue} defaultValue={defaultWindow} onChange={onWindowChange} requireBothDates />

      {error ? (
        <AdminError message={error} testId="rate-history-error" onRetry={onRetry} />
      ) : loading ? (
        <AdminLoading what={currencyCode ? `the ${currencyCode} rate changes` : 'the rate changes'} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          testId="rate-history-empty"
          message={
            currencyCode ? `No rate changes for ${currencyCode} in this period.` : 'No rate changes in this period.'
          }
        />
      ) : (
        <div className={ADMIN_TABLE_WRAP}>
          <table className={ADMIN_TABLE} aria-label="Recent rate changes">
            <thead className={ADMIN_THEAD}>
              <tr>
                <th scope="col" className={ADMIN_TH}>Currency</th>
                <th scope="col" className={ADMIN_TH_NUM}>Old rate</th>
                <th scope="col" className={ADMIN_TH_NUM}>New rate</th>
                <th scope="col" className={ADMIN_TH}>Changed at</th>
                <th scope="col" className={ADMIN_TH}>Changed by</th>
              </tr>
            </thead>
            <tbody className={ADMIN_TBODY}>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={ADMIN_TD}>
                    <span className="font-semibold text-white">{row.currencyCode}</span>
                  </td>
                  <td className={ADMIN_TD_NUM}>
                    <span className="font-mono">{row.oldRate ?? '—'}</span>
                  </td>
                  <td className={ADMIN_TD_NUM}>
                    <span className="font-mono">{row.newRate}</span>
                  </td>
                  <td className={ADMIN_TD}>{formatUtc(row.changedAt)}</td>
                  <td className={ADMIN_TD}>
                    <span
                      className={row.changedByLabel ? undefined : ADMIN_TD_ID}
                      title={row.changedBy ?? undefined}
                      data-testid="rate-history-changed-by"
                    >
                      {changedByText(row)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
