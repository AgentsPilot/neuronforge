'use client';

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { ChevronRight } from 'lucide-react';

import { clientLogger } from '@/lib/logger/client';
import { AdminDrawer } from '@/app/admin/components/layout/AdminDrawer';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';

import {
  ANALYTICS_FILTER_SPEC,
  ANALYTICS_PATH,
  DIMENSION_FIELD,
  analyticsRequestParams,
  drillPatch,
  normaliseForScope,
  rowClickPatch,
  scopeSwitchPatch,
  type AnalyticsFilters,
  type DrillField,
} from './analyticsFilters';
import {
  UNPAGED_ROW_CAP,
  type BreakdownDimension,
  type CategoryTotals,
  type DrillDownItem,
  type DrillDownResponse,
  type ExecutionDetails,
  type PeriodComparison,
  type Scope,
} from './analyticsTypes';
import { isDrilled, readMeta } from './analyticsCall';
import { AnalyticsCallDetails } from './components/AnalyticsCallDetails';
import { AnalyticsExecutionCard } from './components/AnalyticsExecutionCard';
import { ANALYTICS_WHAT, AnalyticsFilterBar, drillValueLabel, type DrillLabels } from './components/AnalyticsFilterBar';
import { AnalyticsKpis } from './components/AnalyticsKpis';
import { AnalyticsSummaryCards } from './components/AnalyticsSummaryCards';
import { AnalyticsTable } from './components/AnalyticsTable';

// A client file logs through the client logger (F-56).
const logger = clientLogger.child({ module: 'AdminCostAnalytics' });

const PURPOSE = 'What Business OS and agent-platform AI calls cost, by provider, model and feature.';

const EMPTY_TOTALS = { cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, calls: 0 };

/**
 * A 400 is the route refusing the query (e.g. a date range it cannot use), not
 * a server failure: say which. A recorded page override of §5.10 rule 1 (SA Q-10).
 */
const INVALID_QUERY = 'The selected filters or dates are not valid. Check the date range and try again.';

/**
 * A breadcrumb button's props: link-styled while deeper crumbs follow, plain
 * white and `aria-current` when it is the last; the A-1 focus ring either way.
 */
const crumbProps = (isLast: boolean) => ({
  className: `rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
    isLast ? 'text-white' : 'text-purple-400 hover:underline'
  }`,
  'aria-current': isLast ? ('true' as const) : undefined,
});

// useSearchParams needs a Suspense boundary in Next 14.
export default function AdminCostAnalytics() {
  return (
    <Suspense fallback={null}>
      <AdminCostAnalyticsContent />
    </Suspense>
  );
}

