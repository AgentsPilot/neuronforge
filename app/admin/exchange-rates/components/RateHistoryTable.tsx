'use client';

/**
 * The newest 50 rate changes (Admin Exchange Rates slice 1a, SA-R4), written
 * only by the database trigger on a rate change: enable / disable changes are
 * not here (the audit trail is their record). Rates as stored strings, dates
 * in UTC, the editor as a short id. No Reason column: the column exists but
 * nothing writes it (SA §10 ruling 4). No percentage change: nothing on this
 * page does arithmetic on a rate. No fetch here.
 */

import { AdminEmpty } from '@/app/admin/components/layout/AdminStates';
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
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import type { ExchangeRateHistoryWire } from '@/lib/admin/exchangeRates/exchangeRateRules';

export interface RateHistoryTableProps {
  history: ExchangeRateHistoryWire[];
  /** Only this currency's rows (null: all). */
  currencyCode: string | null;
  onShowAll: () => void;
}

export function RateHistoryTable({ history, currencyCode, onShowAll }: RateHistoryTableProps) {
  const rows = currencyCode ? history.filter((row) => row.currencyCode === currencyCode) : history;

  return (
    <div className="space-y-3" data-testid="rate-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">Recent rate changes</h2>
        <div className="flex items-center gap-3">
          <span className={ADMIN_COUNT_LINE}>
            {currencyCode ? `${currencyCode}: ${rows.length} of the newest ${history.length}` : `The newest ${history.length}`}
          </span>
          {currencyCode && (
            <button type="button" className={ADMIN_BUTTON} onClick={onShowAll}>
              Show all currencies
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
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
                    <span className={ADMIN_TD_ID} title={row.changedBy ?? undefined}>
                      {formatShortId(row.changedBy)}
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
