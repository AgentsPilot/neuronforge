'use client';

/**
 * The finance page's body (slice 1a, S1-FR-1 to S1-FR-6, L-1 to L-7).
 *
 * THE URL IS THE STATE (Finance F-4, Admin Layout Standard §5.6 U-1 to U-10):
 * the filters are the shared `useAdminFilters(FINANCE_FILTER_SPEC)` hook's
 * state, read once from the URL (inside the page's Suspense boundary) and
 * written back by the hook alone with `history.replaceState`, never `push` and
 * never the router. The page URL uses the canonical keys (`range`, `account`;
 * the old `preset` / `accountId` are read as aliases), and a bad value drops
 * only its own filter, silently (U-4, BD-30). The REQUEST is unchanged:
 * `toFinanceQuery` maps the state onto `FinanceQuery` and `serialiseFinanceUrl`
 * writes it (AC-173). Only ids and enums reach the URL.
 *
 * Order (S1-FR-5, §11A.0): KPI strip, our revenue, takings through the
 * platform (Section 2 block B, slice 2a, directly under our revenue),
 * Section 1, Section 3, Section 4 (credits, slice 1b), then Section 6 block
 * B, client payment problems (slice 2b), last.
 *
 * Money M-1 (finance health §11D.3): with a business picked, the account
 * header and the account summary sit above the KPI strip (never with all
 * businesses, M1-FR-10). The picked NAME is held here, in state, and never in
 * the URL, a request or a log (SA-Q32, AC-109): the URL is written only from
 * the filters, whose type has no name field.
 *
 * Money M-3 (slice 6a, M3-FR-1, SA-W88): with NO business picked, two
 * page-local tabs, Overview (everything above, unchanged) and Accounts. The
 * tab is the URL's `tab=accounts`, a field of the same filter spec (SA-W2), so
 * every change is one write; leaving Accounts resets its sort and filters. The
 * filter bar sits above both tabs. With a business picked there are no tabs,
 * and picking a business drops `tab`, `sort`, `group` and `show`. A link that
 * combines them anyway keeps the business and loses the tab keys (SA-W3).
 *
 * Finance F-2 (Admin Layout Standard §5.3, §5.10): the header is the shared
 * `AdminPageHeader` (h1 "Finance", the sidebar label), and the states are the
 * shared `AdminLoading` and `AdminError`, inside one always-mounted content area
 * that is `aria-busy` while a read runs. The hook still clears the data on a
 * failure, so a failed read never shows old figures. F-4 ended DV-1: Refresh
 * and "Read at" are in the shared filter bar, and the URL notice is gone
 * (BD-30, SA-W1).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_WINDOW_LABELS, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import { serialiseFinanceUrl, type FinanceQuery } from '../financeUrl';
import {
  FINANCE_CLEAR_PATCH,
  FINANCE_FILTER_SPEC,
  financeCanClear,
  financeFilterRepair,
  financeWindowProblem,
  fromFinanceQuery,
  toFinanceQuery,
  type FinanceFilters,
} from '../financeFilters';
import { FINANCE_WHAT, useFinanceData } from '../useFinanceData';
import { ACCOUNTS_WHAT, NAME_PLATFORM, PAGE_PURPOSE, PAGE_TITLE } from '../financeCopy';
import { accountNameFor, type PickedName } from '../financeAccount';
import { AccountHeader } from './AccountHeader';
import { AccountSummary } from './AccountSummary';
import { AccountsTab } from './AccountsTab';
import { FinanceTabPanel, FinanceTabs, type FinanceTab } from './FinanceTabs';
import { AccountsByPlanSection } from './AccountsByPlanSection';
import { AiCostSection } from './AiCostSection';
import { CreditsSection } from './CreditsSection';
import { FinanceFilterBar } from './FinanceFilterBar';
import { FinanceKpiStrip } from './FinanceKpiStrip';
import { PaymentProblemsSection } from './PaymentProblemsSection';
import { RevenuePanel } from './RevenuePanel';
import { TakingsSection } from './TakingsSection';

/** M3-FR-1: the Accounts tab's keys at their defaults (a pick, or leaving the tab). */
const TAB_RESET: Partial<FinanceFilters> = { sort: 'ai_cost', group: '', show: 'all' };

/**
 * Today's sections, unchanged. With no business picked they are the Overview
 * tab's panel; with a business picked there are no tabs, so no panel either.
 */
function OverviewBody({ tabbed, children }: { tabbed: boolean; children: ReactNode }) {
  return tabbed ? (
    <FinanceTabPanel id="overview">
      <div className="space-y-4">{children}</div>
    </FinanceTabPanel>
  ) : (
    <>{children}</>
  );
}

