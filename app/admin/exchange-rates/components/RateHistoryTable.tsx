'use client';

/**
 * Recent rate changes (Admin Exchange Rates slice 1a, SA-R4; slice 1c.1,
 * FR-18 / FR-19), written only by the database trigger on a rate change:
 * enable / disable changes are not here (the audit trail is their record).
 *
 * Two views, both at most HISTORY_LIMIT (10) rows, newest first:
 *   - every currency: `payload.history` from the plain GET;
 *   - one currency: that currency's own read (`GET ?currency=XXX`, SQ-12),
 *     loaded by the view, which passes its rows, loading and error here.
 *
 * Caption (SA Q-2, amends SA-1c-4): "The newest {HISTORY_LIMIT} changes" only
 * when the list reached the cap, else "{n} change(s), newest first"; the
 * one-currency view prefixes "{CODE}: ". The cap comes from HISTORY_LIMIT.
 *
 * Rates as stored strings, dates in UTC, the editor as the server's label
 * (name, else email, else "Unknown user"; the short id when the name lookup
 * failed), with the editor id as hover text. No Reason column: the column
 * exists but nothing writes it (SA §10 ruling 4). No percentage change:
 * nothing on this page does arithmetic on a rate (D-5). No fetch here.
 */

import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
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

import { changedByText } from './changedByText';

/** The count line (SA Q-2). Exported for the render test. */
export function historyCaption(count: number, currencyCode: string | null): string {
  const text =
    count === HISTORY_LIMIT
      ? `The newest ${HISTORY_LIMIT} changes`
      : `${count} ${count === 1 ? 'change' : 'changes'}, newest first`;
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
}

export function RateHistoryTable({
  rows,
  currencyCode,
  loading = false,
  busy = false,
  error = null,
  onRetry,
  onShowAll,
}: RateHistoryTableProps) {
  // No count line while loading, on an error, or over the empty state (which says it all).
  const showCount = !loading && !error && rows.length > 0;

  return (
    <div className="space-y-3" data-testid="rate-history" aria-busy={loading || busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">Recent rate changes</h2>
        <div className="flex items-center gap-3">
          {showCount && (
            <span className={ADMIN_COUNT_LINE} data-testid="rate-history-count">
              {historyCaption(rows.length, currencyCode)}
            </span>
          )}
          {currencyCode && (
            <button type="button" className={ADMIN_BUTTON} onClick={onShowAll}>
              Show all currencies
            </button>
          )}
        </div>
      </div>

      {error ? (
        <AdminError message={error} testId="rate-history-error" onRetry={onRetry} />
      ) : loading ? (
        <AdminLoading what={currencyCode ? `the ${currencyCode} rate changes` : 'the rate changes'} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          testId="rate-history-empty"
          message={currencyCode ? `No recent rate changes for ${currencyCode}.` : 'No rate changes recorded yet.'}
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
