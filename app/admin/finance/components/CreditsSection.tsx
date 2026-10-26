'use client';

/**
 * Section 4, credits (finance & business health slice 1b, S1-FR-21 to
 * S1-FR-24). Every figure here is in CREDITS, the platform's own unit: no
 * currency is shown, and nothing here is money (§8.4).
 *
 * The summary line counts every account (K-2 and K-4 are the same numbers);
 * the table shows at most the server's cap, with "Showing N of M" (SA-W15).
 * "% used" arrives in tenths, already rounded down by the server (SA-W17).
 * A section the server could not build says so with a Retry; a failed lots
 * read leaves the gifted figures "Unknown" while the rest renders (AC-38).
 */

import type { ReactNode } from 'react';
import type { FinanceCreditRow, FinanceCreditsSection, FinanceTile } from '@/lib/business-os/finance/financeTypes';
import type { StatusTone } from '@/app/admin/components/layout/StatusChip';
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
import {
  CREDITS_ALLOWANCE,
  CREDITS_BOUGHT,
  CREDITS_BOUGHT_BOOSTS,
  CREDITS_BOUGHT_COLUMN,
  CREDITS_BOUGHT_DELETED_NOTE,
  CREDITS_BOUGHT_IN_WINDOW,
  CREDITS_BOUGHT_UNKNOWN,
  CREDITS_NOT_TAKEN_BACK,
  CREDITS_BUSINESS,
  CREDITS_DELETED_NOTE,
  CREDITS_FAR_OVER,
  CREDITS_GIFTED,
  CREDITS_GIFTED_COLUMN,
  CREDITS_GIFTED_NOTE,
  CREDITS_GIFTED_UNKNOWN,
  CREDITS_GRANTED,
  CREDITS_GRANTING_ADMINS,
  CREDITS_GRANTS,
  CREDITS_INCONSISTENT_NOTE,
  CREDITS_LESS_THAN_TENTH,
  CREDITS_NO,
  CREDITS_NO_ACCOUNTS,
  CREDITS_NO_ALLOWANCE,
  CREDITS_NOT_LISTED_NOTE,
  BLOCK_KPI_FAR_OVER_CHIP,
  BLOCK_KPI_OVER_ALLOWANCE_DEFINITION,
  BLOCK_KPI_OVER_ALLOWANCE_LABEL,
  CREDITS_OVER_COLUMN,
  CREDITS_PLAN,
  CREDITS_SHOWING,
  CREDITS_SOURCE,
  CREDITS_TAKEN_BACK,
  CREDITS_TITLE,
  CREDITS_TRIAL,
  CREDITS_UNKNOWN,
  CREDITS_UNKNOWN_NOTE,
  CREDITS_USED,
  CREDITS_USED_PERCENT,
  CREDITS_YES,
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
} from '../financeCopy';
import { formatCount, formatCredits } from '../financeFormat';
import { groupLabel } from './AccountsByPlanSection';
import { BlockKpi } from '@/app/admin/components/layout/BlockKpi';
import { FinanceSection } from './FinanceSection';
import { businessTargetOf, useBusinessRowOpen } from './BusinessDrawer';

function nameOf(row: FinanceCreditRow): string {
  switch (row.nameStatus) {
    case 'found':
      return row.name ?? NAME_MISSING;
    case 'platform':
      return NAME_PLATFORM;
    case 'unavailable':
      return `${NAME_UNAVAILABLE} (${row.accountId.slice(0, 8)}…)`;
    default:
      return `${NAME_MISSING} (${row.accountId.slice(0, 8)}…)`;
  }
}

/**
 * Tenths, already floored by the server: 1499 → "149.9%"; a non-zero figure under 0.1% → "<0.1%".
 * Exported for the Money M-1 account summary, so the rule lives in one place.
 */
export function usedPercent(row: FinanceCreditRow): string {
  if (row.usedTenths === null) return CREDITS_UNKNOWN;
  if (row.usedTenths === 0 && (row.used ?? 0) > 0) return CREDITS_LESS_THAN_TENTH;
  return `${(row.usedTenths / 10).toFixed(1)}%`;
}

const credits = (value: number | null | undefined) => (value === null || value === undefined ? CREDITS_UNKNOWN : formatCredits(value));
const yesNo = (value: boolean | null) => (value === null ? CREDITS_UNKNOWN : value ? CREDITS_YES : CREDITS_NO);

