'use client';

/**
 * The AI cost page's Summary & checks tab (credit deduction slice 4a, workplan
 * §4.6, the operator cost report; Money M-5 Charge checks; Money MK-3).
 *
 * Money MK-3b (SA-CR-MK3A DV-1): presentational. The report read lives in the
 * page (`app/admin/ai-cost/useCostReport.ts`), because the strip A-K1 to A-K5
 * above both tabs needs it; the URL state lives in the page's one spec
 * (`app/admin/ai-cost/aiCostFilters.ts`), so the window and the business are
 * one value on both tabs. This tab gets both as props and renders, in order:
 * its bar, the report's states and sections, then the recorded AI cost block
 * (C-7) and the Leak check under one anchor, `#costs-leak` (A-K3's target),
 * always drawn so that tile always has a target.
 *
 * Reads of its own: only the shared business picker's search and the Leak
 * check panel's `GET`, run only when its button is pressed. No `@/lib/` import
 * (the business-os-llm page's source guard): the payload types are re-declared
 * in `../../costTypes.ts`.
 *
 * A platform account chosen in the picker is refused by the report route
 * (409); the tab says why in its own words instead of a generic error (SA M-2).
 */

import { useState } from 'react';

import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import type { AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

import { formatCount } from '../../costFormat';
import {
  COSTS_EMPTY,
  COSTS_EMPTY_HINT,
  COSTS_INCOMPLETE,
  COSTS_PERIOD_RULE,
  COSTS_WHAT,
  INCOMPLETE_REASON_TEXT,
  NAMES_FAILED,
  SECTION_FAILED,
  UNREADABLE_AMOUNTS,
} from '../../costCopy';
import type { CostReportPayload } from '../../costTypes';
import { CostsFilterBar } from './CostsFilterBar';
import { BreakdownsSection, ChargedInWindowSection, FallbackSection, PeriodsSection, SpreadSection } from './CostsSections';
import { LeakCheckPanel } from './LeakCheckPanel';
import { RecordedSection } from './RecordedSection';

/** The report read's state, from the page (`useCostReport`). */
export interface CostsReportState {
  report: CostReportPayload | null;
  loading: boolean;
  error: { kind: 'platform_account' | 'other'; message: string } | null;
  reread: () => void;
}

export interface CostsTabProps {
  /** The page's window and business (one value on both tabs). */
  filters: { window: AdminWindowValue; account: string };
  setFilters: (patch: { window?: AdminWindowValue; account?: string }) => void;
  onClear: () => void;
  canClear: boolean;
  state: CostsReportState;
}

/** The report is drawn as sections (the anchors of the strip have somewhere to go). */
export function costsSectionsShown(report: CostReportPayload | null): boolean {
  if (report === null || report.sections.totals === 'failed') return false;
  return !(report.sections.totals === 'ok' && report.periods.length === 0);
}

export function CostsTab({ filters, setFilters, onClear, canClear, state }: CostsTabProps) {
  const { report, loading, error, reread } = state;
  /** The business last picked, with the name the picker showed (not in the URL). */
  const [picked, setPicked] = useState<{ accountId: string; name: string | null } | null>(null);

  const isEmpty = report !== null && report.sections.totals === 'ok' && report.periods.length === 0;

  // The chip's name: the picked name, else the report's own name for that
  // account, else none (the short id; RC-6, no lookup).
  const businessName = !filters.account
    ? null
    : picked && picked.accountId === filters.account && picked.name
      ? picked.name
      : report?.accounts.find((account) => account.accountId === filters.account)?.companyName ?? null;

  return (
    <div className="space-y-4" data-testid="costs-tab">
      <CostsFilterBar
        filters={filters}
        setFilters={setFilters}
        onClear={onClear}
        canClear={canClear}
        businessName={businessName}
        onPickBusiness={(accountId, name) => {
          setPicked({ accountId, name });
          setFilters({ account: accountId });
        }}
        busy={loading}
        readAt={report?.generatedAt ?? null}
        onRefresh={reread}
      />

      {/* Always mounted, so a re-read marks the content busy instead of replacing it. */}
      <div data-testid="costs-content" aria-busy={loading} className="space-y-4">
        {error &&
          (error.kind === 'platform_account' ? (
            <AdminNotice testId="costs-platform-account">{error.message}</AdminNotice>
          ) : (
            <AdminError testId="costs-error" message={error.message} onRetry={reread} />
          ))}

        {loading && !report && !error && (
          <div data-testid="costs-loading">
            <AdminLoading what={COSTS_WHAT} />
          </div>
        )}

        {report && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400" data-testid="costs-window">
              {report.window.from} to {report.window.to} (UTC)
              {report.rowsRead !== null && <> &middot; {formatCount(report.rowsRead)} ledger rows read</>}
              {' · '}
              {COSTS_PERIOD_RULE(report.periodLookbackDays)}
            </p>

            {/* L-9b (E-9): the shared notice; same words and reasons, its amber. */}
            {report.incomplete && (
              <AdminNotice testId="costs-incomplete">
                {COSTS_INCOMPLETE}{' '}
                <span className="text-amber-300/80">
                  ({report.incompleteReasons.map((r) => INCOMPLETE_REASON_TEXT[r] ?? r).join(', ')})
                </span>
              </AdminNotice>
            )}

            {/* L-10 task 9 (F-120, SA L-10 Q-7): each partial fact is its own
                shared notice, same words and test ids, after the incomplete one. */}
            {report.unreadableAmounts > 0 && (
              <AdminNotice testId="costs-unreadable">{UNREADABLE_AMOUNTS(report.unreadableAmounts)}</AdminNotice>
            )}

            {report.sections.names === 'failed' && (
              <AdminNotice testId="costs-names-failed">{NAMES_FAILED}</AdminNotice>
            )}

            {report.sections.totals === 'failed' ? (
              <p data-testid="costs-totals-failed" className="text-sm text-red-300">
                {SECTION_FAILED}
              </p>
            ) : isEmpty ? (
              <AdminEmpty
                message={COSTS_EMPTY}
                hint={COSTS_EMPTY_HINT}
                testId="costs-empty"
                onClear={canClear ? onClear : undefined}
              />
            ) : (
              <>
                <ChargedInWindowSection report={report} />
                <PeriodsSection report={report} />
                <BreakdownsSection report={report} />
                <FallbackSection report={report} />
                <SpreadSection report={report} />
              </>
            )}
          </div>
        )}
      </div>

      {/* MK-3a (C-7, A-K3): the recorded AI cost beside the charged one, then the Leak check, which
          says which calls. One anchor for both, always drawn. Slice 4b: the on-demand leak check has
          its own window (at most 7 days) and button; it follows the business chosen above. */}
      <div id="costs-leak" data-testid="costs-leak" className="space-y-4">
        {report && <RecordedSection recorded={report.recorded} accountId={report.accountFilter} />}
        <LeakCheckPanel accountId={filters.account} accountLabel={businessName} />
      </div>
    </div>
  );
}