function AdminCostAnalyticsContent() {
  // The URL is the filter state's projection (Admin Layout Standard C-7): the
  // first state is parsed from the URL synchronously, so the first read already
  // sees an inbound link's filters, and drill clicks, breadcrumbs, the scope
  // switch and the KPI tiles all write through this one hook (L-2a §2.3).
  const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(ANALYTICS_FILTER_SPEC);
  /**
   * Readable labels for drilled values (an agent name, an account name), keyed
   * by filter and read only while their id is the applied value. Not in the
   * URL: after a reload the chip and breadcrumb show the value itself (SA Q-8).
   */
  const [labels, setLabels] = useState<DrillLabels>({});
  /** The business last picked, with the name the picker showed (not in the URL). */
  const [pickedBusiness, setPickedBusiness] = useState<{ accountId: string; name: string | null } | null>(null);
  // What Business OS scope cannot hold is never sent, even for a stale or
  // hand-made link: the request is built from the normalised filters.
  const effective = useMemo(() => ({ ...filters, ...normaliseForScope(filters) }), [filters]);
  const scope: Scope = effective.scope;
  const breakdownBy: BreakdownDimension = effective.groupBy;
  // Dates are at day precision, so the string is stable within a UTC day; the
  // read is keyed on it, so a change that yields the same request sends none.
  const query = analyticsRequestParams(effective, new Date()).toString();

  const [possiblyIncomplete, setPossiblyIncomplete] = useState(false);
  const [items, setItems] = useState<DrillDownItem[]>([]);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  /** A read has succeeded: the KPI placeholders and "Reading…" give way (K-10, §5.10). */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the data was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);
  // The call drawer (L-2b, the L-1d pattern). `isOpen` drives the panel and
  // `openCallId` names its call. Closing clears only `isOpen`, so the content
  // stays during Radix's slide-out; the next open replaces the id. A read in
  // flight can land while the drawer is open: the effect below handles a call
  // that leaves `items` (L-1d QA B-1).
  const [isOpen, setIsOpen] = useState(false);
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  /** The call's Open button: focus goes back to it on close (D-6). */
  const opener = useRef<HTMLButtonElement | null>(null);
  /** Where focus goes when the opener's row is gone: the always-mounted content area (QA B-1). */
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [executionDetails, setExecutionDetails] = useState<ExecutionDetails | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotals | null>(null);
  const [comparison, setComparison] = useState<PeriodComparison | null>(null);

  const fetchData = useCallback(async (requestQuery: string) => {
    const fail = (message: string) => {
      setError(message);
      setItems([]);
      setTotals(EMPTY_TOTALS);
      // QA B-1: the zeroed figures are not data. The next read must show the
      // first-read state (placeholders, "Reading…"), never "$0.00" and "No data found".
      setHasLoaded(false);
    };
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try: a rejection here is a network
      // failure; anything else must never be labelled as one.
      let response: Response;
      try {
        response = await fetch(`/api/admin/token-usage/drill-down?${requestQuery}`, {
          cache: 'no-store'
        });
      } catch (err) {
        logger.error({ err }, 'Could not reach the AI cost drill-down route');
        fail(ADMIN_NETWORK_ERROR);
        return;
      }

      // The route answers at the top level, not under `data`; the cast is the
      // same trust the page placed in the body before (no runtime shape check).
      const result = await readAdminResponse(response, {
        what: ANALYTICS_WHAT,
        sessionEndedCopy: true,
        pick: (body) => body as unknown as DrillDownResponse,
      });
      if (!result.ok) {
        fail(result.status === 400 ? INVALID_QUERY : result.message);
        return;
      }

      const data = result.data;
      setItems(data.items);
      setTotals(data.totals);
      setPossiblyIncomplete(data.possiblyIncomplete === true);
      setExecutionDetails(data.executionDetails ?? null);
      setCategoryTotals(data.categoryTotals ?? null);
      setComparison(data.comparison ?? null);
      setHasLoaded(true);
      setReadAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(query);
  }, [fetchData, query]);

  // A link may name what Business OS scope cannot hold (`?category=memory`,
  // `?group_by=agent`): converge the URL and the controls. The request was
  // already built from the normalised filters, so this sends no request.
  useEffect(() => {
    const fix = normaliseForScope(filters);
    if (Object.keys(fix).length > 0) setFilters(fix);
  }, [filters, setFilters]);

  /** An aggregate row's name, plain left click: record its label and drill in place (§5.8 D-3). */
  const drill = (item: DrillDownItem) => {
    const field = DIMENSION_FIELD[breakdownBy];
    setLabels((prev) => ({ ...prev, [field]: { id: item.id, label: item.label } }));
    setFilters(rowClickPatch(item, effective));
    // QA-B1: the clicked link unmounts when the drilled rows arrive, which would
    // drop focus to <body>. The content area stays mounted, so focus goes there.
    contentRef.current?.focus();
  };

  /** The same drill as a real address, for a modified or middle click. */
  const drillHref = (item: DrillDownItem) => `${ANALYTICS_PATH}${hrefFor(rowClickPatch(item, effective))}`;

  /** The call the drawer shows; null once that call is no longer loaded. */
  const openCall =
    openCallId === null ? null : items.find((item) => item.id === openCallId && item.type === 'call') ?? null;

  const openCallDetails = (item: DrillDownItem, button: HTMLButtonElement) => {
    opener.current = button;
    setOpenCallId(item.id);
    setIsOpen(true);
  };

  const closeCallDetails = () => {
    setIsOpen(false);
    setOpenCallId(null);
  };

  // QA B-1 (L-1d): the open call left `items` (a read landed without it, or a
  // failed read emptied them). The drawer has already closed through its
  // `open` prop, and Radix does not call onOpenChange for a prop change, so end
  // the open state too; otherwise a later read that brings the call back would
  // reopen the drawer unasked.
  useEffect(() => {
    if (isOpen && openCall === null) {
      setIsOpen(false);
      setOpenCallId(null);
    }
  }, [isOpen, openCall]);

  // D-6: back to the call's Open button; when that row is gone its button is
  // detached, so focus goes to the content area, never <body>.
  const returnFocus = () => {
    if (opener.current?.isConnected) opener.current.focus();
    else contentRef.current?.focus();
  };

  /**
   * Switch scope. Entering Business OS clears every selection that does not
   * exist there, in the same event, so the very next request is already valid
   * for the route (C3-4). Switching back to "All" restores nothing.
   */
  const handleScopeToggle = () => {
    const next: Scope = scope === 'bos' ? 'all' : 'bos';
    setFilters(scopeSwitchPatch(next, filters));
    if (next === 'bos') {
      closeCallDetails();
      setExecutionDetails(null);
    }
  };

  /** The breadcrumb "All Data": drill filters, business and category cleared; scope, window and group by kept. */
  const clearAllFilters = () => {
    setFilters(drillPatch({}));
    closeCallDetails();
  };

  /** A breadcrumb's text: the recorded label while its id is applied, else the value. */
  const labelOf = (field: DrillField) => drillValueLabel(labels, field, filters[field]);

  /** A KPI tile's target: the filtered view's real link, and the same patch applied in place. */
  const tile = (patch: Partial<AnalyticsFilters>) => ({
    href: `${ANALYTICS_PATH}${hrefFor(patch)}`,
    apply: () => setFilters(patch),
  });

  // §5.10: loading and errors replace the content only; the header and the bar stay (F-55).
  const showContent = !error && hasLoaded;

  /** "All Data" is the last crumb only when no other crumb shows. */
  const hasDeeperCrumb = Boolean(
    filters.provider ||
      filters.model ||
      filters.activity ||
      filters.account ||
      filters.requestType ||
      filters.feature ||
      filters.component ||
      filters.endpoint ||
      (scope === 'all' && (filters.agent || filters.execution)),
  );

  // QA E-QA-1: a slow "All" response must not redraw the run card after a
  // switch to Business OS scope.
  const runAgent = scope === 'all' ? executionDetails?.agent ?? null : null;

  /** The open call's time, the drawer title's suffix (UTC, F-50). */
  const openCallTime = openCall ? readMeta(openCall).timestamp : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="AI calls & usage (detail)" purpose={PURPOSE} />

      {!error && (
        <AnalyticsKpis
          scope={scope}
          totals={totals}
          categoryTotals={categoryTotals}
          comparison={comparison}
          possiblyIncomplete={possiblyIncomplete}
          category={effective.category}
          firstLoad={!hasLoaded}
          tile={tile}
        />
      )}

      <AnalyticsFilterBar
        filters={effective}
        setFilters={setFilters}
        onClear={clear}
        canClear={!isDefault}
        onScopeToggle={handleScopeToggle}
        labels={labels}
        pickedBusiness={pickedBusiness}
        onPickBusiness={(accountId, name) => {
          setPickedBusiness({ accountId, name });
          setFilters({ account: accountId });
        }}
        busy={loading}
        readAt={readAt}
        onRefresh={() => void fetchData(query)}
      />

      {/* Always mounted (error and first read included), so focus has a
          connected place to land when the open call's row is gone (QA B-1). */}
      <div
        ref={contentRef}
        tabIndex={-1}
        aria-busy={loading}
        data-testid="analytics-content"
        className="space-y-4 focus:outline-none"
      >
        {error && <AdminError message={error} testId="analytics-error" onRetry={() => void fetchData(query)} />}
        {!error && !hasLoaded && <AdminLoading what={ANALYTICS_WHAT} />}

        {showContent && (
          <>
            <div className="space-y-3">
              {possiblyIncomplete && (
                <AdminNotice testId="incomplete-banner">
                  This period reached {UNPAGED_ROW_CAP.toLocaleString('en-US')} calls, so the totals below are a lower
                  bound. Narrow the period for an exact figure.
                </AdminNotice>
              )}
              {/* What these numbers are, and are not (slice 2a). */}
              <div data-testid="scope-notes" className="space-y-1 text-xs text-slate-400">
                {scope === 'bos' ? (
                  <p>
                    Recorded AI cost, Business OS only: every AI call in the usage log, charged or not, including calls
                    before charging started on 29 Sep 2026 and legacy-tagged Business OS rows. USD, priced from the
                    model price table. The charged cost is on Finance.
                  </p>
                ) : (
                  <p>Recorded AI cost, both products: every AI call in the usage log. USD, priced from the model price table.</p>
                )}
                <p>Totals may be incomplete above {UNPAGED_ROW_CAP.toLocaleString('en-US')} calls in the selected period.</p>
              </div>
            </div>

            {/* Breadcrumb trail (rewired in L-2a, SA M-1; L-2b class edits only). */}
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <button type="button" onClick={clearAllFilters} {...crumbProps(!hasDeeperCrumb)}>
                All Data
              </button>
              {filters.provider && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider }));
                    }}
                    {...crumbProps(!(filters.model || filters.activity || filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('provider')}
                  </button>
                </>
              )}
              {filters.model && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model }));
                    }}
                    {...crumbProps(!(filters.activity || filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('model')}
                  </button>
                </>
              )}
              {filters.activity && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity }));
                    }}
                    {...crumbProps(!(filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('activity')}
                  </button>
                </>
              )}
              {filters.account && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, account: filters.account }));
                    }}
                    {...crumbProps(!(filters.agent || filters.execution))}
                  >
                    {labelOf('account')}
                  </button>
                </>
              )}
              {filters.requestType && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, requestType: filters.requestType }));
                    }}
                    {...crumbProps(!(filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('requestType')}
                  </button>
                </>
              )}
              {filters.feature && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, feature: filters.feature }));
                    }}
                    {...crumbProps(!(filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('feature')}
                  </button>
                </>
              )}
              {filters.component && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, component: filters.component }));
                    }}
                    {...crumbProps(!(filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('component')}
                  </button>
                </>
              )}
              {filters.endpoint && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, endpoint: filters.endpoint }));
                    }}
                    {...crumbProps(!(filters.account || filters.agent || filters.execution))}
                  >
                    {labelOf('endpoint')}
                  </button>
                </>
              )}
              {scope === 'all' && filters.agent && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => {
                      setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, requestType: filters.requestType, feature: filters.feature, component: filters.component, endpoint: filters.endpoint, account: filters.account, agent: filters.agent }));
                    }}
                    {...crumbProps(!(filters.execution))}
                  >
                    {labelOf('agent')}
                  </button>
                </>
              )}
              {scope === 'all' && filters.execution && (
                <>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden="true" />
                  <span className="text-white" aria-current="true" title={`Execution: ${filters.execution}`}>
                    {labelOf('execution')}
                  </span>
                </>
              )}
            </div>

            {/* The run every call row belongs to: context first (SA Q-2, S-2). */}
            {runAgent && executionDetails && <AnalyticsExecutionCard details={executionDetails} agent={runAgent} />}

            <p className={ADMIN_COUNT_LINE} data-testid="analytics-count">
              Showing {items.length} {items.length === 1 ? 'item' : 'items'}
            </p>

            {items.length > 0 ? (
              <AnalyticsTable
                items={items}
                scope={scope}
                breakdownBy={breakdownBy}
                totals={totals}
                categoryTotals={categoryTotals}
                drilled={isDrilled(effective)}
                drillHref={drillHref}
                onDrill={drill}
                onOpenCall={openCallDetails}
              />
            ) : (
              <AdminEmpty
                testId="analytics-empty"
                message="No AI usage matches this window and these filters."
                hint="Try a longer window, the other scope or fewer filters."
                onClear={isDefault ? undefined : clear}
              />
            )}

            {/* Below the table (SA Q-15, R-13). */}
            <AnalyticsSummaryCards items={items} totals={totals} />
          </>
        )}
      </div>

      {/* One drawer for the page, rendered unconditionally outside the content
          and every state branch (SA M-4): a failed read closes it through its
          `open` prop, never unmounts it. It renders the call already loaded:
          opening it asks for nothing (R-6). */}
      <AdminDrawer
        open={isOpen && openCall !== null}
        onClose={() => setIsOpen(false)}
        onReturnFocus={returnFocus}
        title="Call details"
        titleSuffix={openCallTime ? formatUtc(openCallTime) : undefined}
        testId="call-drawer"
      >
        {openCall && <AnalyticsCallDetails call={openCall} />}
      </AdminDrawer>
    </div>
  );
}
