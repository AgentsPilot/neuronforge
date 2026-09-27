'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import {
  Search, Filter, Calendar, User, Activity, AlertCircle,
  CheckCircle, Info, AlertTriangle, ChevronDown, ChevronUp,
  Download, RefreshCw, FileText, Database, TrendingUp,
  LogIn, LogOut, UserPlus, UserCog, Bot, Play, Trash2, Settings
} from 'lucide-react';
import {
  AI_ACTION_ENTITY_TYPE,
  buildActionFilterGroups,
  buildEntityTypeFilterOptions,
  classifyAuditEvent,
} from '@/lib/audit/filterOptions';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { OPERATOR_AUDIENCES } from '@/lib/audit/eventAudience';
import { createLogger } from '@/lib/logger';

// Structured logging works in a client component: lib/logger.ts configures
// Pino's `browser: { asObject: true }` transport, and the sibling admin page
// app/admin/users/page.tsx already calls createLogger at module scope the same way.
const logger = createLogger({ module: 'AdminAuditTrailPage' });

// Derived once from the audit catalogues (FR-A3): a newly registered event or
// entity type becomes selectable here with no change to this file.
//
// The Action Type list offers Business OS and shared events only (slice 2c).
// The AgentsPilot-only ones are hidden by their explicit audience tag
// (lib/audit/eventAudience.ts), never by a list written here, and an untagged
// event is always shown. "All Actions" still returns every row.
const ACTION_FILTER_GROUPS = buildActionFilterGroups({ audiences: OPERATOR_AUDIENCES });
const OFFERED_ACTIONS: ReadonlySet<string> = new Set(
  ACTION_FILTER_GROUPS.flatMap((group) => group.options.map((option) => option.value))
);

/** The one-click "BOS AI failures" view (slice 2c). */
const BOS_AI_FAILED_ACTION = AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED;
const ENTITY_TYPE_FILTER_OPTIONS = buildEntityTypeFilterOptions();

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  resource_name: string;
  details: any;
  changes: any;
  severity: string;
  created_at: string;
  compliance_flags: string[];
  users?: {
    email?: string;
    full_name?: string;
  } | null;
}

interface FilterState {
  action: string;
  severity: string;
  dateFrom: string;
  dateTo: string;
  searchTerm: string;
  entityType: string;
  /** One account's rows only (set by a deep link from Businesses). '' = everyone. */
  userId: string;
}

const EMPTY_FILTERS: FilterState = {
  action: 'all',
  severity: 'all',
  dateFrom: '',
  dateTo: '',
  searchTerm: '',
  entityType: 'all',
  userId: '',
};

/**
 * The first filter state, from the URL (e.g. the Businesses panel links to
 * `?action=BUSINESS_AI_ACTION_FAILED&user_id=<id>`). The route validates every
 * value; this only decides what the page asks for first.
 */
function filtersFromUrl(params: URLSearchParams | null): FilterState {
  if (!params) return EMPTY_FILTERS;
  return {
    action: params.get('action') || 'all',
    severity: params.get('severity') || 'all',
    dateFrom: params.get('date_from') || '',
    dateTo: params.get('date_to') || '',
    searchTerm: params.get('search') || '',
    entityType: params.get('entity_type') || 'all',
    userId: params.get('user_id') || '',
  };
}

/**
 * The closed set of `AiAuditDetails` fields this screen renders (FR-A5 / AC-A5):
 * exactly what lib/business-os/llm/aiActionAudit.ts records, minus nothing this
 * criterion names and plus nothing it does not.
 *
 * An allow-list by construction — never a wholesale dump of the details object,
 * which a guard test asserts — so a key added to `AiAuditDetails` later cannot
 * reach an admin screen without a review. Every field is optional because a
 * stored row is JSON read back from the database, not a compile-time value.
 */
interface AiActionDetailsView {
  area?: string;
  actionType?: string;
  trigger?: string;
  outcome?: string;
  errorCode?: string;
  callCount?: number;
  failedCallCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  callNames?: string[];
  models?: string[];
  groupId?: string;
}

const asText = (value?: string): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asCount = (value?: number): string | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : undefined;

const asList = (value?: string[]): string | undefined =>
  Array.isArray(value) && value.length > 0 ? value.filter((v) => typeof v === 'string').join(', ') : undefined;

