'use client';

/**
 * The Accounts tab's table (finance health slice 6a, Money M-3, M3-FR-3,
 * M3-FR-7, SA-W76, SA-W85, SA-W86).
 *
 * SELECT AND FORMAT ONLY (M3-FR-13, SA-WR-18): every row, its order, the cap,
 * and every figure come from the server. This file never sorts, filters,
 * folds, adds or subtracts. "Paid us" is printed with `formatMoney` (exactly
 * two decimals, the currency named, one line per currency, never a total
 * across currencies); AI cost and AI margin with `formatUsd`, exactly as
 * Section 3 prints its cost, so a cost cell equals Section 3's text for the
 * same account and window (SA-WR-43). A negative margin keeps its sign.
 *
 * Each named or short-id row links to the one-account view on the same window
 * (`accountViewHref`: only the id and the window). A platform row and the
 * Deleted accounts row have no link (SA-W85, M3-W-8), and neither does a
 * "No plan row" account: the one-account view checks the plan table first and
 * would answer "Business not found" (fix round 1, QA B-1).
 */

import Link from 'next/link';

import type { FinanceEconomicsCost, FinanceEconomicsCredits, FinanceEconomicsDeletedRow, FinanceEconomicsPaid, FinanceEconomicsRow, FinanceMarginValue, FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
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
import { accountViewHref } from '../financeLinks';
import {
  ACCOUNTS_FOUNDING_CHIP,
  CREDITS_LESS_THAN_TENTH,
  ECON_BUSINESS,
  ECON_COST,
  ECON_COST_BEFORE_CUTOVER,
  ECON_CREDITS,
  ECON_CREDITS_NOTE,
  ECON_DELETED,
  ECON_GROUP,
  ECON_GROUP_NOTE,
  ECON_MARGIN,
  ECON_MARGIN_NOT_AVAILABLE,
  ECON_MARGIN_OTHER_CURRENCY,
  ECON_NO_ALLOWANCE,
  ECON_NO_PLAN_ROW,
  ECON_NO_REVENUE,
  ECON_NONE,
  ECON_OPEN,
  ECON_PAID,
  ECON_UNKNOWN,
  econCreditsUsed,
  econOpenLabel,
  econPaidParts,
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
} from '../financeCopy';
import { atLeast, formatCredits, formatMoney, formatUsd } from '../financeFormat';
import { groupLabel } from './AccountsByPlanSection';

const NOTE = 'block text-[11px] text-slate-400';
const LINK = 'text-xs text-purple-300 underline hover:text-purple-200';

/** The charged AI cost as Section 3 prints it: `formatUsd`, "At least" when a lower bound (SA-WR-43). */
export function costText(cost: FinanceEconomicsCost): string {
  if (cost.kind === 'unknown') return ECON_UNKNOWN;
  if (cost.kind === 'before_cutover') return ECON_COST_BEFORE_CUTOVER;
  return atLeast(formatUsd(cost.costUsd), cost.exact);
}

/** The AI margin in words or `formatUsd` (its sign kept). Also the account summary's line (AC-142). */
export function marginText(margin: FinanceMarginValue): string {
  switch (margin.kind) {
    case 'not_available':
      return ECON_MARGIN_NOT_AVAILABLE;
    case 'other_currency':
      return ECON_MARGIN_OTHER_CURRENCY;
    case 'unknown':
      return ECON_UNKNOWN;
    default:
      return formatUsd(margin.marginUsd);
  }
}

export function MarginValue({ margin, testId }: { margin: FinanceMarginValue; testId: string }) {
  return (
    <>
      <span data-testid={testId}>{marginText(margin)}</span>
      {margin.kind === 'figure' && margin.noRevenue && <span className={NOTE}>{ECON_NO_REVENUE}</span>}
    </>
  );
}

/** One line per currency, the plan and boost parts of the same currency under it; never a total across currencies. */
function PaidValue({ paid, testId }: { paid: FinanceEconomicsPaid; testId: string }) {
  if (paid.lines.length === 0) return <span data-testid={testId}>{paid.failed ? ECON_UNKNOWN : ECON_NONE}</span>;
  const part = (value: number | null, currency: string | null) => (value === null ? ECON_UNKNOWN : formatMoney(value, currency));
  return (
    <ul className="space-y-0.5" data-testid={testId}>
      {paid.lines.map((line) => (
        <li key={line.currency ?? 'unknown'} data-testid={`${testId}-${line.currency ?? 'unknown'}`}>
          <span>{line.afterTax === null ? ECON_UNKNOWN : atLeast(formatMoney(line.afterTax, line.currency), line.exact)}</span>
          <span className={NOTE}>{econPaidParts(part(line.planAfterTax, line.currency), part(line.boostsAfterTax, line.currency))}</span>
        </li>
      ))}
    </ul>
  );
}

function creditsText(credits: FinanceEconomicsCredits): string {
  switch (credits.kind) {
    case 'position': {
      const percent = credits.usedTenths === 0 && credits.used > 0 ? CREDITS_LESS_THAN_TENTH : `${(credits.usedTenths / 10).toFixed(1)}%`;
      return econCreditsUsed(percent, formatCredits(credits.used), formatCredits(credits.allowance));
    }
    case 'no_allowance':
      return ECON_NO_ALLOWANCE;
    case 'no_plan_row':
      return ECON_NO_PLAN_ROW;
    default:
      return ECON_UNKNOWN;
  }
}

function businessText(row: FinanceEconomicsRow): string {
  if (row.kind === 'platform' || row.nameStatus === 'platform') return NAME_PLATFORM;
  if (row.nameStatus === 'found' && row.name) return row.name;
  if (row.nameStatus === 'unavailable') return `${NAME_UNAVAILABLE} (${formatShortId(row.accountId)})`;
  return `${NAME_MISSING} (${formatShortId(row.accountId)})`;
}

export function AccountEconomicsTable({
  rows,
  deleted,
  window,
}: {
  rows: FinanceEconomicsRow[];
  deleted: FinanceEconomicsDeletedRow | null;
  window: Pick<FinanceWindowInfo, 'preset' | 'from' | 'to'>;
}) {
  return (
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} data-testid="econ-table">
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>{ECON_BUSINESS}</th>
            <th scope="col" className={ADMIN_TH}>
              {ECON_GROUP}
              <span className={`${NOTE} normal-case tracking-normal`}>{ECON_GROUP_NOTE}</span>
            </th>
            <th scope="col" className={ADMIN_TH_NUM}>{ECON_PAID}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{ECON_COST}</th>
            <th scope="col" className={ADMIN_TH_NUM}>{ECON_MARGIN}</th>
            <th scope="col" className={ADMIN_TH_NUM}>
              {ECON_CREDITS}
              <span className={`${NOTE} normal-case tracking-normal`}>{ECON_CREDITS_NOTE}</span>
            </th>
            <th scope="col" className={ADMIN_TH}>{ECON_OPEN}</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {rows.map((row) => {
            const business = businessText(row);
            // QA B-1: only an account the one-account view can open (it has a plan row).
            const linked = row.kind !== 'platform' && !row.noPlanRow;
            return (
              <tr key={row.accountId} data-testid={`econ-row-${row.accountId}`}>
                <th scope="row" className={`${ADMIN_TD} font-normal text-slate-200`} title={row.accountId}>
                  {business}
                </th>
                <td className={ADMIN_TD}>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span>{row.group ? groupLabel({ key: row.group, tierLabel: row.tierLabel }) : ECON_UNKNOWN}</span>
                    {row.foundingPartner && (
                      <StatusChip tone="neutral" testId={`econ-founding-${row.accountId}`}>
                        {ACCOUNTS_FOUNDING_CHIP}
                      </StatusChip>
                    )}
                  </span>
                  {row.noPlanRow && <span className={NOTE}>{ECON_NO_PLAN_ROW}</span>}
                </td>
                <td className={ADMIN_TD_NUM}>
                  <PaidValue paid={row.paid} testId={`econ-paid-${row.accountId}`} />
                </td>
                <td className={ADMIN_TD_NUM} data-testid={`econ-cost-${row.accountId}`}>
                  {costText(row.aiCost)}
                </td>
                <td className={ADMIN_TD_NUM}>
                  <MarginValue margin={row.margin} testId={`econ-margin-${row.accountId}`} />
                </td>
                <td className={ADMIN_TD_NUM} data-testid={`econ-credits-${row.accountId}`}>
                  {creditsText(row.credits)}
                </td>
                <td className={ADMIN_TD}>
                  {linked && (
                    <Link
                      href={accountViewHref(row.accountId, window)}
                      className={LINK}
                      aria-label={econOpenLabel(business)}
                      data-testid={`econ-open-${row.accountId}`}
                    >
                      {ECON_OPEN}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          {deleted && (
            <tr data-testid="econ-row-deleted">
              <th scope="row" className={`${ADMIN_TD} font-normal text-slate-200`}>
                {ECON_DELETED}
              </th>
              <td className={ADMIN_TD} />
              <td className={ADMIN_TD_NUM}>
                <PaidValue paid={deleted.paid} testId="econ-paid-deleted" />
              </td>
              <td className={ADMIN_TD_NUM} data-testid="econ-cost-deleted">
                {costText(deleted.aiCost)}
              </td>
              <td className={ADMIN_TD_NUM}>
                <MarginValue margin={deleted.margin} testId="econ-margin-deleted" />
              </td>
              <td className={ADMIN_TD_NUM} />
              <td className={ADMIN_TD} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
