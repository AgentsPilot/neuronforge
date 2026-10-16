'use client';

/**
 * The Accounts tab's body (finance health slice 6a, Money M-3, §11E.4,
 * SA-W88): the always-on notes (M3-FR-9), the refund-timing sentence when the
 * boost part carries it (S4-W-3, its one copy constant), the platform line
 * over every account, the sort / group / show controls, the count line, and the
 * table or "No accounts match this filter".
 *
 * SELECT AND FORMAT ONLY (M3-FR-13): sorting, filtering, the cap and every
 * figure are the server's. A control reports through `onChange`; the view
 * turns it into one write of its URL filter state (`useAdminFilters`, Finance
 * F-4), which refetches. The plan-group options and their
 * labels come from the server (`groupOptions`): no tier is written here.
 */

import type { FinanceAccountEconomicsSection, FinanceAccountsShow, FinanceAccountsSort, FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
import { FINANCE_ACCOUNTS_SHOWS, FINANCE_ACCOUNTS_SORTS, type FinanceQuery } from '../financeUrl';
import {
  ECON_ALL_GROUPS,
  ECON_BOOSTS_FAILED,
  ECON_COST,
  ECON_CREDITS_FAILED,
  ECON_CUTOVER_NOTICE,
  ECON_EMPTY,
  ECON_GROUP,
  ECON_LEDGER_FAILED,
  ECON_MARGIN,
  ECON_NONE,
  ECON_NOTES,
  ECON_PAID,
  ECON_PLANS_FAILED,
  ECON_PLATFORM_TITLE,
  ECON_SHOW,
  ECON_SHOW_LABELS,
  ECON_SORT,
  ECON_SORT_LABELS,
  ECON_SUBTITLE,
  ECON_TITLE,
  ECON_UNKNOWN,
  ECON_WALK_INCOMPLETE,
  econNotListed,
  econPlatformCovers,
  econShowing,
  REVENUE_REFUND_TIMING_NOTE,
} from '../financeCopy';
import { AccountEconomicsTable, costText, MarginValue } from './AccountEconomicsTable';
import { groupLabel } from './AccountsByPlanSection';
import { FinanceSection } from './FinanceSection';
import { atLeast, formatMoney } from '../financeFormat';

const NOTE = 'text-xs text-slate-400';
const FIELD = 'flex flex-col gap-1 text-xs text-slate-400';
const SELECT =
  'rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';
const ALL_GROUPS_VALUE = '';

export function AccountsTab({
  section,
  window,
  windowLabel,
  query,
  onChange,
  onRetry,
}: {
  section: FinanceAccountEconomicsSection;
  window: FinanceWindowInfo;
  windowLabel: string;
  query: FinanceQuery;
  onChange: (query: FinanceQuery) => void;
  onRetry: () => void;
}) {
  const { platform, notes, counts } = section;
  const notices = [
    notes.walkIncomplete && ECON_WALK_INCOMPLETE,
    notes.ledgerFailed && ECON_LEDGER_FAILED,
    notes.boostsFailed && ECON_BOOSTS_FAILED,
    notes.plansFailed && ECON_PLANS_FAILED,
    notes.creditsUnavailable && ECON_CREDITS_FAILED,
    section.coverage !== 'after_cutover' && ECON_CUTOVER_NOTICE,
  ];

  return (
    <FinanceSection id="accounts-economics" title={ECON_TITLE} subtitle={`${ECON_SUBTITLE}, ${windowLabel}`} status={section.status} onRetry={onRetry}>
      <div className="space-y-4">
        <ul className={`space-y-1 ${NOTE}`} data-testid="econ-notes">
          {ECON_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
          {notes.refundOrDispute && <li data-testid="econ-refund-note">{REVENUE_REFUND_TIMING_NOTE}</li>}
        </ul>

        {notices.map((text) =>
          text ? (
            <AdminNotice key={text} testId="econ-notice">
              {text}
            </AdminNotice>
          ) : null
        )}

        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3" data-testid="econ-platform">
          <p className="text-sm font-medium text-white">{ECON_PLATFORM_TITLE}</p>
          <p className={NOTE}>{econPlatformCovers(formatCount(platform.accountsCovered), platform.includesDeleted)}</p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className={NOTE}>{ECON_PAID}</dt>
              <dd className="text-sm text-slate-200" data-testid="econ-platform-paid">
                {platform.paid.lines.length === 0 ? (
                  platform.paid.failed ? ECON_UNKNOWN : ECON_NONE
                ) : (
                  <ul className="space-y-0.5">
                    {platform.paid.lines.map((line) => (
                      <li key={line.currency ?? 'unknown'}>
                        {line.afterTax === null ? ECON_UNKNOWN : atLeast(formatMoney(line.afterTax, line.currency), line.exact)}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className={NOTE}>{ECON_COST}</dt>
              <dd className="text-sm text-slate-200" data-testid="econ-platform-cost">
                {costText(platform.aiCost)}
              </dd>
            </div>
            <div>
              <dt className={NOTE}>{ECON_MARGIN}</dt>
              <dd className="text-sm text-slate-200">
                <MarginValue margin={platform.margin} testId="econ-platform-margin" />
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-wrap items-end gap-3" data-testid="econ-controls">
          <label className={FIELD}>
            {ECON_SORT}
            <select
              className={SELECT}
              value={query.sort}
              onChange={(event) => onChange({ ...query, sort: event.target.value as FinanceAccountsSort })}
              data-testid="econ-sort"
            >
              {FINANCE_ACCOUNTS_SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {ECON_SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            {ECON_GROUP}
            <select
              className={SELECT}
              value={query.group ?? ALL_GROUPS_VALUE}
              onChange={(event) => onChange({ ...query, group: event.target.value === ALL_GROUPS_VALUE ? null : event.target.value })}
              data-testid="econ-group"
            >
              <option value={ALL_GROUPS_VALUE}>{ECON_ALL_GROUPS}</option>
              {section.groupOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {groupLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className={FIELD}>
            {ECON_SHOW}
            <select
              className={SELECT}
              value={query.show}
              onChange={(event) => onChange({ ...query, show: event.target.value as FinanceAccountsShow })}
              data-testid="econ-show"
            >
              {FINANCE_ACCOUNTS_SHOWS.map((show) => (
                <option key={show} value={show}>
                  {ECON_SHOW_LABELS[show]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={ADMIN_COUNT_LINE} data-testid="econ-count">
          <p>{econShowing(formatCount(counts.shown), formatCount(counts.matching))}</p>
          {counts.notListed > 0 && <p data-testid="econ-not-listed">{econNotListed(formatCount(counts.notListed))}</p>}
        </div>

        {/* M3-FR-10: no account matches the filter → the sentence, no table. */}
        {section.rows.length === 0 ? (
          <AdminEmpty message={ECON_EMPTY} testId="econ-empty" />
        ) : (
          <AccountEconomicsTable rows={section.rows} deleted={section.deleted} window={window} />
        )}
      </div>
    </FinanceSection>
  );
}