/** Costs are stored rounded to a micro-dollar, so six decimals is the stored precision. */
const asUsd = (value?: number): string | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(6)}` : undefined;

function AiDetailValue({ label, value }: { label: string; value?: string }) {
  if (value === undefined) return null;
  return (
    <div className="bg-slate-800/30 rounded-lg p-3">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-sm text-slate-200 break-words">{value}</div>
    </div>
  );
}

/**
 * A Business OS AI action's recorded fields as labelled values (FR-A5).
 *
 * Pure presentation over an already-stored, already-safe closed shape: no fetch
 * and no ledger read. A per-call cost breakdown is Gap B's drill-down (FR-B2),
 * not this.
 */
function AiActionDetails({ details }: { details: AiActionDetailsView }) {
  const outcome = asText(details.outcome);
  const errorCode = asText(details.errorCode);

  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
        <Bot className="w-4 h-4" />
        AI Action Details
      </h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <AiDetailValue label="Area" value={asText(details.area)} />
        <AiDetailValue label="Action Type" value={asText(details.actionType)} />
        <AiDetailValue label="Trigger" value={asText(details.trigger)} />
        <AiDetailValue
          label="Outcome"
          value={outcome && errorCode ? `${outcome} (${errorCode})` : outcome}
        />
        <AiDetailValue label="Calls" value={asCount(details.callCount)} />
        <AiDetailValue label="Failed Calls" value={asCount(details.failedCallCount)} />
        <AiDetailValue label="Input Tokens" value={asCount(details.inputTokens)} />
        <AiDetailValue label="Output Tokens" value={asCount(details.outputTokens)} />
        <AiDetailValue label="Total Tokens" value={asCount(details.totalTokens)} />
        <AiDetailValue label="Estimated Cost" value={asUsd(details.estimatedCostUsd)} />
        <AiDetailValue label="Calls Made" value={asList(details.callNames)} />
        <AiDetailValue label="Models" value={asList(details.models)} />
        <AiDetailValue label="Grouping ID" value={asText(details.groupId)} />
      </div>
    </div>
  );
}

// useSearchParams needs a Suspense boundary in Next 14.
export default function AuditTrailPage() {
  return (
    <Suspense fallback={null}>
      <AuditTrailPageContent />
    </Suspense>
  );
}

function AuditTrailPageContent() {
  const { user } = useAuth();
  // Null outside the App Router (e.g. a unit test); treated as "no deep link".
  const searchParams = useSearchParams();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    hasMore: false,
    showing: 0
  });
  const [filters, setFilters] = useState<FilterState>(() =>
    filtersFromUrl(searchParams as URLSearchParams | null)
  );

  /**
   * The single definition of "a search is active". Used both to decide whether
   * to send `search` and to decide whether the totals below may be shown, so
   * the request and the count line can never disagree: a whitespace-only term
   * used to be sent (and filtered on) while the page still displayed the
   * unfiltered "Showing N of M".
   */
  const isSearchActive = filters.searchTerm.trim().length > 0;

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.action !== 'all') params.append('action', filters.action);
      if (filters.severity !== 'all') params.append('severity', filters.severity);
      if (filters.entityType !== 'all') params.append('entity_type', filters.entityType);
      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);
      if (isSearchActive) params.append('search', filters.searchTerm);
      if (filters.userId) params.append('user_id', filters.userId);
      params.append('page', currentPage.toString());
      params.append('page_size', pageSize.toString());

      const response = await fetch(`/api/admin/audit-trail?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setLogs(data.logs);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        setError(data.error || 'Failed to fetch audit logs');
      }
    } catch (err) {
      setError('Failed to fetch audit logs');
      logger.error({ err }, 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info': return <Info className="w-5 h-5 text-blue-500" />;
      default: return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 border-red-500/50 text-red-300';
      case 'warning': return 'bg-yellow-500/10 border-yellow-500/50 text-yellow-300';
      case 'info': return 'bg-blue-500/10 border-blue-500/50 text-blue-300';
      default: return 'bg-green-500/10 border-green-500/50 text-green-300';
    }
  };

  const getActionIcon = (action: string) => {
    const actionUpper = action.toUpperCase();

    // Orchestration & Workflow
    if (actionUpper.includes('ORCHESTRATION')) {
      return <Settings className="w-5 h-5 text-blue-400" />;
    }

    // Memory & Learning
    if (actionUpper.includes('MEMORY')) {
      return <Database className="w-5 h-5 text-purple-400" />;
    }

    // User actions
    if (actionUpper.includes('USER_LOGIN') || actionUpper.includes('LOGIN')) {
      return <LogIn className="w-5 h-5 text-green-400" />;
    }
    if (actionUpper.includes('USER_LOGOUT') || actionUpper.includes('LOGOUT')) {
      return <LogOut className="w-5 h-5 text-slate-400" />;
    }
    if (actionUpper.includes('USER_CREATED') || actionUpper.includes('USER_CREATE')) {
      return <UserPlus className="w-5 h-5 text-blue-400" />;
    }
    if (actionUpper.includes('USER_UPDATED') || actionUpper.includes('USER_UPDATE')) {
      return <UserCog className="w-5 h-5 text-purple-400" />;
    }

    // Agent actions
    if (actionUpper.includes('AGENT_CREATED') || actionUpper.includes('AGENT_CREATE')) {
      return <Bot className="w-5 h-5 text-green-400" />;
    }
    if (actionUpper.includes('AGENT_UPDATED') || actionUpper.includes('AGENT_UPDATE')) {
      return <Settings className="w-5 h-5 text-blue-400" />;
    }
    if (actionUpper.includes('AGENT_DELETED') || actionUpper.includes('AGENT_DELETE')) {
      return <Trash2 className="w-5 h-5 text-red-400" />;
    }
    if (actionUpper.includes('AGENT_EXECUTED') || actionUpper.includes('AGENT_EXECUTE')) {
      return <Play className="w-5 h-5 text-purple-400" />;
    }

    // AIS actions - Database operations
    if (actionUpper.includes('NORMALIZATION') || actionUpper.includes('REFRESH')) {
      return <Database className="w-5 h-5 text-cyan-400" />;
    }

    // AIS actions - Score operations
    if (actionUpper.includes('SCORE') || actionUpper.includes('AIS_')) {
      return <TrendingUp className="w-5 h-5 text-yellow-400" />;
    }

    // Default
    return <Activity className="w-5 h-5 text-slate-400" />;
  };

  const getActionLabel = (action: string) => {
    return action.replace('AIS_', '').replace(/_/g, ' ').toLowerCase()
      .split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const exportLogs = () => {
    const csv = [
      ['Timestamp', 'Action', 'Entity', 'Resource', 'Severity', 'User'].join(','),
      ...logs.map(log => [
        log.created_at,
        log.action,
        log.entity_type,
        log.resource_name,
        log.severity,
        log.user_id || 'System'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ais-audit-trail-${new Date().toISOString()}.csv`;
    a.click();
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="border-b border-slate-700">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 mb-1">
                <h1 className="text-xl font-semibold text-white">Audit Trail</h1>
                <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">System Config</span>
              </div>
              <p className="text-sm text-slate-400">Track all system events, user actions, and AIS changes across the platform</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={exportLogs}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <Download className="w-5 h-5" />
              Export CSV
            </button>
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

        {/* Filters */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Filter className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold text-white">Filters</h2>
            {/* One-click view (slice 2c): every failed Business OS AI action. */}
            <button
              type="button"
              data-testid="preset-bos-ai-failures"
              onClick={() => setFilters({ ...filters, action: BOS_AI_FAILED_ACTION })}
              className={`ml-auto px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                filters.action === BOS_AI_FAILED_ACTION
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                  : 'border-slate-600 text-slate-300 hover:bg-slate-700'
              }`}
            >
              BOS AI failures
            </button>
            {filters.userId && (
              <span
                data-testid="account-filter-chip"
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-blue-500/20 text-blue-200"
              >
                Account {filters.userId.slice(0, 8)}…
                <button
                  type="button"
                  aria-label="Show every account"
                  onClick={() => setFilters({ ...filters, userId: '' })}
                  className="text-blue-300 hover:text-white"
                >
                  ×
                </button>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by agent, user email, or name..."
                  value={filters.searchTerm}
                  onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Action Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Action Type</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {/* "all" is a UI sentinel, not a catalogue value — every other
                    option comes from AUDIT_EVENTS via buildActionFilterGroups() */}
                <option value="all">All Actions</option>
                {/* A deep link can name an event this list hides; show it rather
                    than a blank select beside filtered results. */}
                {filters.action !== 'all' && !OFFERED_ACTIONS.has(filters.action) && (
                  <option value={filters.action}>
                    {classifyAuditEvent(filters.action).label} (hidden from this list)
                  </option>
                )}
                {ACTION_FILTER_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value} title={option.description}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Severity</label>
              <select
                value={filters.severity}
                onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Severities</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">From Date</label>
              <input
                type="datetime-local"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">To Date</label>
              <input
                type="datetime-local"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Entity Type */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Entity Type</label>
              <select
                value={filters.entityType}
                onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {/* As above: only the sentinel is hardcoded; the rest is AUDIT_ENTITY_TYPES */}
                <option value="all">All Entities</option>
                {ENTITY_TYPE_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Clear Filters */}
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-4 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Clear All Filters
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-red-300 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Results Count & Pagination */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between">
            {/* Left: Results Count */}
            {/* The route's total is the UNFILTERED count, and the free-text
                search is applied in memory to one page of rows (route.ts:96-98,
                :172). So with a search term active, "X of Y" is false in both
                halves — say what is actually true instead (FR-A4b). The page
                number itself is honest (it is the real offset page); only the
                page *count* is derived from the unfiltered total.

                Every place that would PRINT that count is therefore branched on
                isSearchActive — here and in the pager's own "Page n of m" label
                below (:575). What stays deliberately unbranched is the pager's
                BEHAVIOUR: First/Previous/Next/Last and their enable/disable
                logic still run off pagination.totalPages, because they page the
                underlying unfiltered stream, which is what the route actually
                does. Making them describe a filtered set needs the filtered
                count, i.e. the separately tracked search fix (Non-Goal 2). The
                exemption covers the buttons, not the number they sit beside. */}
            <div className="text-sm text-slate-400">
              {isSearchActive ? (
                <>
                  Showing {pagination.showing} matches on this page
                  <span className="ml-2 text-slate-500">(Page {currentPage})</span>
                  <div className="text-xs text-slate-500 mt-1">
                    Search scans only the current page of results. Use the Action, Entity Type,
                    Severity and date filters for complete results.
                  </div>
                </>
              ) : (
                <>
                  Showing {pagination.showing} of {pagination.total} audit logs
                  {pagination.totalPages > 1 && (
                    <span className="ml-2 text-slate-500">
                      (Page {currentPage} of {pagination.totalPages})
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Right: Pagination Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              {pagination.totalPages > 1 && (
                <>
                  <div className="h-4 w-px bg-slate-600" />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1 || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Previous
                    </button>
                    {/* Label only — see the note above the results count. The
                        buttons either side keep using pagination.totalPages. */}
                    <span className="text-sm text-slate-400 min-w-[100px] text-center">
                      {isSearchActive
                        ? `Page ${currentPage}`
                        : `Page ${currentPage} of ${pagination.totalPages}`}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(pagination.totalPages, prev + 1))}
                      disabled={!pagination.hasMore || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setCurrentPage(pagination.totalPages)}
                      disabled={currentPage === pagination.totalPages || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Last
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Audit Logs */}
        <div className="space-y-3">
          {logs.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg">No audit logs found</p>
              <p className="text-slate-500 text-sm mt-2">Try adjusting your filters</p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                >
                  {/* Row 1: Icon + Title + Badge + Controls */}
                  <div className="flex items-center justify-between gap-4 w-full mb-3">
                    {/* Left Side: Icon + Title + Badge */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Icon - Based on Action Type */}
                      <div className="flex-shrink-0">
                        {getActionIcon(log.action)}
                      </div>

                      {/* Title and Badge */}
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-white whitespace-nowrap">
                          {getActionLabel(log.action)}
                        </h3>
                        {/* Severity Badge inline with title */}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          log.severity === 'critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                          log.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                          log.severity === 'info' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                          'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                        }`}>
                          {getSeverityIcon(log.severity)}
                          <span className="capitalize">{log.severity}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right Controls */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {log.compliance_flags && log.compliance_flags.length > 0 && (
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded text-xs text-blue-300">
                          {log.compliance_flags.join(', ')}
                        </div>
                      )}
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </span>
                      {expandedLog === log.id ? (
                        <ChevronUp className="w-5 h-5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Row 2: Metadata - Entity, Resource, User */}
                  <div className="flex items-center gap-4 text-sm pl-14">
                    <span className="text-slate-500">
                      Entity: <span className="text-slate-300">{log.entity_type}</span>
                    </span>
                    <span className="text-slate-500">
                      Resource: <span className="text-slate-300">{log.resource_name || log.entity_id}</span>
                    </span>
                    {log.user_id && (
                      <span className="text-slate-500">
                        User: <span className="text-slate-300">
                          {log.users?.email || log.users?.full_name || log.user_id}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedLog === log.id && (
                  <div className="border-t border-white/10 p-6 bg-slate-900/50 space-y-6">

                    {/* Metadata Section - Always show */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Event ID</div>
                        <div className="text-xs font-mono text-slate-300 truncate">{log.id}</div>
                      </div>
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Entity ID</div>
                        <div className="text-xs font-mono text-slate-300 truncate">{log.entity_id}</div>
                      </div>
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Severity</div>
                        <div className="text-sm font-semibold text-slate-200">{log.severity}</div>
                      </div>
                      {log.compliance_flags && log.compliance_flags.length > 0 && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">Compliance</div>
                          <div className="text-sm font-semibold text-blue-300">{log.compliance_flags.join(', ')}</div>
                        </div>
                      )}
                      {log.user_id && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">User</div>
                          <div className="text-sm font-semibold text-slate-200 truncate">
                            {log.users?.email || log.users?.full_name || log.user_id}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Business OS AI action details (FR-A5). Detected by entity
                        type, not by the action prefix, so _COMPLETED and _FAILED
                        take the same path. The generic dump below is suppressed
                        for these rows — without that, an AI entry would render
                        the labelled values AND the raw key/value list underneath. */}
                    {log.entity_type === AI_ACTION_ENTITY_TYPE && log.details && (
                      <AiActionDetails details={log.details as AiActionDetailsView} />
                    )}

                    {/* Score Changes (for AIS_SCORE_UPDATED) */}
                    {log.action === 'AIS_SCORE_UPDATED' && log.changes && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-800/50 rounded-lg p-4">
                          <div className="text-xs text-slate-400 mb-2">Before</div>
                          <div className="text-2xl font-bold text-slate-300">
                            {log.changes.before?.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Multiplier: {log.changes.before?.combined_multiplier?.toFixed(3)}x
                          </div>
                        </div>
                        <div className="flex items-center justify-center">
                          <div className="text-3xl text-blue-400">→</div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <div className="text-xs text-blue-400 mb-2">After</div>
                          <div className="text-2xl font-bold text-blue-300">
                            {log.changes.after?.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-blue-400 mt-1">
                            Multiplier: {log.changes.after?.combined_multiplier?.toFixed(3)}x
                          </div>
                          <div className={`text-sm font-semibold mt-2 ${
                            log.changes.delta?.combined_score >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {log.changes.delta?.combined_score >= 0 ? '+' : ''}
                            {log.changes.delta?.combined_score?.toFixed(2)} change
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Score Calculated (for AIS_SCORE_CALCULATED) */}
                    {log.action === 'AIS_SCORE_CALCULATED' && log.details && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                          <div className="text-xs text-green-400 mb-1">Creation Score</div>
                          <div className="text-2xl font-bold text-green-300">
                            {log.details.creation_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-green-400 mt-1">
                            {log.details.creation_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                          <div className="text-xs text-purple-400 mb-1">Execution Score</div>
                          <div className="text-2xl font-bold text-purple-300">
                            {log.details.execution_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-purple-400 mt-1">
                            {log.details.execution_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <div className="text-xs text-blue-400 mb-1">Combined Score</div>
                          <div className="text-2xl font-bold text-blue-300">
                            {log.details.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-blue-400 mt-1">
                            {log.details.combined_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Normalization Refresh Started */}
                    {log.action === 'AIS_NORMALIZATION_REFRESH_STARTED' && log.details && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                            <div className="text-xs text-blue-400 mb-2">Agents Captured</div>
                            <div className="text-3xl font-bold text-blue-300">
                              {log.details.affected_agents_count || log.details.agent_scores_snapshot?.length || 0}
                            </div>
                          </div>
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                            <div className="text-xs text-purple-400 mb-2">Ranges Captured</div>
                            <div className="text-3xl font-bold text-purple-300">
                              {log.details.old_ranges?.length || 0}
                            </div>
                          </div>
                        </div>
                        {log.details.reason && (
                          <div className="bg-slate-800/50 rounded-lg p-4">
                            <div className="text-xs text-slate-400 mb-2">Reason</div>
                            <div className="text-sm text-slate-200">{log.details.reason}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Normalization Refresh Completed - Show Before/After Changes */}
                    {log.action === 'AIS_NORMALIZATION_REFRESH_COMPLETED' && log.changes && (
                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Normalization Ranges Updated
                        </h4>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-800/50 rounded-lg p-4">
                            <div className="text-xs text-slate-400 mb-2">Old Ranges</div>
                            <div className="text-2xl font-bold text-slate-300">
                              {log.changes.before?.length || 0}
                            </div>
                          </div>
                          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                            <div className="text-xs text-green-400 mb-2">New Ranges</div>
                            <div className="text-2xl font-bold text-green-300">
                              {log.changes.after?.length || 0}
                            </div>
                          </div>
                        </div>

                        {/* Before/After Ranges Comparison */}
                        {log.changes.before && log.changes.after && (
                          <div className="space-y-3">
                            <div className="text-xs text-slate-400 mb-2">Range Changes:</div>
                            <div className="max-h-96 overflow-y-auto space-y-2">
                              {log.changes.after.map((newRange: any, idx: number) => {
                                const oldRange = log.changes.before.find((r: any) => r.range_key === newRange.range_key);
                                const hasChanged = oldRange && (
                                  oldRange.best_practice_min !== newRange.best_practice_min ||
                                  oldRange.best_practice_max !== newRange.best_practice_max
                                );

                                return (
                                  <div
                                    key={newRange.range_key}
                                    className={`grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg ${
                                      hasChanged ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-slate-800/30'
                                    }`}
                                  >
                                    <div>
                                      <div className="text-xs text-slate-400 mb-1">Range Key</div>
                                      <div className="text-sm font-mono text-slate-200">{newRange.range_key}</div>
                                      {newRange.category && (
                                        <div className="text-xs text-slate-500 mt-1">{newRange.category}</div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-xs text-slate-400 mb-1">Before</div>
                                      <div className="text-sm text-slate-300">
                                        [{oldRange?.best_practice_min ?? 'N/A'} - {oldRange?.best_practice_max ?? 'N/A'}]
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-green-400 mb-1">After</div>
                                      <div className="text-sm font-semibold text-green-300">
                                        [{newRange.best_practice_min} - {newRange.best_practice_max}]
                                      </div>
                                      {hasChanged && (
                                        <div className="text-xs text-yellow-400 mt-1">✓ Changed</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Normalization Ranges (if available) */}
                    {log.details?.normalization_ranges && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          Normalization Ranges Used
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Object.entries(log.details.normalization_ranges).slice(0, 6).map(([key, value]: [string, any]) => (
                            <div key={key} className="bg-slate-800/50 rounded-lg p-3">
                              <div className="text-xs text-slate-400 mb-1 font-mono">{key}</div>
                              <div className="text-sm text-slate-200">
                                [{value?.min || 0} - {value?.max || 0}]
                              </div>
                            </div>
                          ))}
                        </div>
                        {Object.keys(log.details.normalization_ranges).length > 6 && (
                          <div className="text-xs text-slate-500 mt-2">
                            + {Object.keys(log.details.normalization_ranges).length - 6} more ranges
                          </div>
                        )}
                      </div>
                    )}

                    {/* Execution Details */}
                    {log.details && (log.details.total_executions || log.details.total_tokens_used) && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {log.details.total_executions && (
                          <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-xs text-slate-400 mb-1">Executions</div>
                            <div className="text-lg font-semibold text-slate-200">
                              {log.details.total_executions}
                            </div>
                          </div>
                        )}
                        {log.details.total_tokens_used && (
                          <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-xs text-slate-400 mb-1">Tokens Used</div>
                            <div className="text-lg font-semibold text-slate-200">
                              {log.details.total_tokens_used.toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Generic Details (for other event types). AI entries are
                        excluded: AiActionDetails above already renders them as
                        labelled values, and this dump is what FR-A5 replaces. */}
                    {log.details && !log.action.startsWith('AIS_') && log.entity_type !== AI_ACTION_ENTITY_TYPE && (
                      <div className="bg-slate-800/50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3">Event Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {Object.entries(log.details).map(([key, value]: [string, any]) => (
                            <div key={key} className="flex items-start gap-2">
                              <span className="text-xs text-slate-400 font-mono min-w-[120px]">{key}:</span>
                              <span className="text-sm text-slate-200 flex-1">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generic Changes (for other event types) */}
                    {log.changes && !log.action.startsWith('AIS_') && (
                      <div className="bg-slate-800/50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3">Changes Made</h4>
                        <div className="space-y-2">
                          {log.changes.before && (
                            <div>
                              <div className="text-xs text-slate-400 mb-1">Before:</div>
                              <div className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                                {JSON.stringify(log.changes.before, null, 2)}
                              </div>
                            </div>
                          )}
                          {log.changes.after && (
                            <div>
                              <div className="text-xs text-slate-400 mb-1">After:</div>
                              <div className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                                {JSON.stringify(log.changes.after, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
    </div>
  );
}
