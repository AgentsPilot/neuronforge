'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Search, Calendar, User, Activity, AlertCircle,
  CheckCircle, Info, AlertTriangle, ChevronDown, ChevronUp,
  Download, Database, TrendingUp,
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
import { clientLogger } from '@/lib/logger/client';
import { ArchivedBeforeNotice } from '@/app/admin/components/ArchivedBeforeNotice';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import {
  AdminFilterBar,
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
  type AdminActiveChip,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminEmpty, AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { BusinessAccountPicker } from './BusinessAccountPicker';
import {
  AUDIT_DEFAULT_WINDOW,
  AUDIT_FILTER_SPEC,
  auditRequestParams,
  isSearchActive as hasActiveSearch,
} from './auditTrailFilters';

// A client file logs through the client logger (Admin Layout Standard F-56).
const logger = clientLogger.child({ module: 'AdminAuditTrailPage' });

/** Noun phrase for the shared states: "Reading the audit trail…", "Refresh the audit trail". */
const WHAT = 'the audit trail';

const PURPOSE = 'Track all system events, user actions, and AIS changes across the platform';

/** The page's native controls in the filter bar (each sized here; the shared class has no width). */
const FIELD_CONTROL = `${ADMIN_FIELD_CONTROL} w-full`;

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
  /**
   * Nullable on purpose. `resource_name` is optional at write time
   * (AuditTrailService stores `input.resourceName || null`) and roughly 44% of
   * rows have none — some because the writer never set one, some DELIBERATELY:
   * lib/business-os/llm/aiActionAudit.ts omits it because the field "could carry
   * content or credentials" (a Layer 3 privacy decision). So a missing name is
   * not an error, and the UI must not present the entity id in its place.
   */
  resource_name: string | null;
  details: any;
  changes: any;
  severity: string;
  created_at: string;
  compliance_flags: string[];
  /**
   * The sign-in email the writer recorded on the row (`audit_trail.user_email`,
   * sent by the route's `select('*')` and matched by its search). Shown when the
   * account has no profile name (Q-SA4-1, user-approved 2026-10-04).
   */
  user_email?: string | null;
  /**
   * The route fills `full_name` from `profiles` (ADMIN_BOS_CLEANUP slice 4) and
   * never sends `email` (`profiles` has none), so the `users.email` branches
   * below are unreachable from the route; kept so older fixtures still render.
   * Null when the account has no name; absent when the lookup failed.
   */
  users?: {
    email?: string;
    full_name?: string;
  } | null;
  /**
   * The business this row belongs to, from `business_profiles.company_name`
   * keyed by `user_id`. Null when the account has no business profile — every
   * agent-platform row. `company_name` itself can be null for a business that
   * has not named itself.
   *
   * ABSENT (undefined) is a third state and means something different: the
   * route's name lookup failed, so this row's business is UNKNOWN rather than
   * absent. The response's top-level `businessLookup: 'failed'` carries that.
   * Nothing renders it today — both states currently show no business — but the
   * payload keeps them distinguishable so a future consumer can say "unknown".
   */
  business?: {
    company_name?: string | null;
  } | null;
}

/** The route's pagination block, as the page has always trusted it. */
interface AuditPagination {
  total: number;
  totalPages: number;
  hasMore: boolean;
  showing: number;
}

/**
 * Who a row is about, for the row line and the expanded "User" tile:
 * profile name, then the row's sign-in email (Q-SA4-1), then the account id.
 *
 * `users.email` sits after `user_email` only for older test fixtures: the route
 * never sends it (slice 4 O-7). Callers render this only when `user_id` is set,
 * so a system row (no user) is unchanged.
 */
function auditUserLabel(log: AuditLogEntry): string | null {
  return log.users?.full_name || log.user_email || log.users?.email || log.user_id;
}

/**
 * What the active account chip is labelled with.
 *
 * The chip used to print `filters.userId.slice(0, 8)` — a truncated GUID, which
 * names nothing to the operator reading it. The readable identity is already in
 * memory: the route filters on `user_id`, so every loaded row belongs to the
 * filtered account and already carries `business.company_name` and `users`
 * (audit-trail slice: resource + business name). So this is a read of state,
 * never a fetch.
 *
 * Business name first because that is what an operator calls the account, then
 * the same `email → full_name` chain the rows use, and finally the truncated id
 * when there is nothing to fall back on — no rows loaded yet, or a filter that
 * matched none. Saying the id then is honest; a placeholder would not be.
 *
 * The `user_id === userId` test is load-bearing, not defensive tidiness: `logs`
 * still holds the PREVIOUS filter's rows while the next request is in flight, so
 * without it the chip would briefly label this account with another one's name.
 */