export function FinanceView() {
  const { filters, setFilters } = useAdminFilters(FINANCE_FILTER_SPEC);
  const query = useMemo(() => toFinanceQuery(filters), [filters]);
  const queryString = serialiseFinanceUrl(query);
  const { data, loading, error, reload } = useFinanceData(queryString);

  // AccountsTab's controls (its API stays `FinanceQuery`) → one hook write.
  const setQuery = useCallback((next: FinanceQuery) => setFilters(fromFinanceQuery(next)), [setFilters]);

  // SA-W3: a link combining a business with the tab keys, or the tab keys
  // without the tab, keeps the business and the window and loses the
  // dependent keys. `toFinanceQuery` already ignores them, so this cleans the
  // URL only: the request string does not change and no second read is sent.
  useEffect(() => {
    const fix = financeFilterRepair(filters);
    if (fix) setFilters(fix);
  }, [filters, setFilters]);

  // SA-W5 (a): a refused custom window, held against the window it was refused
  // on, so any applied window (a preset, Apply, Clear, an outside change) hides it.
  const [windowProblem, setWindowProblem] = useState<{ text: string; on: AdminWindowValue } | null>(null);
  const onWindowChange = useCallback(
    (next: AdminWindowValue) => {
      const problem = financeWindowProblem(next, new Date());
      if (problem) {
        setWindowProblem({ text: problem, on: filters.window });
        return;
      }
      setWindowProblem(null);
      setFilters({ window: next });
    },
    [filters.window, setFilters]
  );
  const onClear = useCallback(() => {
    setWindowProblem(null);
    setFilters(FINANCE_CLEAR_PATCH);
  }, [setFilters]);

  // SA-Q32: the name the admin picked, for the chip, the header and the summary only.
  const [pickedName, setPickedName] = useState<PickedName | null>(null);
  const onPick = useCallback(
    (accountId: string, name: string | null) => {
      // The spec holds the id lower-cased (SA-W11), so the name is held against the same form.
      const account = accountId.toLowerCase();
      setPickedName({ accountId: account, name });
      // M3-FR-1: a picked business has no tab; the tab's sort and filters go with it. One write.
      setFilters({ account, tab: '', ...TAB_RESET });
    },
    [setFilters]
  );
  const onRemoveBusiness = useCallback(() => setFilters({ account: '' }), [setFilters]);
  // SA-Q43: selecting a tab writes `tab`; leaving Accounts resets its sort and filters.
  const onSelectTab = useCallback(
    (tab: FinanceTab) => setFilters(tab === 'accounts' ? { tab: 'accounts' } : { tab: '', ...TAB_RESET }),
    [setFilters]
  );
  const selectedTab: FinanceTab = query.tab === 'accounts' ? 'accounts' : 'overview';
  const accountName = query.accountId !== null ? accountNameFor(query.accountId, pickedName, data) : null;
  const chipName = accountName === null ? null : accountName.platform ? NAME_PLATFORM : accountName.name;

  // SA-W8: one label set, the shared bar's ("7 days", "30 days").
  const windowLabel = data
    ? `${ADMIN_WINDOW_LABELS[data.window.preset]}, ${data.window.from} to ${data.window.to} UTC`
    : ADMIN_WINDOW_LABELS[query.preset];

  return (
    <div className="space-y-6">
      <AdminPageHeader title={PAGE_TITLE} purpose={PAGE_PURPOSE} asOf={data ? windowLabel : null} />

      <FinanceFilterBar
        filters={filters}
        onWindowChange={onWindowChange}
        onPick={onPick}
        onRemoveBusiness={onRemoveBusiness}
        chipName={chipName}
        onClear={onClear}
        canClear={financeCanClear(filters)}
        busy={loading}
        readAt={data?.generatedAt ?? null}
        onRefresh={reload}
        windowProblem={windowProblem !== null && windowProblem.on === filters.window ? windowProblem.text : null}
      />

      {/* Always mounted, so a refresh keeps the current figures and says it is busy (§5.10). */}
      <div data-testid="finance-content" aria-busy={loading} className="space-y-4">
        {error && <AdminError message={error} testId="finance-error" onRetry={reload} />}

        {loading && !data && !error && <AdminLoading what={FINANCE_WHAT} />}

        {data && !error && (
          <div className="space-y-4">
            {data.accountId !== null && (
              <>
                <AccountHeader
                  accountId={data.accountId}
                  name={accountNameFor(data.accountId, pickedName, data)}
                  accounts={data.accounts}
                />
                <AccountSummary
                  accountId={data.accountId}
                  window={data.window}
                  aiCost={data.aiCost}
                  revenue={data.revenue}
                  credits={data.credits}
                  accounts={data.accounts}
                  accountMargin={data.accountMargin ?? null}
                />
              </>
            )}
            {query.accountId === null && <FinanceTabs selected={selectedTab} onSelect={onSelectTab} />}
            {selectedTab === 'accounts' && query.accountId === null ? (
              <FinanceTabPanel id="accounts">
                {data.accountEconomics ? (
                  <AccountsTab
                    section={data.accountEconomics}
                    window={data.window}
                    windowLabel={windowLabel}
                    query={query}
                    onChange={setQuery}
                    onRetry={reload}
                  />
                ) : (
                  <AdminLoading what={ACCOUNTS_WHAT} />
                )}
              </FinanceTabPanel>
            ) : (
              <OverviewBody tabbed={query.accountId === null}>
                <FinanceKpiStrip tiles={data.tiles} farOverAllowancePercent={data.credits.farOverAllowancePercent} windowLabel={windowLabel} />
                <RevenuePanel revenue={data.revenue} windowLabel={windowLabel} onRetry={reload} />
                <TakingsSection takings={data.takings} windowLabel={windowLabel} onRetry={reload} />
                <AccountsByPlanSection accounts={data.accounts} windowLabel={windowLabel} onRetry={reload} />
                <AiCostSection aiCost={data.aiCost} accountId={data.accountId} window={data.window} windowLabel={windowLabel} onRetry={reload} />
                <CreditsSection credits={data.credits} windowLabel={windowLabel} onRetry={reload} />
                <PaymentProblemsSection problems={data.paymentProblems} windowLabel={windowLabel} onRetry={reload} />
              </OverviewBody>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
