'use client';

/**
 * Section 1, Accounts by plan (§8.1, S1-FR-12 to S1-FR-15). All groups are
 * shown, zeros included, with a Total; tier groups carry their label from the
 * server (config), so this file holds no tier name. "Now" counts: the section
 * ignores the date window except for "New in the window", and narrows to a
 * picked business (SA-W1), which its subtitle says.
 */

import type { FinanceAccountsSection, FinanceGroupCount } from '@/lib/business-os/finance/financeTypes';
import {
  ACCOUNTS_BY_STATE,
  ACCOUNTS_COUNT,
  ACCOUNTS_DORMANT,
  ACCOUNTS_ENDING,
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
} from '../financeCopy';
import { atLeast, formatCount } from '../financeFormat';
import { FinanceSection } from './FinanceSection';

const TH = 'px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400';
const TD = 'px-2 py-1 text-sm text-slate-200';

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
}: {
  accounts: FinanceAccountsSection;
  windowLabel: string;
  onRetry: () => void;
}) {
  const f = accounts.figures;
  const exact = accounts.status !== 'partial';
  const n = (value: number) => atLeast(formatCount(value), exact);
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
          <table className="w-full" data-testid="accounts-groups">
            <thead>
              <tr>
                <th scope="col" className={TH}>{ACCOUNTS_GROUP}</th>
                <th scope="col" className={TH}>{ACCOUNTS_COUNT}</th>
                <th scope="col" className={TH}>{ACCOUNTS_GRACE}</th>
                <th scope="col" className={TH}>{ACCOUNTS_PAST_DUE}</th>
              </tr>
            </thead>
            <tbody>
              {f.groups.map((g) => (
                <tr key={g.key} className="border-t border-slate-700/60">
                  <th scope="row" className={`${TD} font-normal text-left`}>{groupLabel(g)}</th>
                  <td className={TD}>{n(g.count)}</td>
                  <td className={TD}>{formatCount(g.grace)}</td>
                  <td className={TD}>{formatCount(g.pastDue)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-600">
                <th scope="row" className={`${TD} text-left font-semibold`}>{ACCOUNTS_TOTAL}</th>
                <td className={`${TD} font-semibold`} data-testid="accounts-total">{n(f.total)}</td>
                <td className={TD} />
                <td className={TD} />
              </tr>
            </tbody>
          </table>

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
