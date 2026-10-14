'use client';

/**
 * The plans part of "Our revenue" (finance & business health slice 5a,
 * §11D.4 M2-FR-1 to M2-FR-4, M2-FR-8, M2-W-3 to M2-W-8).
 *
 * MONEY: every figure arrives per currency, already divided by 100 once from
 * an exact integer sum (tax included). This component never adds or subtracts
 * money (SA-WR-18) and never shows a total across currencies (BD-12): every
 * money cell names its currency (`formatMoney`). The plans part and the boosts
 * part are never one figure here (M2-FR-1); their per-currency total is K-5's
 * and the account summary's, from the server.
 *
 * HONESTY: "At least" on a line that was cut off or left an unreadable invoice
 * out; "Could not load" when the read failed; an empty window says so in words,
 * never "0.00" (M2-FR-8). Every timestamp goes through the shared `formatUtc`
 * (S5-F1, E-33); a period that was not stored says "Not recorded", never a dash
 * (SA-W64). No mode wording (BD-14, BD-20).
 */

import type { FinancePlanAccountRow, FinancePlanLine, FinancePlanRevenue } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import {
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
  REVENUE_CURRENCY,
  REVENUE_EXCLUDES_UNREADABLE,
  REVENUE_PLANS_BUSINESS,
  REVENUE_PLANS_BUSINESSES,
  REVENUE_PLANS_BY_BUSINESS,
  REVENUE_PLANS_DELETED_NONE,
  REVENUE_PLANS_EMPTY,
  REVENUE_PLANS_FAILED,
  REVENUE_PLANS_LIST,
  REVENUE_PLANS_NOT_LISTED,
  REVENUE_PLANS_NOTICE_CUT,
  REVENUE_PLANS_NOTICE_UNREADABLE,
  REVENUE_PLANS_OTHER_KIND,
  REVENUE_PLANS_PAID_AT,
  REVENUE_PLANS_PAYMENTS,
  REVENUE_PLANS_PAYMENTS_NOT_LISTED,
  REVENUE_PLANS_PER_CURRENCY,
  REVENUE_PLANS_PERIOD,
  REVENUE_PLANS_PERIOD_NOT_RECORDED,
  REVENUE_PLANS_PLAN,
  REVENUE_PLANS_RECEIVED,
  REVENUE_PLANS_RECEIVED_SHORT,
  REVENUE_PLANS_REFUNDS_NOTE,
  REVENUE_PLANS_UNKNOWN_PLAN,
  REVENUE_PLANS_ZERO_NOTE,
  REVENUE_TAX,
  revenuePlansDeletedLine,
  revenuePlansPeriod,
  TAKINGS_UNKNOWN_CURRENCY,
} from '../financeCopy';
import { atLeast, formatMoney } from '../financeFormat';

const NOTE = 'text-[11px] text-slate-400';
const SUBHEAD = 'text-sm font-medium text-slate-200';

const currencyLabel = (currency: string | null) => currency ?? TAKINGS_UNKNOWN_CURRENCY;

function nameOf(row: FinancePlanAccountRow): string {
  switch (row.nameStatus) {
    case 'found':
      return row.name ?? NAME_MISSING;
    case 'platform':
      return NAME_PLATFORM;
    case 'unavailable':
      return `${NAME_UNAVAILABLE} (${formatShortId(row.accountId)})`;
    default:
      return `${NAME_MISSING} (${formatShortId(row.accountId)})`;
  }
}

/** A stored instant in UTC, or "Not recorded" (SA-W64): never a dash. */
const when = (iso: string | null): string => (iso === null ? REVENUE_PLANS_PERIOD_NOT_RECORDED : formatUtc(iso));

export function PlanRevenuePart({ plans }: { plans: FinancePlanRevenue }) {
  if (plans.status === 'unknown' || plans.lines === null || plans.notes === null) {
    return (
      <div className="space-y-2" data-testid="revenue-plans">
        <p className="text-sm text-slate-300" data-testid="revenue-plans-failed">
          {REVENUE_PLANS_FAILED}
        </p>
        <p className={NOTE} data-testid="revenue-plans-refunds-note">{REVENUE_PLANS_REFUNDS_NOTE}</p>
      </div>
    );
  }
  const notes = plans.notes;
  return (
    <div className="space-y-3" data-testid="revenue-plans" data-status={plans.status}>
      {!notes.exact && <AdminNotice testId="revenue-plans-notice-cut">{REVENUE_PLANS_NOTICE_CUT}</AdminNotice>}
      {notes.unreadable > 0 && (
        <AdminNotice testId="revenue-plans-notice-unreadable">{REVENUE_PLANS_NOTICE_UNREADABLE(notes.unreadable)}</AdminNotice>
      )}
      {notes.otherKind > 0 && (
        <AdminNotice testId="revenue-plans-notice-other-kind">{REVENUE_PLANS_OTHER_KIND(notes.otherKind)}</AdminNotice>
      )}

      {notes.empty ? (
        <AdminEmpty testId="revenue-plans-empty" message={REVENUE_PLANS_EMPTY} />
      ) : (
        <>
          <PlanLinesTable lines={plans.lines} />
          {plans.scope === 'all' && plans.accounts !== null && (
            <ByBusinessTable rows={plans.accounts} total={plans.accountsTotal ?? plans.accounts.length} />
          )}
          {plans.scope === 'one' && plans.payments !== null && (
            <PaymentList plans={plans} />
          )}
        </>
      )}

      {plans.deletedAccounts !== null && (
        <div data-testid="revenue-plans-deleted">
          {plans.deletedAccounts.length === 0 ? (
            <p className={NOTE}>{REVENUE_PLANS_DELETED_NONE}</p>
          ) : (
            plans.deletedAccounts.map((line) => (
              <p key={line.currency ?? 'unknown'} className="text-sm text-slate-300" data-testid={`revenue-plans-deleted-${line.currency ?? 'unknown'}`}>
                {revenuePlansDeletedLine(line.payments, atLeast(formatMoney(line.received, line.currency), line.exact))}
              </p>
            ))
          )}
        </div>
      )}

      {notes.zeroAmountInvoices > 0 && (
        <p className={NOTE} data-testid="revenue-plans-zero-note">{REVENUE_PLANS_ZERO_NOTE(notes.zeroAmountInvoices)}</p>
      )}
      <p className={NOTE} data-testid="revenue-plans-refunds-note">{REVENUE_PLANS_REFUNDS_NOTE}</p>
    </div>
  );
}

