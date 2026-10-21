'use client';

/**
 * The Finance History block (slice 8.3, §11M.8 HS-FR-11 to HS-FR-16; E-85,
 * E-99, E-100, E-101).
 *
 * CLOSED ON EVERY LOAD (E-85 / S8-F1): nothing is requested until the admin
 * presses "Show history", so the page still sends exactly one request on load
 * (AC-173). The open state is local, never a URL key, so no filter or request
 * pin moves.
 *
 * FORMAT ONLY (E-99): the server sends the points, the gaps, the cells and the
 * change lines; this file maps them to words and numbers, and never sorts,
 * filters, folds or does date arithmetic. Credits are units, never money.
 *
 * With a business picked, `HistoryAllBusinessesLine` is shown instead: one
 * line, no button, no request (HS-FR-11).
 *
 * Money MK-7 (KPI restructure review §6 item 13): the block is SPLIT, so each
 * trend sits under its KPI (`HistoryTrends.tsx`: the provider and the two
 * trends). This file keeps the formatting (the table, E-99) and the
 * all-businesses line; the one-frame History section is gone.
 */

import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import type { HistoryCell, HistoryChange, HistoryColumn, HistoryTable } from '@/lib/business-os/finance/historyView';

import {
  HISTORY_ALL_BUSINESSES_ONLY,
  HISTORY_CHANGE,
  HISTORY_COLUMN_LABELS,
  HISTORY_DATE,
  HISTORY_NO_LONGER_CONFIGURED,
  HISTORY_NO_SNAPSHOT,
  HISTORY_NOT_AVAILABLE,
  HISTORY_NOT_RECORDED,
} from '../financeCopy';
import { formatCount, formatCredits } from '../financeFormat';
import { groupLabel } from './AccountsByPlanSection';

const NOTE = 'text-xs text-slate-400';

function columnLabel(column: HistoryColumn): string {
  if (column.id === 'group') {
    const label = groupLabel({ key: column.key, tierLabel: column.tierLabel });
    return column.noLongerConfigured ? `${column.key} ${HISTORY_NO_LONGER_CONFIGURED}` : label;
  }
  return HISTORY_COLUMN_LABELS[column.id];
}

const isCredits = (column: HistoryColumn) => column.id !== 'group' && column.unit === 'credits';
const formatValue = (column: HistoryColumn, value: number) => (isCredits(column) ? formatCredits(value) : formatCount(value));

function cellText(column: HistoryColumn, cell: HistoryCell): string {
  return cell.kind === 'value' ? formatValue(column, cell.value) : HISTORY_NOT_RECORDED;
}

function changeText(column: HistoryColumn, change: HistoryChange): string {
  if (change.kind !== 'value') return HISTORY_NOT_AVAILABLE;
  const sign = change.value > 0 ? '+' : '';
  return `${sign}${formatValue(column, change.value)}`;
}

export function HistoryTableView({ caption, table, testId }: { caption: string; table: HistoryTable; testId: string }) {
  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} data-testid={testId}>
        <caption className="px-3 py-2 text-left text-sm font-semibold text-white">{caption}</caption>
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>
              {HISTORY_DATE}
            </th>
            {table.columns.map((column, i) => (
              <th key={i} scope="col" className={ADMIN_TH_NUM}>
                {columnLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {table.points.map((point) => (
            <tr key={point.date} data-testid={`${testId}-row-${point.date}`}>
              <th scope="row" className={ADMIN_TD}>
                {point.date}
              </th>
              {point.kind === 'no_snapshot' ? (
                <td className={ADMIN_TD} colSpan={table.columns.length}>
                  {HISTORY_NO_SNAPSHOT}
                </td>
              ) : (
                point.cells.map((cell, i) => (
                  <td key={i} className={ADMIN_TD_NUM}>
                    {cellText(table.columns[i], cell)}
                  </td>
                ))
              )}
            </tr>
          ))}
          <tr data-testid={`${testId}-change`}>
            <th scope="row" className={ADMIN_TD}>
              {HISTORY_CHANGE}
            </th>
            {table.change.map((change, i) => (
              <td key={i} className={ADMIN_TD_NUM}>
                {changeText(table.columns[i], change)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** With a business picked: the one line, nothing else (HS-FR-11, L-161). */
export function HistoryAllBusinessesLine() {
  return (
    <p className={NOTE} data-testid="history-all-businesses-only">
      {HISTORY_ALL_BUSINESSES_ONLY}
    </p>
  );
}
