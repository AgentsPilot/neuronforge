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
 */

import { useState } from 'react';

import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
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
  HISTORY_CREDITS,
  HISTORY_DATE,
  HISTORY_HIDE,
  HISTORY_NO_LONGER_CONFIGURED,
  HISTORY_NO_SNAPSHOT,
  HISTORY_NONE_YET,
  HISTORY_NOT_AVAILABLE,
  HISTORY_NOT_INSTALLED,
  HISTORY_NOT_RECORDED,
  HISTORY_PLAN_MIX,
  HISTORY_SHOW,
  HISTORY_SUBTITLE,
  HISTORY_TITLE,
  HISTORY_WEEKLY,
  historyNoneInWindow,
  historyStartsOn,
} from '../financeCopy';
import { formatCount, formatCredits } from '../financeFormat';
import type { FinanceQuery } from '../financeUrl';
import { serialiseHistoryQuery } from '../historyUrl';
import { HISTORY_WHAT, useFinanceHistory } from '../useFinanceHistory';
import { groupLabel } from './AccountsByPlanSection';
import { FinanceSection } from './FinanceSection';

const NOTE = 'text-xs text-slate-400';
const BUTTON =
  'inline-flex items-center rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';

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

function HistoryTableView({ caption, table, testId }: { caption: string; table: HistoryTable; testId: string }) {
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

export function HistoryBlock({ query }: { query: Pick<FinanceQuery, 'preset' | 'from' | 'to'> }) {
  const [open, setOpen] = useState(false);
  const { view, loading, error, reload } = useFinanceHistory(serialiseHistoryQuery(query), open);
  const ready = open && !loading && !error && view !== null && view.state !== 'not_installed';

  return (
    <FinanceSection
      id="history"
      title={HISTORY_TITLE}
      subtitle={HISTORY_SUBTITLE}
      // Always 'ok' to the shell: a failed read is the block's own AdminError (HS-FR-16), and the
      // chip shows only once a view has been read (SA-W-8.3-2).
      status="ok"
      onRetry={reload}
      statusChip={ready}
    >
      <div className="space-y-3">
        <button
          type="button"
          className={BUTTON}
          aria-expanded={open}
          aria-controls="history-body"
          onClick={() => setOpen((was) => !was)}
          data-testid="history-toggle"
        >
          {open ? HISTORY_HIDE : HISTORY_SHOW}
        </button>
        {open && (
          <div id="history-body" className="space-y-3" data-testid="history-body">
            {loading && !view && <AdminLoading what={HISTORY_WHAT} />}
            {error && <AdminError message={error} testId="history-error" onRetry={reload} />}
            {!error && view?.state === 'not_installed' && <AdminNotice testId="history-not-installed">{HISTORY_NOT_INSTALLED}</AdminNotice>}
            {!error && view && view.state !== 'not_installed' && (
              <>
                <p className="text-sm text-slate-200" data-testid="history-start-line">
                  {view.state === 'no_history'
                    ? HISTORY_NONE_YET
                    : view.state === 'none_in_window'
                      ? historyNoneInWindow(view.firstSnapshotDate ?? '')
                      : historyStartsOn(view.firstSnapshotDate ?? '')}
                </p>
                {view.state === 'ready' && (
                  <>
                    {view.weekly && (
                      <p className={NOTE} data-testid="history-weekly">
                        {HISTORY_WEEKLY}
                      </p>
                    )}
                    <HistoryTableView caption={HISTORY_PLAN_MIX} table={view.planMix} testId="history-plan-mix" />
                    <HistoryTableView caption={HISTORY_CREDITS} table={view.credits} testId="history-credits" />
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </FinanceSection>
  );
}