function PlanLinesTable({ lines }: { lines: FinancePlanLine[] }) {
  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} aria-label={REVENUE_PLANS_PER_CURRENCY} data-testid="revenue-plans-lines">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_PAYMENTS}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_RECEIVED}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_TAX}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_BUSINESSES}</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {lines.map((line) => (
            <tr key={line.currency ?? 'unknown'} data-testid={`revenue-plans-line-${line.currency ?? 'unknown'}`}>
              <th scope="row" className={`${ADMIN_TD} font-normal`}>
                {currencyLabel(line.currency)}
                {line.unreadable > 0 && <span className={`ml-1 ${NOTE}`}>({REVENUE_EXCLUDES_UNREADABLE(line.unreadable)})</span>}
              </th>
              <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.payments), line.exact)}</td>
              <td className={ADMIN_TD_NUM} data-money="received">{atLeast(formatMoney(line.received, line.currency), line.exact)}</td>
              <td className={ADMIN_TD_NUM} data-money="tax">{atLeast(formatMoney(line.tax, line.currency), line.exact)}</td>
              <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.businesses), line.exact)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByBusinessTable({ rows, total }: { rows: FinancePlanAccountRow[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className={SUBHEAD}>{REVENUE_PLANS_BY_BUSINESS}</p>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={REVENUE_PLANS_BY_BUSINESS} data-testid="revenue-plans-accounts">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{REVENUE_PLANS_BUSINESS}</th>
              <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_PAYMENTS}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_RECEIVED_SHORT}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {rows.map((row) => (
              <tr key={`${row.accountId}:${row.currency ?? 'unknown'}`} data-testid={`revenue-plans-account-${row.accountId}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal`}>{nameOf(row)}</th>
                <td className={ADMIN_TD}>{currencyLabel(row.currency)}</td>
                <td className={ADMIN_TD_NUM}>{atLeast(formatCount(row.payments), row.exact)}</td>
                <td className={ADMIN_TD_NUM} data-money="received">{atLeast(formatMoney(row.received, row.currency), row.exact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className={NOTE} data-testid="revenue-plans-accounts-more">{REVENUE_PLANS_NOT_LISTED(total - rows.length)}</p>
      )}
    </div>
  );
}

function PaymentList({ plans }: { plans: FinancePlanRevenue }) {
  const rows = plans.payments ?? [];
  const total = plans.paymentsTotal ?? rows.length;
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className={SUBHEAD}>{REVENUE_PLANS_LIST}</p>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={REVENUE_PLANS_LIST} data-testid="revenue-plans-list">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{REVENUE_PLANS_PAID_AT}</th>
              <th scope="col" className={ADMIN_TH}>{REVENUE_PLANS_PLAN}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_PLANS_RECEIVED_SHORT}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{REVENUE_TAX}</th>
              <th scope="col" className={ADMIN_TH}>{REVENUE_PLANS_PERIOD}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {rows.map((row) => (
              <tr key={row.id} data-testid={`revenue-plans-payment-${row.id}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal whitespace-nowrap`}>{when(row.paidAt)}</th>
                <td className={ADMIN_TD}>{row.planLabel ?? REVENUE_PLANS_UNKNOWN_PLAN}</td>
                <td className={ADMIN_TD_NUM} data-money="received">{formatMoney(row.received, row.currency)}</td>
                <td className={ADMIN_TD_NUM} data-money="tax">{formatMoney(row.tax, row.currency)}</td>
                <td className={ADMIN_TD}>{revenuePlansPeriod(when(row.periodStart), when(row.periodEnd))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && (
        <p className={NOTE} data-testid="revenue-plans-payments-more">{REVENUE_PLANS_PAYMENTS_NOT_LISTED(total - rows.length)}</p>
      )}
    </div>
  );
}
