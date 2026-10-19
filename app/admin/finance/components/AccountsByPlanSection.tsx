'use client';

/**
 * Section 1, Accounts by plan (§8.1, S1-FR-12 to S1-FR-15). All groups are
 * shown, zeros included, with a Total; tier groups carry their label from the
 * server (config), so this file holds no tier name. "Now" counts: the section
 * ignores the date window except for "New in the window", and narrows to a
 * picked business (SA-W1), which its subtitle says.
 *
 * Slice 1c (BD-15, SA-Q24): a tier group that holds paying Founding Partners
 * says so: a text note with all businesses, a neutral chip with words for a
 * picked business. No new column and no section badge.
 *
 * Money MK-5 (§5 "Not a KPI, kept as a note"): K-3 leaves the strip. When its
 * BD-11 rule fires (the payload's amber or red), the count is a chip on this
 * block, with the rule's colour in words (amber "warn", red "danger") and the
 * payload's headline. The rule itself stays data in `financeRules.ts`.
 */

import type { FinanceAccountsSection, FinanceGroupCount, FinanceTile } from '@/lib/business-os/finance/financeTypes';
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
} from '@/app/admin/components/layout/adminTable';
import {
  ACCOUNTS_BY_STATE,
  ACCOUNTS_COUNT,
  ACCOUNTS_DORMANT,
  ACCOUNTS_ENDING,
  ACCOUNTS_FOUNDING_CHIP,
  ACCOUNTS_GRACE,
  ACCOUNTS_GROUP,
  ACCOUNTS_NEW,
  ACCOUNTS_NO_END_DATE,
  ACCOUNTS_NO_PLAN_ROW_LINK,
  ACCOUNTS_PAST_DUE,
  ACCOUNTS_SUBTITLE_ALL,
  ACCOUNTS_SUBTITLE_ONE,
  ACCOUNTS_TITLE,
  ACCOUNTS_TOTAL,
  GROUP_LABELS,
  ORIGIN_NOTES,
  PLANS_PAGE,
  accountsFoundingNote,
  accountsK3Chip,
} from '../financeCopy';
import { atLeast, formatCount } from '../financeFormat';
import { FinanceSection } from './FinanceSection';

export function groupLabel(group: Pick<FinanceGroupCount, 'key' | 'tierLabel'>): string {
  if (group.key.startsWith('tier:')) return group.tierLabel ?? group.key.slice('tier:'.length);
  return GROUP_LABELS[group.key as keyof typeof GROUP_LABELS];
}

/** The origin as stored, with the copy's note where it has one (a backfill is not a signup). */
function originLabel(origin: string): string {
  const note = Object.prototype.hasOwnProperty.call(ORIGIN_NOTES, origin) ? ORIGIN_NOTES[origin] : null;
  return note ? `${origin} (${note})` : origin;
}

export function AccountsByPlanSection({
  accounts,
  windowLabel,
  onRetry,
  k3,
}: {
  accounts: FinanceAccountsSection;
  windowLabel: string;
  onRetry: () => void;
  /** Money MK-5: K-3's tile, for its chip here. Absent (fixtures before MK-5): no chip, as before. */
  k3?: FinanceTile;
}) {
  const f = accounts.figures;
  const exact = accounts.status !== 'partial';
  const n = (value: number) => atLeast(formatCount(value), exact);
  const k3Fires = k3 !== undefined && (k3.status === 'amber' || k3.status === 'red') && k3.value !== null;
  return (
    <FinanceSection
      id="accounts"
      title={ACCOUNTS_TITLE}
      subtitle={accounts.scope === 'one' ? ACCOUNTS_SUBTITLE_ONE : ACCOUNTS_SUBTITLE_ALL}
      status={accounts.status}
      onRetry={onRetry}
    >
      {f && (
        <div className="space-y-3">
          {k3Fires && k3?.value && (
            <div className="flex flex-wrap items-center gap-2" data-testid="accounts-k3">
              <StatusChip tone={k3.status === 'red' ? 'danger' : 'warn'} testId="accounts-k3-chip">
                {accountsK3Chip(atLeast(formatCount(k3.value.value), k3.value.exact))}
              </StatusChip>
              <span className="text-xs text-slate-400">{k3.headline}</span>
            </div>
          )}
          <div className={ADMIN_TABLE_WRAP}>
            <table className={ADMIN_TABLE} data-testid="accounts-groups">
              <thead className={ADMIN_THEAD}>
                <tr>
                  <th scope="col" className={ADMIN_TH}>{ACCOUNTS_GROUP}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{ACCOUNTS_COUNT}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{ACCOUNTS_GRACE}</th>
                  <th scope="col" className={ADMIN_TH_NUM}>{ACCOUNTS_PAST_DUE}</th>
                </tr>
              </thead>
              <tbody className={ADMIN_TBODY}>
                {f.groups.map((g) => (
                  <tr key={g.key}>
                    <th scope="row" className={`${ADMIN_TD} font-normal`}>
                      {groupLabel(g)}
                      {g.foundingPartners > 0 &&
                        (accounts.scope === 'one' ? (
                          <span className="ml-2 inline-block align-middle">
                            <StatusChip tone="neutral" testId={`accounts-founding-chip-${g.key}`}>
                              {ACCOUNTS_FOUNDING_CHIP}
                            </StatusChip>
                          </span>
                        ) : (
                          <span className="ml-2 text-xs text-slate-400" data-testid={`accounts-founding-note-${g.key}`}>
                            {accountsFoundingNote(g.foundingPartners)}
                          </span>
                        ))}
                    </th>
                    <td className={ADMIN_TD_NUM}>{n(g.count)}</td>
                    <td className={ADMIN_TD_NUM}>{formatCount(g.grace)}</td>
                    <td className={ADMIN_TD_NUM}>{formatCount(g.pastDue)}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className={`${ADMIN_TD} font-semibold`}>{ACCOUNTS_TOTAL}</th>
                  <td className={`${ADMIN_TD_NUM} font-semibold`} data-testid="accounts-total">{n(f.total)}</td>
                  <td className={ADMIN_TD_NUM} />
                  <td className={ADMIN_TD_NUM} />
                </tr>
              </tbody>
            </table>
          </div>

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2"><dt className="text-slate-400">{ACCOUNTS_NO_END_DATE}</dt><dd className="text-slate-200">{n(f.foundingNoEndDate)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">{ACCOUNTS_DORMANT}</dt><dd className="text-slate-200">{n(f.dormantFounding)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-400">{ACCOUNTS_ENDING}</dt><dd className="text-slate-200">{n(f.endingIn30Days)}</dd></div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">{ACCOUNTS_NEW} ({windowLabel})</dt>
              <dd className="text-slate-200">
                {n(f.newInWindow.total)}
                {f.newInWindow.byOrigin.length > 0 &&
                  ` (${f.newInWindow.byOrigin.map((o) => `${originLabel(o.origin)}: ${formatCount(o.count)}`).join(', ')})`}
              </dd>
            </div>
          </dl>

          <p className="text-xs text-slate-400">
            {ACCOUNTS_BY_STATE}:{' '}
            {Object.entries(f.byState)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([state, count]) => `${state} ${formatCount(count)}`)
              .join(', ') || '0'}
          </p>
          <a href={PLANS_PAGE} className="text-xs text-purple-300 underline hover:text-purple-200">
            {ACCOUNTS_NO_PLAN_ROW_LINK}
          </a>
        </div>
      )}
    </FinanceSection>
  );
}
