'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Calendar,
  DollarSign,
  Zap,
  BarChart3,
  AlertCircle,
  ChevronDown,
  Cpu,
  X,
  ArrowRight,
  Hash,
  Clock,
  Layers,
  Activity,
  Users,
  Bot,
  Database,
  Code,
  FileJson,
  ChevronRight,
  Check
} from 'lucide-react';

// Types
interface CategoryBreakdown {
  creation: { cost: number; tokens: number; calls: number };
  execution: { cost: number; tokens: number; calls: number };
  memory: { cost: number; tokens: number; calls: number };
  system: { cost: number; tokens: number; calls: number };
}

interface PeriodComparison {
  previousPeriod: {
    cost: number;
    tokens: number;
    calls: number;
    from: string;
    to: string;
  };
  changes: {
    costPct: number;
    tokensPct: number;
    callsPct: number;
  };
}

interface DrillDownItem {
  id: string;
  label: string;
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  percentage: number;
  type: 'provider' | 'model' | 'activity' | 'user' | 'agent' | 'execution' | 'call';
  metadata?: Record<string, unknown>;
  isHighCost?: boolean;
  category_breakdown?: CategoryBreakdown;
}

interface Filters {
  provider?: string;
  model?: string;
  activity?: string;
  user?: string;
  agent?: string;
  execution?: string;
  category?: string;
  request_type?: string;
  feature?: string;
  component?: string;
  endpoint?: string;
}

interface FilterLabels {
  provider?: string;
  model?: string;
  activity?: string;
  user?: string;
  agent?: string;
  execution?: string;
  category?: string;
  request_type?: string;
  feature?: string;
  component?: string;
  endpoint?: string;
}

interface AvailableFilters {
  providers: string[];
  models: string[];
  activities: string[];
  users: Array<{ id: string; label: string }>;
  agents: Array<{ id: string; label: string }>;
}

interface AgentData {
  id: string;
  name: string;
  userPrompt?: string;
  systemPrompt?: string;
  pilotSteps?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  connectedPlugins?: string[];
  mode?: string;
  status?: string;
}

interface ExecutionDetails {
  executionId: string;
  startedAt?: string;
  completedAt?: string;
  status?: string;
  inputData?: unknown;
  outputData?: unknown;
  agent?: AgentData | null;
}

type CategoryTotals = CategoryBreakdown;

interface DrillDownResponse {
  success: boolean;
  totals: { cost: number; tokens: number; inputTokens: number; outputTokens: number; calls: number };
  items: DrillDownItem[];
  filters: Filters;
  availableFilters: AvailableFilters;
  executionDetails?: ExecutionDetails;
  categoryTotals?: CategoryTotals;
  period?: { from: string; to: string };
  comparison?: PeriodComparison;
}

type BreakdownDimension = 'provider' | 'model' | 'activity' | 'user' | 'agent' | 'execution' | 'request_type' | 'feature' | 'component' | 'endpoint';

const PERIOD_OPTIONS = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: -1, label: 'Custom' },
] as const;

const BREAKDOWN_OPTIONS: Array<{ value: BreakdownDimension; label: string; icon: React.ElementType }> = [
  { value: 'provider', label: 'Provider', icon: Layers },
  { value: 'model', label: 'Model', icon: Cpu },
  { value: 'activity', label: 'Activity Type', icon: Activity },
  { value: 'request_type', label: 'Request Type', icon: Code },
  { value: 'feature', label: 'Feature', icon: Zap },
  { value: 'component', label: 'Component', icon: FileJson },
  { value: 'endpoint', label: 'Endpoint', icon: ArrowRight },
  { value: 'user', label: 'User', icon: Users },
  { value: 'agent', label: 'Agent', icon: Bot },
  { value: 'execution', label: 'Execution', icon: Database },
];

/**
 * Context chips showing related dimensions
 */
function ContextChips({ item, breakdownBy }: { item: DrillDownItem; breakdownBy: BreakdownDimension }) {
  const chips: React.ReactNode[] = [];
  const meta = item.metadata || {};

  if (breakdownBy !== 'user' && meta.userCount && (meta.userCount as number) > 0) {
    chips.push(
      <span key="users" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.userCount} users
      </span>
    );
  }

  if (breakdownBy !== 'agent' && meta.agentCount && (meta.agentCount as number) > 0) {
    chips.push(
      <span key="agents" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.agentCount} agents
      </span>
    );
  }

  if (breakdownBy !== 'execution' && meta.executionCount && (meta.executionCount as number) > 0) {
    chips.push(
      <span key="executions" className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
        {meta.executionCount} executions
      </span>
    );
  }

  if (chips.length === 0) return null;
  return <div className="flex gap-1 flex-wrap mt-1">{chips}</div>;
}

