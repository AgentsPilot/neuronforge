'use client';

/**
 * One overdue part of the client payment problems block (finance & business
 * health slice 2b, S2-FR-17, S2-FR-18): overdue invoices, or overdue plan
 * instalments. One component, two uses; the words come in through `copy`.
 *
 * MONEY: every amount is the FULL invoice or instalment amount, never what is
 * still owed (S2-F7), and every money cell names its currency (`formatMoney`).
 * Nothing here adds two amounts, and nothing is a total across currencies.
 * The per-currency lines are sorted by currency; the table of rows keeps its
 * date order, oldest first, which ranks no money (SA-W30).
 *
 * DATES: a due date is date-only text, shown through `formatUtcDate`, never
 * through a Date (AC-74). The status chip comes from the stored status and
 * the date, never from a threshold.
 */

import type { FinanceDueFigures, FinanceDueLine, FinanceDueRow } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount, formatUtcDate } from '@/app/admin/components/layout/adminFormat';
import {
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
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
  NAME_UNKNOWN_BUSINESS,
  OVERDUE_AMONG_READ,
  OVERDUE_AMOUNT,
  OVERDUE_BUSINESS,
  OVERDUE_BUSINESSES,
  OVERDUE_CURRENCY,
  OVERDUE_DAYS,
  OVERDUE_DUE_DATE,
  OVERDUE_EXCLUDES_UNREADABLE,
  OVERDUE_MARKED,
  OVERDUE_MARKED_CHIP,
  OVERDUE_OLDEST_DUE,
  OVERDUE_SHOWING,
  OVERDUE_STATUS,
  OVERDUE_TOTAL,
  OVERDUE_UNREADABLE,
  PROBLEMS_UNKNOWN,
  PROBLEMS_UNKNOWN_CURRENCY,
  type OverdueCopy,
} from '../financeCopy';
import { atLeast, formatMoney } from '../financeFormat';

const NOTE = 'text-[11px] text-slate-400';

function businessName(row: FinanceDueRow): string {
  switch (row.nameStatus) {
    case 'found':
      return row.name ?? NAME_MISSING;
    case 'platform':
      return NAME_PLATFORM;
    case 'unknown_business':
      return NAME_UNKNOWN_BUSINESS;
    case 'unavailable':
      return `${NAME_UNAVAILABLE} (${formatShortId(row.accountId)})`;
    default:
      return `${NAME_MISSING} (${formatShortId(row.accountId)})`;
  }
}

export function OverdueTable({ f, copy, testId }: { f: FinanceDueFigures; copy: OverdueCopy; testId: string }) {
  if (f.empty) return <AdminEmpty testId={`${testId}-empty`} message={copy.empty} />;

  const count = (value: number) => atLeast(formatCount(value), f.exact);
  const currencyLabel = (currency: string | null) => currency ?? PROBLEMS_UNKNOWN_CURRENCY;

  return (
    <div className="space-y-2" data-testid={`${testId}-body`}>
      {!f.exact && <AdminNotice testId={`${testId}-notice-ceiling`}>{copy.ceilingNotice}</AdminNotice>}
      {f.unreadableAmounts > 0 && <AdminNotice testId={`${testId}-notice-unreadable`}>{OVERDUE_UNREADABLE(f.unreadableAmounts)}</AdminNotice>}

      <p className="text-sm text-slate-300" data-testid={`${testId}-total`}>
        {OVERDUE_TOTAL(count(f.total), count(f.businesses))}
      </p>

      {/* ── Per currency: one line each, never a total across them ── */}
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={copy.perCurrency} data-testid={`${testId}-lines`}>
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{OVERDUE_CURRENCY}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{OVERDUE_MARKED}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{copy.pastDueColumn}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{copy.amountColumn}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{OVERDUE_BUSINESSES}</th>
              <th scope="col" className={ADMIN_TH}>{OVERDUE_OLDEST_DUE}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {f.lines.map((line: FinanceDueLine) => (
              <tr key={line.currency ?? 'unknown'} data-testid={`${testId}-line-${line.currency ?? 'unknown'}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal`}>
                  {currencyLabel(line.currency)}
                  {line.unreadable > 0 && <span className={`ml-1 ${NOTE}`}>({OVERDUE_EXCLUDES_UNREADABLE(line.unreadable)})</span>}
                </th>
                <td className={ADMIN_TD_NUM}>{count(line.marked)}</td>
                <td className={ADMIN_TD_NUM}>{count(line.pastDue)}</td>
                <td className={ADMIN_TD_NUM} data-money="amount">{atLeast(formatMoney(line.amount, line.currency), line.amountExact)}</td>
                <td className={ADMIN_TD_NUM}>{count(line.businesses)}</td>
                <td className={ADMIN_TD} data-due-date="">{line.oldestDueDate === null ? PROBLEMS_UNKNOWN : formatUtcDate(line.oldestDueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={NOTE} data-testid={`${testId}-amount-note`}>{copy.amountNote}</p>

      {/* ── The oldest rows, date order (SA-W30) ── */}
      {f.rows.length > 0 && (
        <div className="space-y-1">
          <p className={ADMIN_COUNT_LINE} data-testid={`${testId}-showing`}>
            {OVERDUE_SHOWING(f.rows.length, f.rowsTotal)}
            {!f.exact && <span className="ml-1">· {OVERDUE_AMONG_READ}</span>}
          </p>
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} aria-label={copy.oldest} data-testid={`${testId}-rows`}>
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{OVERDUE_BUSINESS}</th>
                  <th scope="col" className={ADMIN_TH}>{copy.idColumn}</th>
                  <th scope="col" className={ADMIN_TH}>{OVERDUE_DUE_DATE}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{OVERDUE_DAYS}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{OVERDUE_AMOUNT}</th>
                  <th scope="col" className={ADMIN_TH}>{OVERDUE_STATUS}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.rows.map((row) => (
                  <tr key={row.id} data-testid={`${testId}-row-${row.id}`}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>{businessName(row)}</th>
                    <td className={ADMIN_TD}>
                      <span className={ADMIN_TD_ID} title={row.id}>{formatShortId(row.id)}</span>
                    </td>
                    <td className={ADMIN_TD} data-due-date="">{row.dueDate === null ? PROBLEMS_UNKNOWN : formatUtcDate(row.dueDate)}</td>
                    <td className={ADMIN_TD_NUM}>{row.daysPastDue === null ? PROBLEMS_UNKNOWN : formatCount(row.daysPastDue)}</td>
                    <td className={ADMIN_TD_NUM} data-money={row.amount === null ? undefined : 'amount'}>
                      {row.amount === null ? PROBLEMS_UNKNOWN : formatMoney(row.amount, row.currency)}
                    </td>
                    <td className={ADMIN_TD}>
                      <StatusChip tone="warn">{row.kind === 'marked' ? OVERDUE_MARKED_CHIP : copy.pastDueChip}</StatusChip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
