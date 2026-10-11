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

import type { FinanceCreditRow, FinanceCreditsSection } from '@/lib/business-os/finance/financeTypes';
import {
  CREDITS_ALLOWANCE,
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
  CREDITS_OVER,
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
import { FinanceSection } from './FinanceSection';

const TH = 'px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400';
const TD = 'px-2 py-1 text-sm text-slate-200';

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

/** Tenths, already floored by the server: 1499 → "149.9%"; a non-zero figure under 0.1% → "<0.1%". */
function usedPercent(row: FinanceCreditRow): string {
  if (row.usedTenths === null) return CREDITS_UNKNOWN;
  if (row.usedTenths === 0 && (row.used ?? 0) > 0) return CREDITS_LESS_THAN_TENTH;
  return `${(row.usedTenths / 10).toFixed(1)}%`;
}

const credits = (value: number | null | undefined) => (value === null || value === undefined ? CREDITS_UNKNOWN : formatCredits(value));
const yesNo = (value: boolean | null) => (value === null ? CREDITS_UNKNOWN : value ? CREDITS_YES : CREDITS_NO);

export function CreditsSection({
  credits: section,
  windowLabel,
  onRetry,
}: {
  credits: FinanceCreditsSection;
  windowLabel: string;
  onRetry: () => void;
}) {
  const f = section.figures;
  const gifted = section.gifted;
  const count = (value: number | null) => (value === null ? CREDITS_UNKNOWN : formatCount(value));

  return (
    <FinanceSection id="credits" title={CREDITS_TITLE} subtitle={`${CREDITS_SOURCE}, ${windowLabel}`} status={section.status} onRetry={onRetry}>
      {f && (
        <div className="space-y-3">
          <dl className="grid gap-3 sm:grid-cols-3" data-testid="credits-summary">
            <div><dt className="text-xs text-slate-400">{CREDITS_OVER}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-over">{formatCount(f.overAllowance)}</dd></div>
            <div><dt className="text-xs text-slate-400">{CREDITS_FAR_OVER}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-far-over">{count(f.farOverAllowance)}</dd></div>
            <div><dt className="text-xs text-slate-400">{CREDITS_GIFTED}</dt><dd className="text-lg font-semibold text-white" data-testid="credits-gifted">{credits(gifted?.outstanding)}</dd></div>
          </dl>
          <p className="text-xs text-slate-400" data-testid="credits-window">
            {gifted?.window
              ? `${CREDITS_GRANTED}: ${formatCredits(gifted.window.granted)} (${formatCount(gifted.window.grants)} ${CREDITS_GRANTS}, ${formatCount(gifted.window.grantingAdmins)} ${CREDITS_GRANTING_ADMINS}) · ${CREDITS_TAKEN_BACK}: ${formatCredits(gifted.window.takenBack)}`
              : CREDITS_GIFTED_UNKNOWN}
          </p>

          {f.rows.length === 0 ? (
            <p className="text-sm text-slate-300">{CREDITS_NO_ACCOUNTS}</p>
          ) : (
            <table className="w-full" data-testid="credits-table">
              <thead>
                <tr>
                  <th scope="col" className={TH}>{CREDITS_BUSINESS}</th>
                  <th scope="col" className={TH}>{CREDITS_PLAN}</th>
                  <th scope="col" className={TH}>{CREDITS_ALLOWANCE}</th>
                  <th scope="col" className={TH}>{CREDITS_USED}</th>
                  <th scope="col" className={TH}>{CREDITS_USED_PERCENT}</th>
                  <th scope="col" className={TH}>{CREDITS_OVER_COLUMN}</th>
                  <th scope="col" className={TH}>{CREDITS_GIFTED_COLUMN}</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((row) => (
                  <tr key={row.accountId} className="border-t border-slate-700/60" data-testid={`credits-row-${row.accountId}`}>
                    <th scope="row" className={`${TD} font-normal text-left`}>{nameOf(row)}</th>
                    <td className={TD}>{row.group ? groupLabel({ key: row.group, tierLabel: row.tierLabel }) : CREDITS_UNKNOWN}</td>
                    {row.kind === 'position' ? (
                      <>
                        <td className={TD}>{credits(row.allowance)}</td>
                        <td className={TD}>{credits(row.used)}</td>
                        <td className={TD}>
                          {usedPercent(row)}
                          {row.trial && <span className="ml-1 text-[11px] text-slate-400">({CREDITS_TRIAL})</span>}
                        </td>
                        <td className={TD}>{yesNo(row.overAllowance)}</td>
                      </>
                    ) : (
                      <td className={TD} colSpan={4}>{row.kind === 'no_allowance' ? CREDITS_NO_ALLOWANCE : CREDITS_UNKNOWN}</td>
                    )}
                    <td className={TD}>{credits(row.giftedOutstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {f.rows.length < f.accounts && (
            <p className="text-xs text-slate-400" data-testid="credits-showing">{CREDITS_SHOWING(f.rows.length, f.accounts)}</p>
          )}

          <ul className="space-y-1 text-[11px] text-slate-500" data-testid="credits-notes">
            {f.unknownAccounts > 0 && <li>{CREDITS_UNKNOWN_NOTE(f.unknownAccounts)}</li>}
            <li>{CREDITS_GIFTED_NOTE}</li>
            {gifted && gifted.deletedAccountsOutstanding !== 0 && (
              <li>{CREDITS_DELETED_NOTE(credits(gifted.deletedAccountsOutstanding))}</li>
            )}
            {gifted?.accountsNotListed ? <li>{CREDITS_NOT_LISTED_NOTE(gifted.accountsNotListed)}</li> : null}
            {gifted && gifted.inconsistentAccounts > 0 && <li>{CREDITS_INCONSISTENT_NOTE(gifted.inconsistentAccounts)}</li>}
          </ul>
        </div>
      )}
    </FinanceSection>
  );
}