/** The K-2 rule's status as the chip's tone: the rule decides, this only maps it (BD-11). */
function k2ChipTone(k2: FinanceTile | undefined): StatusTone {
  if (k2?.status === 'red') return 'danger';
  if (k2?.status === 'amber') return 'warn';
  return 'neutral';
}

export function CreditsSection({
  credits: section,
  windowLabel,
  onRetry,
  k2,
  trend,
}: {
  credits: FinanceCreditsSection;
  windowLabel: string;
  onRetry: () => void;
  /**
   * SA-CR-MK5 C-2: K-2's tile, so the far-over chip carries the BD-11 rule's own status
   * (red, amber, or grey) instead of a fixed amber. Absent (older fixtures): grey.
   */
  k2?: FinanceTile;
  /**
   * Money MK-7 (§6 item 13): this KPI's history trend (`HistoryTrend`, or the
   * all-businesses line with a business picked). Its own lazy read, so it also
   * shows when the section could not load. Absent: as before.
   */
  trend?: ReactNode;
}) {
  const f = section.figures;
  const gifted = section.gifted;
  // Slice 4b.2 (S4-FR-18 to S4-FR-20): bought credits beside gifted, never added to them. Absent only in
  // fixtures written before it (E-103), which then render exactly as before.
  const hasBought = section.bought !== undefined;
  const bought = section.bought ?? null;
  const count = (value: number | null) => (value === null ? CREDITS_UNKNOWN : formatCount(value));
  // Money MK-10: the rows open like the Businesses rows (D-17), when the drawer is mounted.
  const opener = useBusinessRowOpen();

  return (
    <FinanceSection
      id="credits"
      title={CREDITS_TITLE}
      subtitle={`${CREDITS_SOURCE}, ${windowLabel}`}
      status={section.status}
      onRetry={onRetry}
      alsoWhenUnknown={trend}
    >
      {f && (
        <div className="space-y-3">
          {/* Money MK-1: the block KPI is the headline (§3.2), leading (§5); K-2's far-over count is its amber chip. */}
          <BlockKpi
            label={BLOCK_KPI_OVER_ALLOWANCE_LABEL}
            value={formatCount(f.overAllowance)}
            indicator={{ kind: 'leading', definition: BLOCK_KPI_OVER_ALLOWANCE_DEFINITION }}
            chip={
              f.farOverAllowance !== null && f.farOverAllowance > 0
                ? { tone: k2ChipTone(k2), label: BLOCK_KPI_FAR_OVER_CHIP(formatCount(f.farOverAllowance), section.farOverAllowancePercent) }
                : null
            }
            testId="credits-over"
          />
          <dl className={`grid gap-3 ${hasBought ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} data-testid="credits-summary">
            <div><dt className="text-xs text-slate-400">{CREDITS_FAR_OVER}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-far-over">{count(f.farOverAllowance)}</dd></div>
            <div><dt className="text-xs text-slate-400">{CREDITS_GIFTED}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-gifted">{credits(gifted?.outstanding)}</dd></div>
            {hasBought && (
              <div><dt className="text-xs text-slate-400">{CREDITS_BOUGHT}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-bought">{credits(bought?.outstanding)}</dd></div>
            )}
          </dl>
          <p className="text-xs text-slate-400" data-testid="credits-window">
            {gifted?.window
              ? `${CREDITS_GRANTED}: ${formatCredits(gifted.window.granted)} (${formatCount(gifted.window.grants)} ${CREDITS_GRANTS}, ${formatCount(gifted.window.grantingAdmins)} ${CREDITS_GRANTING_ADMINS}) · ${CREDITS_TAKEN_BACK}: ${formatCredits(gifted.window.takenBack)}`
              : CREDITS_GIFTED_UNKNOWN}
          </p>
          {hasBought && (
            <p className="text-xs text-slate-400" data-testid="credits-bought-window">
              {bought?.window
                ? `${CREDITS_BOUGHT_IN_WINDOW}: ${formatCredits(bought.window.credits)} (${formatCount(bought.window.lots)} ${CREDITS_BOUGHT_BOOSTS})`
                : CREDITS_BOUGHT_UNKNOWN}
            </p>
          )}

          {f.rows.length === 0 ? (
            <p className="text-sm text-slate-300">{CREDITS_NO_ACCOUNTS}</p>
          ) : (
            <div className={ADMIN_TABLE_WRAP}>
              <table className={ADMIN_TABLE} data-testid="credits-table">
                <thead className={ADMIN_THEAD}>
                  <tr>
                    <th scope="col" className={ADMIN_TH}>{CREDITS_BUSINESS}</th>
                    <th scope="col" className={ADMIN_TH}>{CREDITS_PLAN}</th>
                    <th scope="col" className={ADMIN_TH_NUM}>{CREDITS_ALLOWANCE}</th>
                    <th scope="col" className={ADMIN_TH_NUM}>{CREDITS_USED}</th>
                    <th scope="col" className={ADMIN_TH_NUM}>{CREDITS_USED_PERCENT}</th>
                    <th scope="col" className={ADMIN_TH}>{CREDITS_OVER_COLUMN}</th>
                    <th scope="col" className={ADMIN_TH_NUM}>{CREDITS_GIFTED_COLUMN}</th>
                    {hasBought && <th scope="col" className={ADMIN_TH_NUM}>{CREDITS_BOUGHT_COLUMN}</th>}
                    {opener?.header}
                  </tr>
                </thead>
                <tbody className={ADMIN_TBODY}>
                  {f.rows.map((row) => (
                    <tr key={row.accountId} data-testid={`credits-row-${row.accountId}`} {...opener?.rowProps(businessTargetOf(row))}>
                      <th scope="row" className={`${ADMIN_TD} font-normal`}>{nameOf(row)}</th>
                      <td className={ADMIN_TD}>{row.group ? groupLabel({ key: row.group, tierLabel: row.tierLabel }) : CREDITS_UNKNOWN}</td>
                      {row.kind === 'position' ? (
                        <>
                          <td className={ADMIN_TD_NUM}>{credits(row.allowance)}</td>
                          <td className={ADMIN_TD_NUM}>{credits(row.used)}</td>
                          <td className={ADMIN_TD_NUM}>
                            {usedPercent(row)}
                            {row.trial && <span className="ml-1 text-[11px] text-slate-400">({CREDITS_TRIAL})</span>}
                          </td>
                          <td className={ADMIN_TD}>{yesNo(row.overAllowance)}</td>
                        </>
                      ) : (
                        <td className={ADMIN_TD} colSpan={4}>{row.kind === 'no_allowance' ? CREDITS_NO_ALLOWANCE : CREDITS_UNKNOWN}</td>
                      )}
                      <td className={ADMIN_TD_NUM}>{credits(row.giftedOutstanding)}</td>
                      {hasBought && <td className={ADMIN_TD_NUM} data-testid="credits-bought-cell">{credits(row.boughtOutstanding ?? null)}</td>}
                      {opener?.cell(businessTargetOf(row), nameOf(row))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.rows.length < f.accounts && (
            <p className="text-xs text-slate-400" data-testid="credits-showing">{CREDITS_SHOWING(f.rows.length, f.accounts)}</p>
          )}

          <ul className="space-y-1 text-[11px] text-slate-400" data-testid="credits-notes">
            {f.unknownAccounts > 0 && <li>{CREDITS_UNKNOWN_NOTE(f.unknownAccounts)}</li>}
            <li>{CREDITS_GIFTED_NOTE}</li>
            {gifted && gifted.deletedAccountsOutstanding !== 0 && (
              <li>{CREDITS_DELETED_NOTE(credits(gifted.deletedAccountsOutstanding))}</li>
            )}
            {gifted?.accountsNotListed ? <li>{CREDITS_NOT_LISTED_NOTE(gifted.accountsNotListed)}</li> : null}
            {gifted && gifted.inconsistentAccounts > 0 && <li>{CREDITS_INCONSISTENT_NOTE(gifted.inconsistentAccounts)}</li>}
            {bought && bought.deletedAccountsOutstanding !== 0 && (
              <li>{CREDITS_BOUGHT_DELETED_NOTE(credits(bought.deletedAccountsOutstanding))}</li>
            )}
            {bought?.refundNotTakenBack && <li data-testid="credits-not-taken-back">{CREDITS_NOT_TAKEN_BACK}</li>}
          </ul>
        </div>
      )}
      {trend}
    </FinanceSection>
  );
}
