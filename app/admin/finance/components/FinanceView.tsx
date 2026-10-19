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
 * Order (S1-FR-5, §11A.0): our revenue, takings through the platform
 * (Section 2 block B, slice 2a, directly under our revenue), Section 1,
 * Section 3, Section 4 (credits, slice 1b), then Section 6 block B, client
 * payment problems (slice 2b). Money MK-1 (KPI restructure review §12):
 * takings, renamed "Client payments (the businesses' money, not ours)", moves
 * from under our revenue to the very bottom, after the payment problems.
 *
 * Finance F-5 (BD-29, standard §5.1): the KPI strip sits between the header
 * and the filter bar, on Overview, on the Accounts tab and with a business
 * picked; placeholders while the first read runs, nothing on an error (K-10).
 * Its tiles are links (BD-31): K-1 opens AI cost & usage for This month and
 * the business (SA-W7 (a)); the others jump to their section with a plain
 * anchor, or, on the Accounts tab where the sections are not mounted, select
 * Overview and scroll there once (SA-W3 (a), F5-R2). The page never writes a
 * hash or history itself: the hook stays the one URL writer.
 *
 * Money M-1 (finance health §11D.3): with a business picked, the account
 * header and the account summary sit at the top of the content (never with
 * all businesses, M1-FR-10). The picked NAME is held here, in state, and never in
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
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_WINDOW_EXTRA_LABELS, ADMIN_WINDOW_LABELS, type AdminWindowValue } from '@/app/admin/components/layout/adminWindow';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import type { FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';

import { serialiseFinanceUrl, type FinanceQuery } from '../financeUrl';
import { k1AnalyticsHref } from '../financeLinks';
import {
  FINANCE_CLEAR_PATCH,
  FINANCE_DEFAULT_WINDOW,
  FINANCE_FILTER_SPEC,
  financeCanClear,
  financeFilterRepair,
  financeWindowProblem,
  fromFinanceQuery,
  isSinceStart,
  toFinanceQuery,
  type FinanceFilters,
} from '../financeFilters';
import { FINANCE_WHAT, useFinanceData } from '../useFinanceData';
import { ACCOUNTS_WHAT, NAME_PLATFORM, PAGE_PURPOSE, PAGE_TITLE, sinceStartWindowLine } from '../financeCopy';
import { accountNameFor, type PickedName } from '../financeAccount';
import { AccountHeader } from './AccountHeader';
import { AccountSummary } from './AccountSummary';
import { AccountsTab } from './AccountsTab';
import { FinanceTabPanel, FinanceTabs, type FinanceTab } from './FinanceTabs';
import { AccountsByPlanSection } from './AccountsByPlanSection';
import { AiCostSection } from './AiCostSection';
import { HistoryAllBusinessesLine, HistoryBlock } from './HistoryBlock';
import { CreditsSection } from './CreditsSection';
import { FinanceFilterBar } from './FinanceFilterBar';
import { FinanceKpiPlaceholders, FinanceKpiStrip, type FinanceTileSection, type FinanceTileTarget } from './FinanceKpiStrip';
import { PaymentProblemsSection } from './PaymentProblemsSection';
import { PlansSubscriptions } from './PlansSubscriptions';
import { RevenuePanel } from './RevenuePanel';
import { TakingsSection } from './TakingsSection';

/** M3-FR-1: the Accounts tab's keys at their defaults (a pick, or leaving the tab). */
const TAB_RESET: Partial<FinanceFilters> = { sort: 'ai_cost', group: '', show: 'all' };

/** This page's path, for the Accounts-tab tiles' real links (F-5, SA-W3 (a)). */
const FINANCE_PATH = '/admin/finance';

/**
 * SA-W8: one label set, the shared bar's. DF-6 (E-81): "Since it started" reads from the
 * payload's start, `formatUtc` without its trailing " UTC" (the line ends in "(UTC)").
 */
function windowLabelOf(window: FinanceWindowInfo): string {
  if (window.preset === 'since_start') return sinceStartWindowLine(formatUtc(window.start).replace(/ UTC$/, ''));
  return `${ADMIN_WINDOW_LABELS[window.preset]}, ${window.from} to ${window.to} UTC`;
}

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
  const { filters, setFilters, hrefFor } = useAdminFilters(FINANCE_FILTER_SPEC);
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
  // DF-6 (DF6-FR-9): "Since it started" needs a business, so removing it also resets the window, in one write.
  const onRemoveBusiness = useCallback(
    () => setFilters(isSinceStart(filters.window) ? { account: '', window: FINANCE_DEFAULT_WINDOW } : { account: '' }),
    [filters.window, setFilters]
  );
  // SA-Q43: selecting a tab writes `tab`; leaving Accounts resets its sort and filters.
  // Money MK-4: Plans & subscriptions is the page URL's `tab=plans`; it never reaches the request
  // (`toFinanceQuery` sends `tab` for Accounts only), so the finance read is the Overview's.
  const onSelectTab = useCallback(
    (tab: FinanceTab) =>
      setFilters(
        tab === 'accounts' ? { tab: 'accounts', status: '' } : tab === 'plans' ? { tab: 'plans', ...TAB_RESET } : { tab: '', ...TAB_RESET, status: '' }
      ),
    [setFilters]
  );
  const selectedTab: FinanceTab =
    query.tab === 'accounts' ? 'accounts' : filters.tab === 'plans' && query.accountId === null ? 'plans' : 'overview';
  // F-5: on a tab other than Overview the sections are not on screen, so a tile is a link to Overview.
  const onAccountsTab = selectedTab !== 'overview' && query.accountId === null;

  // F-5 (SA-W3 (a), F5-R2): the section an Accounts-tab tile asked for. Once
  // Overview is mounted it is scrolled into view ONCE and cleared; no hash.
  const [jumpTo, setJumpTo] = useState<FinanceTileSection | null>(null);
  useEffect(() => {
    if (jumpTo === null || onAccountsTab || !data) return;
    const target = document.getElementById(jumpTo);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    setJumpTo(null);
  }, [jumpTo, onAccountsTab, data]);

  // F-5 (BD-31): where the sections are on screen, a plain anchor; on the
  // Accounts tab, the shared filter mode: a real link to Overview at the same
  // window and business, whose plain click is the Overview tab's one write.
  const targetFor = useCallback(
    (section: FinanceTileSection): FinanceTileTarget =>
      onAccountsTab
        ? {
            filter: {
              href: `${FINANCE_PATH}${hrefFor({ tab: '', ...TAB_RESET })}#${section}`,
              apply: () => {
                onSelectTab('overview');
                setJumpTo(section);
              },
            },
          }
        : { href: `#${section}` },
    [onAccountsTab, hrefFor, onSelectTab]
  );
  const accountName = query.accountId !== null ? accountNameFor(query.accountId, pickedName, data) : null;
  const chipName = accountName === null ? null : accountName.platform ? NAME_PLATFORM : accountName.name;

  // SA-W8: one label set, the shared bar's ("7 days", "30 days").
  // DF-6 (E-81, DF6-R2): the since-start line is built ONCE, here, from the payload's start
  // (formatUtc without its trailing " UTC"), and handed to the summary.
  const windowLabel = data
    ? windowLabelOf(data.window)
    : query.preset === 'since_start'
      ? ADMIN_WINDOW_EXTRA_LABELS.since_start
      : ADMIN_WINDOW_LABELS[query.preset];
  const sinceStartLine = data && data.window.preset === 'since_start' ? windowLabel : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader title={PAGE_TITLE} purpose={PAGE_PURPOSE} asOf={data ? windowLabel : null} />

      {/* F-5 (BD-29): header, KPI strip, filter bar. K-10: placeholders on the first read, nothing on an error. */}
      {data && !error ? (
        <FinanceKpiStrip
          tiles={data.tiles}
          farOverAllowancePercent={data.credits.farOverAllowancePercent}
          windowLabel={windowLabel}
          aiCostHref={k1AnalyticsHref(data.accountId)}
          targetFor={targetFor}
        />
      ) : (
        loading && !error && <FinanceKpiPlaceholders />
      )}

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
                  windowLine={sinceStartLine}
                />
              </>
            )}
            {query.accountId === null && <FinanceTabs selected={selectedTab} onSelect={onSelectTab} />}
            {selectedTab === 'plans' ? (
              <FinanceTabPanel id="plans">
                {/* Money MK-4 (§3.2): Plan mix on top, then the subscriptions, read only now that the tab is open. */}
                <div className="space-y-4">
                  <AccountsByPlanSection accounts={data.accounts} windowLabel={windowLabel} onRetry={reload} />
                  <PlansSubscriptions
                    status={filters.status === '' ? null : filters.status}
                    onStatus={(next) => setFilters({ status: next ?? '' })}
                  />
                </div>
              </FinanceTabPanel>
            ) : selectedTab === 'accounts' && query.accountId === null ? (
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
                <RevenuePanel revenue={data.revenue} windowLabel={windowLabel} onRetry={reload} mrr={data.mrr} stripeMode={data.stripeMode ?? null} />
                <AccountsByPlanSection accounts={data.accounts} windowLabel={windowLabel} onRetry={reload} />
                <AiCostSection aiCost={data.aiCost} accountId={data.accountId} window={data.window} windowLabel={windowLabel} onRetry={reload} />
                <CreditsSection credits={data.credits} windowLabel={windowLabel} onRetry={reload} />
                {/* Slice 8.3 (HS-FR-11, E-85): closed on load, so no request until "Show history". */}
                {query.accountId === null ? <HistoryBlock query={query} /> : <HistoryAllBusinessesLine />}
                <PaymentProblemsSection problems={data.paymentProblems} windowLabel={windowLabel} onRetry={reload} accountId={data.accountId} />
                {/* Money MK-1: the businesses' client payments, not ours (BD-1), last on the Overview. */}
                <TakingsSection takings={data.takings} windowLabel={windowLabel} onRetry={reload} />
              </OverviewBody>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
