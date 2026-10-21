'use client';

/**
 * Finance → Plans & subscriptions, the "Converted this month" list (Money
 * MK-5b; KPI restructure review §5.1 F-K5b breakdown, G-2).
 *
 * Each account whose first plan payment above $0 was in the current UTC
 * calendar month: business, plan, date of first payment, and where it came
 * from (the lineage source; "Not recorded" with no lineage row). An account
 * that converted this month and no longer pays is listed with its own chip and
 * is not in F-K5's figure.
 *
 * ONE PAYLOAD: it renders from the finance payload the page already holds, so
 * the tab makes no new request (AC-173). Every figure is the server's; this
 * file only labels it. "At least" when the plan walk was cut off; the
 * section's could-not-load state when a read failed, never an empty list.
 */

import type { FinanceConverted, FinanceConvertedRow } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TH,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import {
  CONVERTED_COLUMNS,
  CONVERTED_EMPTY,
  CONVERTED_PARTIAL,
  CONVERTED_PLAN_UNKNOWN,
  CONVERTED_SOURCE,
  CONVERTED_SOURCE_MISSING,
  CONVERTED_SOURCE_UNKNOWN,
  CONVERTED_STATUS,
  CONVERTED_TITLE,
  convertedCountLine,
  convertedShowing,
  convertedSubtitle,
  NAME_MISSING,
  NAME_UNAVAILABLE,
} from '../financeCopy';
import { atLeast } from '../financeFormat';
import { groupLabel } from './AccountsByPlanSection';
import { FinanceSection } from './FinanceSection';

export const CONVERTED_SECTION_ID = 'converted-this-month';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "October 2026", read from the ISO text of the month's first instant (UTC by construction): no clock, no zone. */
function monthLabel(fromIso: string): string {
  const year = fromIso.slice(0, 4);
  const month = MONTH_NAMES[Number(fromIso.slice(5, 7)) - 1];
  return month ? `${month} ${year}` : fromIso.slice(0, 7);
}

function businessName(row: FinanceConvertedRow): string {
  if (row.nameStatus === 'found' && row.name) return row.name;
  return `${row.nameStatus === 'unavailable' ? NAME_UNAVAILABLE : NAME_MISSING} (${formatShortId(row.accountId)})`;
}

function sourceLabel(row: FinanceConvertedRow): string {
  if (row.sourceStatus === 'unavailable') return CONVERTED_SOURCE_UNKNOWN;
  if (row.sourceStatus === 'missing' || row.source === null) return CONVERTED_SOURCE_MISSING;
  return CONVERTED_SOURCE[row.source];
}

export function ConvertedThisMonthSection({ converted, onRetry }: { converted: FinanceConverted; onRetry: () => void }) {
  // The list is all businesses only; the tab has none with a business picked.
  if (converted.scope !== 'all') return null;
  const exact = converted.status === 'ok';
  const rows = converted.rows ?? [];
  const total = (converted.converted ?? 0) + (converted.stopped ?? 0);

  return (
    <FinanceSection
      id={CONVERTED_SECTION_ID}
      title={CONVERTED_TITLE}
      subtitle={convertedSubtitle(monthLabel(converted.month.from))}
      status={converted.status}
      onRetry={onRetry}
    >
      <div className="space-y-2" data-testid="converted-body">
        {!exact && <AdminNotice testId="converted-notice-partial">{CONVERTED_PARTIAL}</AdminNotice>}
        {rows.length === 0 ? (
          <AdminEmpty testId="converted-empty" message={CONVERTED_EMPTY} />
        ) : (
          <>
            <p className={ADMIN_COUNT_LINE} data-testid="converted-count">
              {convertedCountLine(atLeast(formatCount(converted.converted ?? 0), exact), atLeast(formatCount(converted.stopped ?? 0), exact))}
              {rows.length < total && <> · {convertedShowing(formatCount(rows.length), atLeast(formatCount(total), exact))}</>}
            </p>
            <div className={ADMIN_TABLE_WRAP}>
              <table className={ADMIN_TABLE} aria-label={CONVERTED_TITLE} data-testid="converted-table">
                <thead className={ADMIN_THEAD}>
                  <tr>
                    <th scope="col" className={ADMIN_TH}>{CONVERTED_COLUMNS.business}</th>
                    <th scope="col" className={ADMIN_TH}>{CONVERTED_COLUMNS.plan}</th>
                    <th scope="col" className={ADMIN_TH}>{CONVERTED_COLUMNS.firstPaid}</th>
                    <th scope="col" className={ADMIN_TH}>{CONVERTED_COLUMNS.source}</th>
                    <th scope="col" className={ADMIN_TH}>{CONVERTED_COLUMNS.status}</th>
                  </tr>
                </thead>
                <tbody className={ADMIN_TBODY}>
                  {rows.map((row) => (
                    <tr key={row.accountId} data-testid={`converted-row-${row.accountId}`}>
                      <th scope="row" className={`${ADMIN_TD} font-normal`}>{businessName(row)}</th>
                      <td className={ADMIN_TD}>{row.group === null ? CONVERTED_PLAN_UNKNOWN : groupLabel({ key: row.group, tierLabel: row.tierLabel })}</td>
                      <td className={ADMIN_TD}>{formatUtc(row.firstPaymentAt)}</td>
                      <td className={ADMIN_TD} data-testid="converted-source">{sourceLabel(row)}</td>
                      <td className={ADMIN_TD}>
                        <StatusChip tone={row.payingNow ? 'ok' : 'warn'} testId="converted-status">
                          {row.payingNow ? CONVERTED_STATUS.paying : CONVERTED_STATUS.stopped}
                        </StatusChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </FinanceSection>
  );
}
