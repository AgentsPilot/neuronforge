'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  DollarSign,
  BarChart3,
  ChevronDown,
  Cpu,
  X,
  Hash,
  Clock,
  FileJson,
  ChevronRight
} from 'lucide-react';

import { clientLogger } from '@/lib/logger/client';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
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
  BREAKDOWN_OPTIONS,
  UNPAGED_ROW_CAP,
  formatCost,
  formatNumber,
  type AvailableFilters,
  type BreakdownDimension,
  type CategoryTotals,
  type DrillDownItem,
  type DrillDownResponse,
  type ExecutionDetails,
  type PeriodComparison,
  type Scope,
} from './analyticsTypes';
import { ANALYTICS_WHAT, AnalyticsFilterBar, drillValueLabel, type DrillLabels } from './components/AnalyticsFilterBar';
import { AnalyticsKpis } from './components/AnalyticsKpis';

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
 * Context chips showing related dimensions
 */
function ContextChips({ item, breakdownBy, scope }: { item: DrillDownItem; breakdownBy: BreakdownDimension; scope: Scope }) {
  const chips: React.ReactNode[] = [];
  const meta = item.metadata || {};

  if (breakdownBy !== 'user' && meta.userCount && (meta.userCount as number) > 0) {
    chips.push(
      <span key="users" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.userCount} users
      </span>
    );
  }

  // Agents and executions are AgentsPilot counts: not shown in Business OS scope (C3-2).
  if (scope === 'all' && breakdownBy !== 'agent' && meta.agentCount && (meta.agentCount as number) > 0) {
    chips.push(
      <span key="agents" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.agentCount} agents
      </span>
    );
  }

  if (scope === 'all' && breakdownBy !== 'execution' && meta.executionCount && (meta.executionCount as number) > 0) {
    chips.push(
      <span key="executions" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.executionCount} executions
      </span>
    );
  }

  if (chips.length === 0) return null;
  return <div className="flex gap-1 flex-wrap mt-1">{chips}</div>;
}

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
  const [availableFilters, setAvailableFilters] = useState<AvailableFilters>({
    providers: [], models: [], activities: [], users: [], agents: []
  });
  const [loading, setLoading] = useState(true);
  /** A read has succeeded: the KPI placeholders and "Reading…" give way (K-10, §5.10). */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the data was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<DrillDownItem | null>(null);
  const [executionDetails, setExecutionDetails] = useState<ExecutionDetails | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotals | null>(null);
  const [showAgentJson, setShowAgentJson] = useState(false);
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
      setAvailableFilters(data.availableFilters);
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

  const handleRowClick = (item: DrillDownItem) => {
    if (item.type === 'call') {
      setSelectedCall(item);
      return;
    }
    const field = DIMENSION_FIELD[breakdownBy];
    setLabels((prev) => ({ ...prev, [field]: { id: item.id, label: item.label } }));
    setFilters(rowClickPatch(item, effective));
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
      setSelectedCall(null);
      setExecutionDetails(null);
    }
  };

  /** The breadcrumb "All Data": drill filters, business and category cleared; scope, window and group by kept. */
  const clearAllFilters = () => {
    setFilters(drillPatch({}));
    setSelectedCall(null);
  };

  /** A breadcrumb's text: the recorded label while its id is applied, else the value. */
  const labelOf = (field: DrillField) => drillValueLabel(labels, field, filters[field]);

  /** A KPI tile's target: the filtered view's real link, and the same patch applied in place. */
  const tile = (patch: Partial<AnalyticsFilters>) => ({
    href: `${ANALYTICS_PATH}${hrefFor(patch)}`,
    apply: () => setFilters(patch),
  });

  // Top consumers from items
  const topConsumers = [...items]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);

  // §5.10: loading and errors replace the content only; the header and the bar stay (F-55).
  const showContent = !error && hasLoaded;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="AI cost & usage" purpose={PURPOSE} />

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

      {error && <AdminError message={error} testId="analytics-error" onRetry={() => void fetchData(query)} />}
      {!error && !hasLoaded && <AdminLoading what={ANALYTICS_WHAT} />}

      {showContent && (
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
                Business OS only: includes legacy-tagged Business OS rows. Costs are USD, estimated from the model
                pricing table.
              </p>
            ) : (
              <p>Both products. Costs are USD, estimated from the model pricing table.</p>
            )}
            <p>Totals may be incomplete above {UNPAGED_ROW_CAP.toLocaleString('en-US')} calls in the selected period.</p>
          </div>
        </div>
      )}

      {/* MAIN CONTENT: Two Panels (3 cols left + 9 cols right); one column below xl (F-44) */}
      {showContent && (
      <div aria-busy={loading} className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* LEFT PANEL: Quick Stats and Top Consumers (3 cols); L-2b moves them below the table */}
        <aside className="xl:col-span-3 space-y-4">
          {/* Quick Stats */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-3">Quick Stats</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Calls</span>
                <span className="font-medium text-white">{formatNumber(totals.calls)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Avg Cost/Call</span>
                <span className="font-medium text-white">{totals.calls > 0 ? formatCost(totals.cost / totals.calls) : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Avg Tokens/Call</span>
                <span className="font-medium text-white">{totals.calls > 0 ? formatNumber(Math.round(totals.tokens / totals.calls)) : '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Input Tokens</span>
                <span className="font-medium text-white">{formatNumber(totals.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Output Tokens</span>
                <span className="font-medium text-white">{formatNumber(totals.outputTokens)}</span>
              </div>
            </div>
          </div>

          {/* Top Consumers */}
          {topConsumers.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <h3 className="text-sm font-medium text-white mb-3">Top Token Consumers</h3>
              <div className="space-y-3">
                {topConsumers.map((item, i) => {
                  const initials = item.label.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                  const colors = ['from-purple-500 to-blue-500', 'from-emerald-500 to-blue-500', 'from-orange-500 to-red-500'];
                  return (
                    <div key={item.id} className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${colors[i % 3]} flex items-center justify-center text-xs font-bold text-white`}>
                        {initials || '??'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{item.label}</div>
                        <div className="text-xs text-slate-500">{formatCost(item.cost)}</div>
                      </div>
                      <div className="text-sm text-purple-400">{item.percentage.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        {/* RIGHT PANEL: Data Table (9 cols) */}
        <section className="xl:col-span-9 space-y-4">

          {/* Breadcrumb Trail */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <button onClick={clearAllFilters} className="text-purple-400 hover:underline">All Data</button>
            {filters.provider && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider }));
                  }}
                  className={`${filters.model || filters.activity || filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('provider')}
                </button>
              </>
            )}
            {filters.model && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model }));
                  }}
                  className={`${filters.activity || filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('model')}
                </button>
              </>
            )}
            {filters.activity && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity }));
                  }}
                  className={`${filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('activity')}
                </button>
              </>
            )}
            {filters.account && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, account: filters.account }));
                  }}
                  className={`${filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('account')}
                </button>
              </>
            )}
            {filters.requestType && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, requestType: filters.requestType }));
                  }}
                  className={`${filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('requestType')}
                </button>
              </>
            )}
            {filters.feature && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, feature: filters.feature }));
                  }}
                  className={`${filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('feature')}
                </button>
              </>
            )}
            {filters.component && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, component: filters.component }));
                  }}
                  className={`${filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('component')}
                </button>
              </>
            )}
            {filters.endpoint && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, endpoint: filters.endpoint }));
                  }}
                  className={`${filters.account || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('endpoint')}
                </button>
              </>
            )}
            {scope === 'all' && filters.agent && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters(drillPatch({ provider: filters.provider, model: filters.model, activity: filters.activity, requestType: filters.requestType, feature: filters.feature, component: filters.component, endpoint: filters.endpoint, account: filters.account, agent: filters.agent }));
                  }}
                  className={`${filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {labelOf('agent')}
                </button>
              </>
            )}
            {scope === 'all' && filters.execution && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <span className="text-white" title={`Execution: ${filters.execution}`}>
                  {labelOf('execution')}
                </span>
              </>
            )}
            <span className="text-slate-500 ml-4">| Showing {items.length} {items.length === 1 ? 'item' : 'items'}</span>
          </div>

          {/* Data Table */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">{BREAKDOWN_OPTIONS.find(o => o.value === breakdownBy)?.label || 'Name'}</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  {items.length > 0 && items[0].type === 'call' ? (
                    <>
                      <th className="px-4 py-3 font-medium text-right">Input Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Output Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Total Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Latency</th>
                      <th className="px-4 py-3 font-medium text-right">Status</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 font-medium text-right">Tokens</th>
                      <th className="px-4 py-3 font-medium text-right">Calls</th>
                      {/* AgentsPilot taxonomy: in Business OS scope these would read
                          "-" on every row while the cost sits in System (W3-7). */}
                      {scope === 'all' && (
                        <>
                          <th data-testid="table-col-creation" className="px-4 py-3 font-medium text-right text-purple-400">Creation</th>
                          <th data-testid="table-col-execution" className="px-4 py-3 font-medium text-right text-emerald-400">Execution</th>
                          <th data-testid="table-col-memory" className="px-4 py-3 font-medium text-right text-blue-400">Memory</th>
                        </>
                      )}
                      <th className="px-4 py-3 font-medium text-right">Trend</th>
                      <th className="px-4 py-3 font-medium w-8"></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={scope === 'all' ? 9 : 6} className="px-6 py-12 text-center">
                      <Cpu className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                      <p className="text-lg font-medium text-slate-400">No data found</p>
                      <p className="text-sm text-slate-500">Try adjusting your filters or time period</p>
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const category = item.metadata?.category as string;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => handleRowClick(item)}
                        className={`transition-colors ${
                          item.type === 'call' ? 'cursor-default' : 'cursor-pointer hover:bg-purple-500/5'
                        }`}
                      >
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            {/* Model Icon for provider/model views */}
                            {(item.type === 'provider' || item.type === 'model') && (
                              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                                item.id.includes('gpt-4o') ? 'bg-gradient-to-br from-green-500 to-green-700' :
                                item.id.includes('gpt-4') ? 'bg-gradient-to-br from-green-400 to-green-600' :
                                item.id.includes('claude') ? 'bg-gradient-to-br from-purple-500 to-purple-700' :
                                item.id.includes('embedding') ? 'bg-gradient-to-br from-blue-500 to-blue-700' :
                                item.id === 'openai' ? 'bg-gradient-to-br from-emerald-500 to-emerald-700' :
                                item.id === 'anthropic' ? 'bg-gradient-to-br from-purple-500 to-purple-700' :
                                item.id === 'google' ? 'bg-gradient-to-br from-blue-500 to-blue-700' :
                                'bg-gradient-to-br from-slate-500 to-slate-700'
                              }`}>
                                {item.label.split('-')[0].slice(0, 3).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-medium text-white">{item.label}</div>
                              {/* Context chips */}
                              <ContextChips item={item} breakdownBy={breakdownBy} scope={scope} />
                              {/* Category badge for activity type */}
                              {item.type === 'activity' && category && (
                                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
                                  category === 'creation' ? 'bg-purple-500/20 text-purple-400' :
                                  category === 'execution' ? 'bg-emerald-500/20 text-emerald-400' :
                                  category === 'memory' ? 'bg-blue-500/20 text-blue-400' :
                                  category === 'system' ? 'bg-orange-500/20 text-orange-400' :
                                  'bg-slate-500/20 text-slate-400'
                                }`}>
                                  {category}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-white">{formatCost(item.cost)}</td>
                        {item.type === 'call' ? (
                          <>
                            <td className="px-4 py-4 text-right text-slate-400">{formatNumber(item.inputTokens)}</td>
                            <td className="px-4 py-4 text-right text-slate-400">{formatNumber(item.outputTokens)}</td>
                            <td className="px-4 py-4 text-right text-white font-medium">{formatNumber(item.tokens)}</td>
                            <td className="px-4 py-4 text-right text-slate-400">
                              {item.metadata?.latencyMs ? `${Math.round(item.metadata.latencyMs as number)}ms` : '-'}
                            </td>
                            <td className="px-4 py-4 text-right">
                              {item.metadata?.success ? (
                                <span className="text-green-400">✓</span>
                              ) : (
                                <span className="text-red-400">✗</span>
                              )}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-4 text-right text-slate-400">{formatNumber(item.tokens)}</td>
                            <td className="px-4 py-4 text-right text-slate-400">{formatNumber(item.calls)}</td>
                            {scope === 'all' && (
                              <>
                                <td className="px-4 py-4 text-right text-purple-400">
                                  {item.category_breakdown?.creation.cost ? formatCost(item.category_breakdown.creation.cost) : '-'}
                                </td>
                                <td className="px-4 py-4 text-right text-emerald-400">
                                  {item.category_breakdown?.execution.cost ? formatCost(item.category_breakdown.execution.cost) : '-'}
                                </td>
                                <td className="px-4 py-4 text-right text-blue-400">
                                  {item.category_breakdown?.memory.cost ? formatCost(item.category_breakdown.memory.cost) : '-'}
                                </td>
                              </>
                            )}
                            <td className="px-4 py-4 text-right">
                              {/* Trend placeholder - would need per-item comparison data */}
                              <span className="text-slate-500 text-sm">-</span>
                            </td>
                            <td className="px-4 py-4">
                              <ChevronRight className="w-5 h-5 text-slate-500" />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
              {/* Footer totals */}
              {items.length > 0 && items[0].type !== 'call' && (
                <tfoot className="bg-slate-900/30 border-t border-slate-600">
                  <tr className="text-sm">
                    <td className="px-4 py-3 font-medium text-white">
                      {filters.provider || filters.model || filters.activity || filters.agent ? 'Subtotal' : 'Total'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-white">{formatCost(totals.cost)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{formatNumber(totals.tokens)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{formatNumber(totals.calls)}</td>
                    {scope === 'all' && (
                      <>
                        <td className="px-4 py-3 text-right text-purple-400 font-medium">
                          {formatCost(categoryTotals?.creation.cost || 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                          {formatCost(categoryTotals?.execution.cost || 0)}
                        </td>
                        <td className="px-4 py-3 text-right text-blue-400 font-medium">
                          {formatCost(categoryTotals?.memory.cost || 0)}
                        </td>
                      </>
                    )}
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
              {items.length > 0 && items[0].type === 'call' && (
                <tfoot className="bg-slate-900/30 border-t border-slate-600">
                  <tr className="text-sm">
                    <td className="px-4 py-3 font-medium text-white">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-white">{formatCost(totals.cost)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{formatNumber(totals.inputTokens)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">{formatNumber(totals.outputTokens)}</td>
                    <td className="px-4 py-3 text-right font-bold text-white">{formatNumber(totals.tokens)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </div>
      )}

      {/* Agent Details Panel - shown when viewing execution calls */}
      {/* QA E-QA-1: a slow "All" response must not redraw this panel after a
          switch to Business OS scope. */}
      {showContent && scope === 'all' && executionDetails?.agent && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
        >
          <button
            onClick={() => setShowAgentJson(!showAgentJson)}
            className="w-full px-4 py-3 bg-slate-700/30 border-b border-slate-700 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <FileJson className="w-5 h-5 text-blue-400" />
              <div className="text-left">
                <h3 className="font-semibold text-white">{executionDetails.agent.name}</h3>
                <p className="text-xs text-slate-400">
                  {executionDetails.agent.mode && <span className="capitalize">{executionDetails.agent.mode}</span>}
                  {executionDetails.agent.status && <span className="ml-2 capitalize">• {executionDetails.agent.status}</span>}
                  {executionDetails.agent.connectedPlugins && executionDetails.agent.connectedPlugins.length > 0 && (
                    <span className="ml-2">• {executionDetails.agent.connectedPlugins.length} plugin(s)</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{showAgentJson ? 'Hide' : 'Show'} details</span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showAgentJson ? 'rotate-180' : ''}`} />
            </div>
          </button>

          <AnimatePresence>
            {showAgentJson && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                  {/* Execution Info */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-700/30 rounded-lg">
                    <div>
                      <p className="text-xs text-slate-400">Started</p>
                      <p className="text-sm text-white">
                        {executionDetails.startedAt
                          ? new Date(executionDetails.startedAt).toLocaleString()
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Completed</p>
                      <p className="text-sm text-white">
                        {executionDetails.completedAt
                          ? new Date(executionDetails.completedAt).toLocaleString()
                          : 'In Progress'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Status</p>
                      <p className={`text-sm font-medium ${
                        executionDetails.status === 'completed' ? 'text-green-400' :
                        executionDetails.status === 'failed' ? 'text-red-400' :
                        'text-yellow-400'
                      }`}>
                        {executionDetails.status || 'Unknown'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Agent ID</p>
                      <p className="text-xs text-slate-500 font-mono truncate" title={executionDetails.agent.id}>
                        {executionDetails.agent.id.slice(0, 8)}...
                      </p>
                    </div>
                  </div>

                  {/* Connected Plugins */}
                  {executionDetails.agent.connectedPlugins && executionDetails.agent.connectedPlugins.length > 0 && (
                    <div className="p-4 bg-slate-700/30 rounded-lg">
                      <p className="text-xs text-slate-400 mb-2">Connected Plugins</p>
                      <div className="flex flex-wrap gap-2">
                        {executionDetails.agent.connectedPlugins.map((plugin: string) => (
                          <span key={plugin} className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full">
                            {plugin}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Call Detail Modal */}
      <AnimatePresence>
        {selectedCall && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setSelectedCall(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-slate-800 rounded-xl border border-slate-700 shadow-2xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <div className="flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-blue-400" />
                  <h3 className="font-semibold text-white">Call Details</h3>
                  {selectedCall.metadata?.success !== undefined && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      selectedCall.metadata.success
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-red-500/20 text-red-300'
                    }`}>
                      {selectedCall.metadata.success ? 'Success' : 'Failed'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedCall(null)}
                  className="p-1 hover:bg-slate-700 rounded transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[70dvh] overflow-y-auto">
                {/* Primary Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Model</p>
                    <p className="text-sm font-medium text-white">{selectedCall.metadata?.model as string || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Provider</p>
                    <p className="text-sm font-medium text-white capitalize">{selectedCall.metadata?.provider as string || 'Unknown'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Cost</p>
                    <p className={`text-sm font-semibold ${selectedCall.isHighCost ? 'text-red-300' : 'text-green-300'}`}>
                      {formatCost(selectedCall.cost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Success</p>
                    <p className={`text-sm font-medium ${selectedCall.metadata?.success ? 'text-green-300' : 'text-red-300'}`}>
                      {selectedCall.metadata?.success ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>

                <div className="h-px bg-slate-700" />

                {/* Token Breakdown */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Input Tokens</p>
                    <p className="text-sm text-white">{formatNumber(selectedCall.metadata?.inputTokens as number || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Output Tokens</p>
                    <p className="text-sm text-white">{formatNumber(selectedCall.metadata?.outputTokens as number || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Total Tokens</p>
                    <p className="text-sm font-medium text-white">{formatNumber(selectedCall.tokens)}</p>
                  </div>
                </div>

                <div className="h-px bg-slate-700" />

                {/* Request Classification */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Classification</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedCall.metadata?.requestType && (
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Request Type</p>
                        <p className="text-sm text-white">{selectedCall.metadata.requestType as string}</p>
                      </div>
                    )}
                    {selectedCall.metadata?.dbCategory && (
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Category</p>
                        <p className="text-sm text-white capitalize">{selectedCall.metadata.dbCategory as string}</p>
                      </div>
                    )}
                    {selectedCall.metadata?.category && (
                      <div>
                        <p className="text-xs text-slate-400 mb-1">BI Category</p>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          selectedCall.metadata.category === 'creation' ? 'bg-purple-500/20 text-purple-400' :
                          selectedCall.metadata.category === 'execution' ? 'bg-emerald-500/20 text-emerald-400' :
                          selectedCall.metadata.category === 'memory' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-orange-500/20 text-orange-400'
                        }`}>
                          {selectedCall.metadata.category as string}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Activity Details */}
                {(selectedCall.metadata?.activityType || selectedCall.metadata?.activityName || selectedCall.metadata?.activityStep) && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">Activity</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {selectedCall.metadata?.activityType && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Activity Type</p>
                            <p className="text-sm text-white">{selectedCall.metadata.activityType as string}</p>
                          </div>
                        )}
                        {selectedCall.metadata?.activityName && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Activity Name</p>
                            <p className="text-sm text-white">{selectedCall.metadata.activityName as string}</p>
                          </div>
                        )}
                        {selectedCall.metadata?.activityStep && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Activity Step</p>
                            <p className="text-sm text-white">{selectedCall.metadata.activityStep as string}</p>
                          </div>
                        )}
                        {selectedCall.metadata?.workflowStep && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Workflow Step</p>
                            <p className="text-sm text-white">{selectedCall.metadata.workflowStep as string}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {/* System Context */}
                {(selectedCall.metadata?.feature || selectedCall.metadata?.component || selectedCall.metadata?.endpoint) && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 mb-3 uppercase tracking-wider">System Context</h4>
                      <div className="grid grid-cols-2 gap-4">
                        {selectedCall.metadata?.feature && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Feature</p>
                            <p className="text-sm text-white">{selectedCall.metadata.feature as string}</p>
                          </div>
                        )}
                        {selectedCall.metadata?.component && (
                          <div>
                            <p className="text-xs text-slate-400 mb-1">Component</p>
                            <p className="text-sm text-white">{selectedCall.metadata.component as string}</p>
                          </div>
                        )}
                        {selectedCall.metadata?.endpoint && (
                          <div className="col-span-2">
                            <p className="text-xs text-slate-400 mb-1">Endpoint</p>
                            <p className="text-sm text-white font-mono text-xs bg-slate-900/50 px-2 py-1 rounded border border-slate-700">
                              {selectedCall.metadata.endpoint as string}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {(selectedCall.metadata?.latencyMs || selectedCall.metadata?.timestamp) && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div className="grid grid-cols-2 gap-4">
                      {selectedCall.metadata?.latencyMs && (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-slate-400" />
                          <div>
                            <p className="text-xs text-slate-400">Latency</p>
                            <p className="text-sm text-white">
                              {(selectedCall.metadata.latencyMs as number) >= 1000
                                ? `${((selectedCall.metadata.latencyMs as number) / 1000).toFixed(2)}s`
                                : `${selectedCall.metadata.latencyMs}ms`}
                            </p>
                          </div>
                        </div>
                      )}
                      {selectedCall.metadata?.timestamp && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <div>
                            <p className="text-xs text-slate-400">Time</p>
                            <p className="text-sm text-white">
                              {new Date(selectedCall.metadata.timestamp as string).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {selectedCall.metadata?.callId && (
                  <>
                    <div className="h-px bg-slate-700" />
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-slate-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400">Call ID</p>
                        <p className="text-xs text-slate-500 font-mono truncate">{selectedCall.metadata.callId as string}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