function accountFilterLabel(logs: AuditLogEntry[], userId: string): string {
  const own = logs.filter((log) => log.user_id === userId);
  const name =
    own.find((log) => log.business?.company_name)?.business?.company_name ||
    own.find((log) => log.users?.email)?.users?.email ||
    own.find((log) => log.users?.full_name)?.users?.full_name;
  return name || `${userId.slice(0, 8)}…`;
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

/**
 * The stored cost at its stored precision: at least 6 and at most 10 decimals,
 * trailing zeros trimmed down to 6. Entries written before deduction slice 2
 * are rounded to a micro-dollar and so render exactly as they always did;
 * later ones are rounded to 10 decimals (SQ-14), so a ~2e-7 USD embedding
 * shows as $0.0000002 rather than $0.000000. Built from `toFixed`, never
 * `String(n)`, so a small cost is never shown in exponent notation (SA Q-5).
 */
const asUsd = (value?: number): string | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toFixed(10).replace(/(\.\d{6}\d*?)0+$/, '$1')}`
    : undefined;

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
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState<AuditPagination>({
    total: 0,
    totalPages: 0,
    hasMore: false,
    showing: 0
  });
  // The URL is the filter state's projection (Admin Layout Standard C-7): the
  // first state is parsed from the URL synchronously, so the first read below
  // already sees an inbound link's filters, and `filters` keeps its identity
  // until a value changes, so the two effects below fire exactly as before.
  const { filters, setFilters, clear, isDefault } = useAdminFilters(AUDIT_FILTER_SPEC);
  /** When the list was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);

  // "A search is active" is defined once, in auditTrailFilters.ts (hasActiveSearch);
  // the request and the count line both use it, so they can never disagree.
  const isSearchActive = hasActiveSearch(filters);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = auditRequestParams(filters, currentPage, pageSize, new Date());

      // Only the fetch sits inside this try: a rejection here is a network
      // failure; anything else must never be labelled as one.
      let response: Response;
      try {
        response = await fetch(`/api/admin/audit-trail?${params.toString()}`);
      } catch (err) {
        logger.error({ err }, 'Could not reach the audit trail route');
        setError(ADMIN_NETWORK_ERROR);
        return;
      }

      // The route answers `logs` and `pagination` at the top level, not under
      // `data`; the casts are the same trust the page placed in them before.
      const result = await readAdminResponse(response, {
        what: WHAT,
        sessionEndedCopy: true,
        pick: (body) => ({
          logs: body.logs as AuditLogEntry[],
          pagination: body.pagination as AuditPagination | undefined,
        }),
      });
      if (!result.ok) {
        logger.error({ status: result.status }, 'Failed to fetch audit logs');
        // The previous rows stay on screen.
        setError(result.message);
        return;
      }
      setLogs(result.data.logs);
      if (result.data.pagination) {
        setPagination(result.data.pagination);
      }
      setReadAt(new Date().toISOString());
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

  // Deliberately NOT updated by this PR: the export keeps the old columns and
  // the old `resource_name` fallback semantics, so the page and the CSV now
  // differ. Closing that divergence is blocked on a PRE-EXISTING defect here —
  // the rows below are built with a bare `.join(',')`, with no quoting and no
  // escaping. A value containing a comma shifts every later column, and a value
  // starting with `=`, `+`, `-` or `@` is a spreadsheet formula-injection
  // vector. Whoever adds the Business column must fix the quoting FIRST;
  // widening an unescaped row builder widens the bug with it.
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

  const chips: AdminActiveChip[] = filters.account
    ? [
        {
          key: 'account',
          // Words, testid, title and X label unchanged until the shared picker
          // replaces this one (L-1d, RC-8). The full id stays reachable on
          // hover: the visible text either replaces it with a name or
          // truncates it.
          label: `Account ${accountFilterLabel(logs, filters.account)}`,
          title: filters.account,
          testId: 'account-filter-chip',
          removeLabel: 'Show every account',
          onRemove: () => setFilters({ account: '' }),
        },
      ]
    : [];
  const isBosAiFailures = filters.action === BOS_AI_FAILED_ACTION;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit trail"
        purpose={PURPOSE}
        actions={
          <button
            onClick={exportLogs}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
        }
      />

      <AdminFilterBar
        what={WHAT}
        busy={loading}
        onRefresh={() => void fetchLogs()}
        readAt={readAt}
        windowControl={{
          value: filters.window,
          defaultValue: AUDIT_DEFAULT_WINDOW,
          onChange: (next) => setFilters({ window: next }),
        }}
        business={
          // The original picker, unchanged, for one slice (RC-8): the fixed
          // width keeps its permanent hint from stretching the row. Account is
          // the only filter applied at the DATABASE level to a single account
          // (route.ts `.eq('user_id', accountId)`).
          <div className="w-full sm:w-72">
            <BusinessAccountPicker
              selectedAccountId={filters.account}
              onSelect={(account) => setFilters({ account })}
            />
          </div>
        }
        onClear={clear}
        canClear={!isDefault}
        chips={chips}
      >
        {/* Search: applied per keystroke, as before (F-98); held by the hook as
            page-only, so it is never written to the address bar. */}
        <div className="w-full sm:w-64">
          <label htmlFor="audit-search" className={ADMIN_FIELD_LABEL}>Search</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <input
              id="audit-search"
              type="text"
              placeholder="Search by email, action, resource or entity ID…"
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              className="w-full rounded-lg border border-slate-600 bg-slate-900/50 pl-8 pr-3 py-1.5 text-sm text-white placeholder-slate-400 [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            />
          </div>
        </div>

        {/* Action Filter */}
        <div className="w-full sm:w-56">
          <label htmlFor="audit-action" className={ADMIN_FIELD_LABEL}>Action Type</label>
          <select
            id="audit-action"
            value={filters.action}
            onChange={(e) => setFilters({ action: e.target.value })}
            className={FIELD_CONTROL}
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
        <div className="w-full sm:w-40">
          <label htmlFor="audit-severity" className={ADMIN_FIELD_LABEL}>Severity</label>
          <select
            id="audit-severity"
            value={filters.severity}
            onChange={(e) => setFilters({ severity: e.target.value })}
            className={FIELD_CONTROL}
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {/* Entity Type */}
        <div className="w-full sm:w-48">
          <label htmlFor="audit-entity-type" className={ADMIN_FIELD_LABEL}>Entity Type</label>
          <select
            id="audit-entity-type"
            value={filters.entityType}
            onChange={(e) => setFilters({ entityType: e.target.value })}
            className={FIELD_CONTROL}
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

        {/* One-click view (slice 2c): every failed Business OS AI action. It
            only sets the action (no toggle-off); the Action select resets it. */}
        <button
          type="button"
          data-testid="preset-bos-ai-failures"
          aria-pressed={isBosAiFailures}
          onClick={() => setFilters({ action: BOS_AI_FAILED_ACTION })}
          className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
            isBosAiFailures
              ? 'bg-purple-500/20 border-purple-500/50 text-purple-200'
              : 'border-slate-600 text-slate-300 hover:bg-slate-700'
          }`}
        >
          BOS AI failures
        </button>
      </AdminFilterBar>

      {error && <AdminError message={error} testId="audit-error" onRetry={() => void fetchLogs()} />}

      {/* Older entries may be archived (FR-12, archiving slice 3). Rendered
          outside every loading / empty / error branch so it mounts once and
          never refetches on a read (SA M-3, the F-28 mount pin). */}
      <ArchivedBeforeNotice />

      <div aria-busy={loading} className="space-y-6">
        {loading && logs.length === 0 && !error ? (
          <AdminLoading what={WHAT} />
        ) : (
          <>
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
              {pagination.totalPages > 1 && (
                <>
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
            error ? null : (
              <AdminEmpty
                message="No audit events match these filters."
                hint="Try a wider window or fewer filters."
                onClear={isDefault ? undefined : clear}
                testId="audit-empty"
              />
            )
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
                    {/* A missing resource name must READ as missing. This used to
                        be `log.resource_name || log.entity_id`, which printed the
                        entity's GUID under the label "Resource:" — so an operator
                        could not tell a named object from an unnamed one, and the
                        rows that omit the name on purpose (aiActionAudit's Layer 3
                        privacy decision) looked like rows with a name nobody could
                        read.

                        Two distinct renderings, no error styling: this is a normal
                        state for ~44% of rows, not a defect. When there is no name
                        the id is shown LABELLED AS AN ID and in mono, which is what
                        it is. Fixing the writers is deliberately out of scope —
                        making the gap visible first is the point. */}
                    {log.resource_name ? (
                      <span className="text-slate-500">
                        Resource: <span className="text-slate-300">{log.resource_name}</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        Entity id:{' '}
                        <span className="font-mono text-xs text-slate-400" title={log.entity_id}>
                          {log.entity_id}
                        </span>
                      </span>
                    )}
                    {log.user_id && (
                      <span className="text-slate-500">
                        User: <span className="text-slate-300">
                          {auditUserLabel(log)}
                        </span>
                      </span>
                    )}
                    {/* Blank is honest: an agent-platform row has no business
                        profile, and a placeholder would only add noise. */}
                    {log.business?.company_name && (
                      <span className="text-slate-500">
                        Business: <span className="text-slate-300">{log.business.company_name}</span>
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
                            {auditUserLabel(log)}
                          </div>
                        </div>
                      )}
                      {/* Omitted entirely when the account has no business profile. */}
                      {log.business?.company_name && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">Business</div>
                          <div className="text-sm font-semibold text-slate-200 truncate">
                            {log.business.company_name}
                          </div>
                        </div>
                      )}
                      {/* Shown only when there IS a name. The "Entity ID" card above
                          already carries the id, so a nameless row is not padded with
                          a duplicate of it. */}
                      {log.resource_name && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">Resource</div>
                          <div className="text-sm font-semibold text-slate-200 truncate">
                            {log.resource_name}
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
          </>
        )}
      </div>
    </div>
  );
}
