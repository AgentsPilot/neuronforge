/**
 * AI cost & usage: the route's response types, the group-by dimensions and the
 * two number formatters (Admin Layout Standard L-2a, workplan §2.2).
 *
 * Moved out of `page.tsx` so the page's filter, KPI and bar files can share
 * them. A move, not a rewrite, with three named exceptions (SA S-4):
 * `BREAKDOWN_OPTIONS` lost its icons (the Group by select shows none),
 * `formatCost` / `formatNumber` became module functions instead of closures in
 * the component (same bodies), and the page-only `FilterLabels` and
 * `PERIOD_OPTIONS` were not moved (the drill labels are now page state keyed by
 * filter, and the window is the shared Window control).
 */

// Types
export interface CategoryBreakdown {
  creation: { cost: number; tokens: number; calls: number };
  execution: { cost: number; tokens: number; calls: number };
  memory: { cost: number; tokens: number; calls: number };
  system: { cost: number; tokens: number; calls: number };
}

export interface PeriodComparison {
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

export interface DrillDownItem {
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

export interface Filters {
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

export interface AvailableFilters {
  providers: string[];
  models: string[];
  activities: string[];
  users: Array<{ id: string; label: string }>;
  agents: Array<{ id: string; label: string }>;
}

/**
 * Metadata only (ADMIN_BOS_CLEANUP C3-5, FYI-1): this is a cross-account admin
 * view, so it carries no prompt, step, schema or run payload.
 */
export interface AgentData {
  id: string;
  name: string;
  connectedPlugins?: string[] | null;
  mode?: string | null;
  status?: string | null;
}

export interface ExecutionDetails {
  executionId: string;
  startedAt?: string;
  completedAt?: string;
  status?: string;
  agent?: AgentData | null;
}

export type CategoryTotals = CategoryBreakdown;

export interface DrillDownResponse {
  success: boolean;
  totals: { cost: number; tokens: number; inputTokens: number; outputTokens: number; calls: number };
  items: DrillDownItem[];
  filters: Filters;
  availableFilters: AvailableFilters;
  executionDetails?: ExecutionDetails;
  categoryTotals?: CategoryTotals;
  period?: { from: string; to: string };
  comparison?: PeriodComparison;
  scope?: 'bos' | 'all';
  /** The unpaged read hit the 1,000-row cap; totals may be missing rows. */
  possiblyIncomplete?: boolean;
}

/** 'bos' = the platform's Business OS row definition, applied by the route. */
export type Scope = 'bos' | 'all';

/** PostgREST's row cap on the (unpaged) ledger read. Parked: see the notes on screen. */
export const UNPAGED_ROW_CAP = 1000;

export type BreakdownDimension = 'provider' | 'model' | 'activity' | 'user' | 'agent' | 'execution' | 'request_type' | 'feature' | 'component' | 'endpoint';

export const BREAKDOWN_OPTIONS: Array<{ value: BreakdownDimension; label: string }> = [
  { value: 'provider', label: 'Provider' },
  { value: 'model', label: 'Model' },
  { value: 'activity', label: 'Activity Type' },
  { value: 'request_type', label: 'Request Type' },
  { value: 'feature', label: 'Feature' },
  { value: 'component', label: 'Component' },
  { value: 'endpoint', label: 'Endpoint' },
  { value: 'user', label: 'User' },
  { value: 'agent', label: 'Agent' },
  { value: 'execution', label: 'Execution' },
];

/**
 * Views that exist only for AgentsPilot agents. Business OS scope has no agents
 * or executions, and the route refuses these views there (ADMIN_BOS_CLEANUP
 * C3-2, C3-3). The Group By menu, the row-click drill path and the scope toggle
 * all read this one set, so they cannot disagree.
 */
export const BOS_HIDDEN_DIMENSIONS: ReadonlySet<BreakdownDimension> = new Set<BreakdownDimension>(['agent', 'execution']);

/** Business OS drill order: feature, then component, then account (FYI-2). */
export const BOS_DRILL_ORDER: readonly BreakdownDimension[] = ['feature', 'component', 'user', 'model', 'provider'];

export function breakdownOptionsFor(scope: Scope) {
  return scope === 'bos' ? BREAKDOWN_OPTIONS.filter((o) => !BOS_HIDDEN_DIMENSIONS.has(o.value)) : BREAKDOWN_OPTIONS;
}

/**
 * Where a Business OS row click goes when the "All" path would reach a hidden
 * view: the first drill dimension not already filtered and not the one just
 * clicked. Null when every one is taken, in which case the view stays put.
 */
export function bosDrillTarget(nextFilters: Filters, clicked: BreakdownDimension): BreakdownDimension | null {
  return BOS_DRILL_ORDER.find((d) => d !== clicked && !nextFilters[d]) ?? null;
}

export function formatCost(cost: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(cost);
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US').format(num);
}