export default function AdminCostAnalytics() {
  const [breakdownBy, setBreakdownBy] = useState<BreakdownDimension>('provider');
  const [filters, setFilters] = useState<Filters>({});
  const [filterLabels, setFilterLabels] = useState<FilterLabels>({});
  const [items, setItems] = useState<DrillDownItem[]>([]);
  const [totals, setTotals] = useState({ cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, calls: 0 });
  const [availableFilters, setAvailableFilters] = useState<AvailableFilters>({
    providers: [], models: [], activities: [], users: [], agents: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<number>(30);
  const [customDateFrom, setCustomDateFrom] = useState<string>('');
  const [customDateTo, setCustomDateTo] = useState<string>('');
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [appliedDateRange, setAppliedDateRange] = useState<{ from: string; to: string } | null>(null);
  const [selectedCall, setSelectedCall] = useState<DrillDownItem | null>(null);
  const [executionDetails, setExecutionDetails] = useState<ExecutionDetails | null>(null);
  const [categoryTotals, setCategoryTotals] = useState<CategoryTotals | null>(null);
  const [showAgentJson, setShowAgentJson] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['pilotSteps']));
  const [comparison, setComparison] = useState<PeriodComparison | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({ breakdownBy });

      if (filters.provider) queryParams.set('provider', filters.provider);
      if (filters.model) queryParams.set('model', filters.model);
      if (filters.activity) queryParams.set('activity', filters.activity);
      if (filters.request_type) queryParams.set('request_type', filters.request_type);
      if (filters.feature) queryParams.set('feature', filters.feature);
      if (filters.component) queryParams.set('component', filters.component);
      if (filters.endpoint) queryParams.set('endpoint', filters.endpoint);
      if (filters.user) queryParams.set('user', filters.user);
      if (filters.agent) queryParams.set('agent', filters.agent);
      if (filters.execution) queryParams.set('execution', filters.execution);
      if (filters.category && filters.category !== 'all') queryParams.set('category', filters.category);

      if (period === -1 && appliedDateRange) {
        queryParams.set('dateFrom', new Date(appliedDateRange.from).toISOString());
        queryParams.set('dateTo', new Date(appliedDateRange.to + 'T23:59:59').toISOString());
      } else if (period > 0) {
        queryParams.set('period', period.toString());
      }

      const response = await fetch(`/api/admin/token-usage/drill-down?${queryParams}`, {
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result: DrillDownResponse = await response.json();

      if (!result.success) {
        throw new Error('API returned unsuccessful response');
      }

      setItems(result.items);
      setTotals(result.totals);
      setAvailableFilters(result.availableFilters);
      if (result.executionDetails) {
        setExecutionDetails(result.executionDetails);
      } else {
        setExecutionDetails(null);
      }
      if (result.categoryTotals) {
        setCategoryTotals(result.categoryTotals);
      } else {
        setCategoryTotals(null);
      }
      if (result.comparison) {
        setComparison(result.comparison);
      } else {
        setComparison(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setItems([]);
      setTotals({ cost: 0, tokens: 0, inputTokens: 0, outputTokens: 0, calls: 0 });
    } finally {
      setLoading(false);
    }
  }, [breakdownBy, filters, period, appliedDateRange]);

  useEffect(() => {
    if (period === -1) {
      if (appliedDateRange) {
        fetchData();
      }
    } else {
      fetchData();
    }
  }, [fetchData, period, appliedDateRange]);

  const handleRowClick = (item: DrillDownItem) => {
    if (item.type === 'call') {
      setSelectedCall(item);
      return;
    }

    const newFilters = { ...filters };
    const newLabels = { ...filterLabels };
    let nextBreakdown: BreakdownDimension = breakdownBy;

    switch (breakdownBy) {
      case 'provider':
        newFilters.provider = item.id;
        newLabels.provider = item.label;
        nextBreakdown = 'model';
        break;
      case 'model':
        newFilters.model = item.id;
        newLabels.model = item.label;
        nextBreakdown = 'activity';
        break;
      case 'activity':
        newFilters.activity = item.id;
        newLabels.activity = item.label;
        nextBreakdown = 'agent';
        break;
      case 'request_type':
        newFilters.request_type = item.id;
        newLabels.request_type = item.label;
        nextBreakdown = 'agent';
        break;
      case 'feature':
        newFilters.feature = item.id;
        newLabels.feature = item.label;
        nextBreakdown = 'agent';
        break;
      case 'component':
        newFilters.component = item.id;
        newLabels.component = item.label;
        nextBreakdown = 'agent';
        break;
      case 'endpoint':
        newFilters.endpoint = item.id;
        newLabels.endpoint = item.label;
        nextBreakdown = 'agent';
        break;
      case 'user':
        newFilters.user = item.id;
        newLabels.user = item.label;
        nextBreakdown = 'agent';
        break;
      case 'agent':
        newFilters.agent = item.id;
        newLabels.agent = item.label;
        nextBreakdown = 'execution';
        break;
      case 'execution':
        newFilters.execution = item.id;
        newLabels.execution = item.label;
        break;
    }

    setFilters(newFilters);
    setFilterLabels(newLabels);
    setBreakdownBy(nextBreakdown);
  };

  const removeFilter = (key: keyof Filters) => {
    const newFilters = { ...filters };
    const newLabels = { ...filterLabels };
    delete newFilters[key];
    delete newLabels[key];
    setFilters(newFilters);
    setFilterLabels(newLabels);
  };

  const clearAllFilters = () => {
    setFilters({});
    setFilterLabels({});
    setSelectedCall(null);
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return new Intl.NumberFormat('en-US').format(num);
  };

  const handlePeriodSelect = (value: number) => {
    if (value === -1) {
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
      const toDate = today.toISOString().split('T')[0];
      setCustomDateFrom(fromDate);
      setCustomDateTo(toDate);
      setAppliedDateRange({ from: fromDate, to: toDate });
      setShowCustomDatePicker(true);
    } else {
      setShowCustomDatePicker(false);
      setAppliedDateRange(null);
    }
    setPeriod(value);
  };

  const handleApplyDateRange = () => {
    if (customDateFrom && customDateTo) {
      setAppliedDateRange({ from: customDateFrom, to: customDateTo });
    }
  };

  const activeFiltersCount = Object.keys(filters).filter(k => k !== 'category' || filters.category !== 'all').length;

  // Calculate category percentages
  const totalCategoryCost = categoryTotals
    ? categoryTotals.creation.cost + categoryTotals.execution.cost + categoryTotals.memory.cost + categoryTotals.system.cost
    : totals.cost;

  const getCategoryPct = (cost: number) => {
    if (totalCategoryCost === 0) return 0;
    return Math.round((cost / totalCategoryCost) * 100);
  };

  // Top consumers from items
  const topConsumers = [...items]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading cost analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-6 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-300 mb-2">Failed to Load Analytics</h3>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/30"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-700 pb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">Token Usage Analytics</h1>
          <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">BI System</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Period Selector - Inline Button Group */}
          <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => handlePeriodSelect(option.value)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  period === option.value
                    ? 'bg-purple-500 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {option.value === -1 ? (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {option.label}
                  </span>
                ) : option.label}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Custom Date Range Picker */}
      {showCustomDatePicker && (
        <div className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2">
          <input
            type="date"
            value={customDateFrom}
            onChange={(e) => setCustomDateFrom(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white [color-scheme:dark]"
          />
          <span className="text-slate-500">to</span>
          <input
            type="date"
            value={customDateTo}
            onChange={(e) => setCustomDateTo(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white [color-scheme:dark]"
          />
          <button
            onClick={handleApplyDateRange}
            disabled={!customDateFrom || !customDateTo}
            className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}

      {/* TOP SECTION: Category Summary Cards - 5 cards in a row */}
      <section className="grid grid-cols-5 gap-4">
        {/* Total */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">Total Spend</span>
            <span className="text-xs px-2 py-0.5 rounded bg-slate-600/50 text-slate-400">All</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCost(totals.cost)}</div>
          <div className="text-sm text-slate-400">{formatNumber(totals.tokens)} tokens</div>
          {comparison && (
            <div className="flex items-center gap-1 mt-2 text-xs">
              <span className={comparison.changes.costPct > 0 ? 'text-red-400' : comparison.changes.costPct < 0 ? 'text-green-400' : 'text-slate-400'}>
                {comparison.changes.costPct > 0 ? '+' : ''}{comparison.changes.costPct.toFixed(1)}%
              </span>
              <span className="text-slate-500">vs prev period</span>
            </div>
          )}
        </div>

        {/* Creation */}
        <button
          onClick={() => {
            if (filters.category === 'creation') {
              removeFilter('category');
            } else {
              setFilters(prev => ({ ...prev, category: 'creation' }));
              setFilterLabels(prev => ({ ...prev, category: 'Creation' }));
            }
          }}
          className={`bg-slate-800 border rounded-xl p-5 cursor-pointer transition-all text-left ${
            filters.category === 'creation'
              ? 'border-purple-500 ring-1 ring-purple-500/50'
              : 'border-purple-500/30 hover:border-purple-500/60'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">Creation</span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
              {getCategoryPct(categoryTotals?.creation.cost || 0)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-purple-400 mb-1">
            {formatCost(categoryTotals?.creation.cost || 0)}
          </div>
          <div className="text-sm text-slate-400">{formatNumber(categoryTotals?.creation.tokens || 0)} tokens</div>
          <div className="text-xs text-slate-500 mt-2">Intent, Semantic Plan, IR</div>
        </button>

        {/* Execution */}
        <button
          onClick={() => {
            if (filters.category === 'execution') {
              removeFilter('category');
            } else {
              setFilters(prev => ({ ...prev, category: 'execution' }));
              setFilterLabels(prev => ({ ...prev, category: 'Execution' }));
            }
          }}
          className={`bg-slate-800 border rounded-xl p-5 cursor-pointer transition-all text-left ${
            filters.category === 'execution'
              ? 'border-emerald-500 ring-1 ring-emerald-500/50'
              : 'border-emerald-500/30 hover:border-emerald-500/60'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">Execution</span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
              {getCategoryPct(categoryTotals?.execution.cost || 0)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-emerald-400 mb-1">
            {formatCost(categoryTotals?.execution.cost || 0)}
          </div>
          <div className="text-sm text-slate-400">{formatNumber(categoryTotals?.execution.tokens || 0)} tokens</div>
          <div className="text-xs text-slate-500 mt-2">Agent runs, LLM decisions</div>
        </button>

        {/* Memory */}
        <button
          onClick={() => {
            if (filters.category === 'memory') {
              removeFilter('category');
            } else {
              setFilters(prev => ({ ...prev, category: 'memory' }));
              setFilterLabels(prev => ({ ...prev, category: 'Memory' }));
            }
          }}
          className={`bg-slate-800 border rounded-xl p-5 cursor-pointer transition-all text-left ${
            filters.category === 'memory'
              ? 'border-blue-500 ring-1 ring-blue-500/50'
              : 'border-blue-500/30 hover:border-blue-500/60'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">Memory</span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">
              {getCategoryPct(categoryTotals?.memory.cost || 0)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-blue-400 mb-1">
            {formatCost(categoryTotals?.memory.cost || 0)}
          </div>
          <div className="text-sm text-slate-400">{formatNumber(categoryTotals?.memory.tokens || 0)} tokens</div>
          <div className="text-xs text-slate-500 mt-2">Embeddings, summarization</div>
        </button>

        {/* System */}
        <button
          onClick={() => {
            if (filters.category === 'system') {
              removeFilter('category');
            } else {
              setFilters(prev => ({ ...prev, category: 'system' }));
              setFilterLabels(prev => ({ ...prev, category: 'System' }));
            }
          }}
          className={`bg-slate-800 border rounded-xl p-5 cursor-pointer transition-all text-left ${
            filters.category === 'system'
              ? 'border-orange-500 ring-1 ring-orange-500/50'
              : 'border-orange-500/30 hover:border-orange-500/60'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-400">System</span>
            <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
              {getCategoryPct(categoryTotals?.system.cost || 0)}%
            </span>
          </div>
          <div className="text-2xl font-bold text-orange-400 mb-1">
            {formatCost(categoryTotals?.system.cost || 0)}
          </div>
          <div className="text-sm text-slate-400">{formatNumber(categoryTotals?.system.tokens || 0)} tokens</div>
          <div className="text-xs text-slate-500 mt-2">Platform, calibration</div>
        </button>
      </section>

      {/* MAIN CONTENT: Two Panels (3 cols left + 9 cols right) */}
      <div className="grid grid-cols-12 gap-6">

        {/* LEFT PANEL: Filters & Dimensions (3 cols) */}
        <aside className="col-span-3 space-y-4">

          {/* Active Filters */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-white">Active Filters</h3>
              {activeFiltersCount > 0 && (
                <button onClick={clearAllFilters} className="text-xs text-purple-400 hover:underline">
                  Clear all
                </button>
              )}
            </div>
            <div className="space-y-2">
              {activeFiltersCount === 0 ? (
                <div className="text-xs text-slate-500 text-center py-2">Click any dimension to filter</div>
              ) : (
                <>
                  {filters.category && filters.category !== 'all' && (
                    <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                      filters.category === 'creation' ? 'bg-purple-500/10 border border-purple-500/30' :
                      filters.category === 'execution' ? 'bg-emerald-500/10 border border-emerald-500/30' :
                      filters.category === 'memory' ? 'bg-blue-500/10 border border-blue-500/30' :
                      'bg-orange-500/10 border border-orange-500/30'
                    }`}>
                      <span className="text-sm text-white">Category: {filterLabels.category}</span>
                      <button onClick={() => removeFilter('category')} className="text-slate-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.provider && (
                    <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white">Provider: {filterLabels.provider}</span>
                      <button onClick={() => removeFilter('provider')} className="text-slate-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.model && (
                    <div className="flex items-center justify-between bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white">Model: {filterLabels.model}</span>
                      <button onClick={() => removeFilter('model')} className="text-slate-400 hover:text-white">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.activity && (
                    <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white truncate">Activity: {filterLabels.activity}</span>
                      <button onClick={() => removeFilter('activity')} className="text-slate-400 hover:text-white flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.user && (
                    <div className="flex items-center justify-between bg-pink-500/10 border border-pink-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white truncate">User: {filterLabels.user}</span>
                      <button onClick={() => removeFilter('user')} className="text-slate-400 hover:text-white flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.agent && (
                    <div className="flex items-center justify-between bg-violet-500/10 border border-violet-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white truncate">Agent: {filterLabels.agent}</span>
                      <button onClick={() => removeFilter('agent')} className="text-slate-400 hover:text-white flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {filters.execution && (
                    <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
                      <span className="text-sm text-white truncate">Execution: {filterLabels.execution?.slice(0, 12)}...</span>
                      <button onClick={() => removeFilter('execution')} className="text-slate-400 hover:text-white flex-shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Dimension Selector */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-sm font-medium text-white mb-3">Group By</h3>
            <div className="space-y-2">
              {BREAKDOWN_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = breakdownBy === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => setBreakdownBy(option.value)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-purple-500/20 border border-purple-500 text-white'
                        : 'border border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {option.label}
                    </span>
                    {isSelected && <Check className="w-4 h-4" />}
                  </button>
                );
              })}
            </div>
          </div>

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
        <section className="col-span-9 space-y-4">

          {/* Breadcrumb Trail */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <button onClick={clearAllFilters} className="text-purple-400 hover:underline">All Data</button>
            {filters.provider && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider });
                    setFilterLabels({ provider: filterLabels.provider });
                  }}
                  className={`${filters.model || filters.activity || filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.provider}
                </button>
              </>
            )}
            {filters.model && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model });
                  }}
                  className={`${filters.activity || filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.model}
                </button>
              </>
            )}
            {filters.activity && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity });
                  }}
                  className={`${filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.activity}
                </button>
              </>
            )}
            {filters.user && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, user: filters.user });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, user: filterLabels.user });
                  }}
                  className={`${filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.user}
                </button>
              </>
            )}
            {filters.request_type && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, request_type: filters.request_type });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, request_type: filterLabels.request_type });
                  }}
                  className={`${filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.request_type}
                </button>
              </>
            )}
            {filters.feature && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, feature: filters.feature });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, feature: filterLabels.feature });
                  }}
                  className={`${filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.feature}
                </button>
              </>
            )}
            {filters.component && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, component: filters.component });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, component: filterLabels.component });
                  }}
                  className={`${filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.component}
                </button>
              </>
            )}
            {filters.endpoint && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, endpoint: filters.endpoint });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, endpoint: filterLabels.endpoint });
                  }}
                  className={`${filters.user || filters.agent || filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.endpoint}
                </button>
              </>
            )}
            {filters.agent && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <button
                  onClick={() => {
                    setFilters({ provider: filters.provider, model: filters.model, activity: filters.activity, request_type: filters.request_type, feature: filters.feature, component: filters.component, endpoint: filters.endpoint, user: filters.user, agent: filters.agent });
                    setFilterLabels({ provider: filterLabels.provider, model: filterLabels.model, activity: filterLabels.activity, request_type: filterLabels.request_type, feature: filterLabels.feature, component: filterLabels.component, endpoint: filterLabels.endpoint, user: filterLabels.user, agent: filterLabels.agent });
                  }}
                  className={`${filters.execution ? 'text-purple-400 hover:underline' : 'text-white'}`}
                >
                  {filterLabels.agent}
                </button>
              </>
            )}
            {filters.execution && (
              <>
                <ChevronRight className="w-4 h-4 text-slate-500" />
                <span className="text-white" title={`Execution: ${filters.execution}`}>
                  {filterLabels.execution || `Exec: ${filters.execution.slice(0, 8)}...`}
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
                      <th className="px-4 py-3 font-medium text-right text-purple-400">Creation</th>
                      <th className="px-4 py-3 font-medium text-right text-emerald-400">Execution</th>
                      <th className="px-4 py-3 font-medium text-right text-blue-400">Memory</th>
                      <th className="px-4 py-3 font-medium text-right">Trend</th>
                      <th className="px-4 py-3 font-medium w-8"></th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
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
                              <ContextChips item={item} breakdownBy={breakdownBy} />
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
                            <td className="px-4 py-4 text-right text-purple-400">
                              {item.category_breakdown?.creation.cost ? formatCost(item.category_breakdown.creation.cost) : '-'}
                            </td>
                            <td className="px-4 py-4 text-right text-emerald-400">
                              {item.category_breakdown?.execution.cost ? formatCost(item.category_breakdown.execution.cost) : '-'}
                            </td>
                            <td className="px-4 py-4 text-right text-blue-400">
                              {item.category_breakdown?.memory.cost ? formatCost(item.category_breakdown.memory.cost) : '-'}
                            </td>
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
                    <td className="px-4 py-3 text-right text-purple-400 font-medium">
                      {formatCost(categoryTotals?.creation.cost || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                      {formatCost(categoryTotals?.execution.cost || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-400 font-medium">
                      {formatCost(categoryTotals?.memory.cost || 0)}
                    </td>
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

      {/* Agent Details Panel - shown when viewing execution calls */}
      {executionDetails?.agent && (
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

                  {/* Collapsible JSON Sections */}
                  {executionDetails.agent.pilotSteps && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('pilotSteps')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-medium text-white">Pilot Steps (Workflow DSL)</span>
                          <span className="text-xs text-slate-500">
                            {Array.isArray(executionDetails.agent.pilotSteps)
                              ? `${executionDetails.agent.pilotSteps.length} steps`
                              : ''}
                          </span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('pilotSteps') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('pilotSteps') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                            {JSON.stringify(executionDetails.agent.pilotSteps, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {executionDetails.agent.inputSchema && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('inputSchema')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-blue-400" />
                          <span className="text-sm font-medium text-white">Input Schema</span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('inputSchema') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('inputSchema') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                            {JSON.stringify(executionDetails.agent.inputSchema, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {executionDetails.agent.outputSchema && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('outputSchema')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-amber-400" />
                          <span className="text-sm font-medium text-white">Output Schema</span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('outputSchema') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('outputSchema') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                            {JSON.stringify(executionDetails.agent.outputSchema, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {executionDetails.inputData && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('inputData')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm font-medium text-white">Execution Input</span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('inputData') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('inputData') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                            {JSON.stringify(executionDetails.inputData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {executionDetails.outputData && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('outputData')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Code className="w-4 h-4 text-pink-400" />
                          <span className="text-sm font-medium text-white">Execution Output</span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('outputData') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('outputData') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap">
                            {JSON.stringify(executionDetails.outputData, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {executionDetails.agent.userPrompt && (
                    <div className="border border-slate-700 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSection('userPrompt')}
                        className="w-full px-4 py-3 flex items-center justify-between bg-slate-700/30 hover:bg-slate-700/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-medium text-white">User Prompt</span>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${expandedSections.has('userPrompt') ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedSections.has('userPrompt') && (
                        <div className="p-4 bg-slate-900/50 overflow-x-auto">
                          <pre className="text-sm text-slate-300 whitespace-pre-wrap">
                            {executionDetails.agent.userPrompt}
                          </pre>
                        </div>
                      )}
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

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
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
