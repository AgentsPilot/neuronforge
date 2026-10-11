'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Search, Calendar, User, Activity,
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
import {
  AdminDrawer,
  DrawerField,
  DrawerFields,
  DrawerSection,
} from '@/app/admin/components/layout/AdminDrawer';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import { AdminEmpty, AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import {
  ADMIN_BUTTON,
  ADMIN_COUNT_LINE,
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TH,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';
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
 * The name the active business chip shows when the admin did not just pick it
 * (an inbound link, Back/Forward), or null when the loaded rows name nothing.
 *
 * The chip used to print `filters.userId.slice(0, 8)` — a truncated GUID, which
 * names nothing to the operator reading it. The readable identity is already in
 * memory: the route filters on `user_id`, so every loaded row belongs to the
 * filtered account and already carries `business.company_name` and `users`
 * (audit-trail slice: resource + business name). So this is a read of state,
 * never a fetch.
 *
 * Business name first because that is what an operator calls the account, then
 * the same chain `auditUserLabel` uses for a row (F-31, L-1e): full name, then
 * the row's sign-in email, then `users.email`. Null when there is nothing to
 * fall back on (no rows loaded yet, or a filter that matched none): the chip
 * then shows the short id, which is honest; a placeholder would not be.
 *
 * The `user_id === userId` test is load-bearing, not defensive tidiness: `logs`
 * still holds the PREVIOUS filter's rows while the next request is in flight, so
 * without it the chip would briefly label this account with another one's name.
 */
function accountFilterName(logs: AuditLogEntry[], userId: string): string | null {
  const own = logs.filter((log) => log.user_id === userId);
  // QA-2: a whitespace-only value is no name, so it falls through to the next source.
  const first = (pick: (log: AuditLogEntry) => string | null | undefined): string | undefined =>
    own.map((log) => pick(log)?.trim()).find((value) => Boolean(value)) || undefined;
  const name =
    first((log) => log.business?.company_name) ||
    first((log) => log.users?.full_name) ||
    first((log) => log.user_email) ||
    first((log) => log.users?.email);
  return name || null;
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

/**
 * One allow-listed AI field (FR-A5). Omitted when the stored value is absent
 * or unusable: the wrapper returns null BEFORE a `DrawerField` exists, so the
 * drawer never shows a label with an empty value (L-1d SA M-4).
 */
function AiDetailValue({ label, value }: { label: string; value?: string }) {
  if (value === undefined) return null;
  return <DrawerField label={label}>{value}</DrawerField>;
}

/**
 * A Business OS AI action's recorded fields as labelled values (FR-A5).
 *
 * Pure presentation over an already-stored, already-safe closed shape: no fetch
 * and no ledger read. A per-call cost breakdown is Gap B's drill-down (FR-B2),
 * not this. The section's heading is its only heading (L-1d SA M-4).
 */
function AiActionDetails({ details }: { details: AiActionDetailsView }) {
  const outcome = asText(details.outcome);
  const errorCode = asText(details.errorCode);

  return (
    <DrawerSection title="AI action details" testId="audit-ai-details">
      <DrawerFields>
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
      </DrawerFields>
    </DrawerSection>
  );
}

/**
 * Severity as a §5.9 chip. `Partial`, so a lookup is typed as possibly
 * undefined: any other stored value shows as `unknown`, with its raw word
 * (L-1d SA S-2).
 */
const SEVERITY_TONE: Partial<Record<string, StatusTone>> = { critical: 'danger', warning: 'warn', info: 'info' };
const SEVERITY_WORD: Partial<Record<string, string>> = { critical: 'Critical', warning: 'Warning', info: 'Info' };

function SeverityChip({ severity, testId }: { severity: string; testId?: string }) {
  // Own keys only: a stored value such as "constructor" must not resolve to
  // an Object.prototype member and reach StatusChip as a tone.
  const known = Object.prototype.hasOwnProperty.call(SEVERITY_TONE, severity);
  return (
    <StatusChip tone={(known ? SEVERITY_TONE[severity] : undefined) ?? 'unknown'} testId={testId}>
      {/* A-7: an empty or missing stored value still shows words. */}
      {(known ? SEVERITY_WORD[severity] : undefined) ?? (severity || 'Unknown')}
    </StatusChip>
  );
}

/**
 * The drawer's body for one audit row (Admin Layout Standard L-1d): what the
 * inline expand used to show, in the same order. It renders the row that is
 * already loaded, so opening a row asks the route for nothing (R-6).
 *
 * Its parameter stays `log`: `filterOptions.guard` reads this file for the AI
 * detection line and the generic-dump line, word for word (SA Q-9).
 */
function AuditEventBody({ log }: { log: AuditLogEntry }) {
  return (
    <>
      <DrawerSection title="Event" testId="audit-event-fields">
        <DrawerFields>
          <DrawerField label="Event ID">
            <span className="font-mono text-xs break-all">{log.id}</span>
          </DrawerField>
          <DrawerField label="Time (UTC)">{formatUtc(log.created_at)}</DrawerField>
          {/* The stored value, offset included: the table drops the seconds. */}
          <DrawerField label="Recorded" testId="audit-recorded">
            <span className="font-mono text-xs break-all">{log.created_at}</span>
          </DrawerField>
          <DrawerField label="Severity">
            <SeverityChip severity={log.severity} />
          </DrawerField>
          <DrawerField label="Entity type">{log.entity_type}</DrawerField>
          <DrawerField label="Entity ID">
            <span className="font-mono text-xs break-all">{log.entity_id}</span>
          </DrawerField>
          {/* Shown only when there IS a name: Entity ID above already carries
              the id, so a nameless row is not padded with a duplicate of it. */}
          {log.resource_name && <DrawerField label="Resource">{log.resource_name}</DrawerField>}
          {log.user_id && <DrawerField label="User">{auditUserLabel(log)}</DrawerField>}
          {/* Omitted when the account has no business profile. */}
          {log.business?.company_name && <DrawerField label="Business">{log.business.company_name}</DrawerField>}
          {log.compliance_flags && log.compliance_flags.length > 0 && (
            <DrawerField label="Compliance">{log.compliance_flags.join(', ')}</DrawerField>
          )}
        </DrawerFields>
      </DrawerSection>

      {/* Business OS AI action details (FR-A5). Detected by entity
          type, not by the action prefix, so _COMPLETED and _FAILED
          take the same path. The generic dump below is suppressed
          for these rows — without that, an AI entry would render
          the labelled values AND the raw key/value list underneath. */}
      {log.entity_type === AI_ACTION_ENTITY_TYPE && log.details && (
        <AiActionDetails details={log.details as AiActionDetailsView} />
      )}

      {/* The legacy AgentsPilot (AIS) blocks below are moved verbatim from
          the inline expand, one section heading each, and not restyled: they
          never appear for a Business OS row (L-1d workplan §3.7). */}
      {/* Score Changes (for AIS_SCORE_UPDATED) */}
      {log.action === 'AIS_SCORE_UPDATED' && log.changes && (
        <DrawerSection title="Score change">
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
        </DrawerSection>
      )}

      {/* Score Calculated (for AIS_SCORE_CALCULATED) */}
      {log.action === 'AIS_SCORE_CALCULATED' && log.details && (
        <DrawerSection title="Score">
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
        </DrawerSection>
      )}

      {/* Normalization Refresh Started */}
      {log.action === 'AIS_NORMALIZATION_REFRESH_STARTED' && log.details && (
        <DrawerSection title="Normalization">
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
        </DrawerSection>
      )}

      {/* Normalization Refresh Completed - Show Before/After Changes */}
      {log.action === 'AIS_NORMALIZATION_REFRESH_COMPLETED' && log.changes && (
        <DrawerSection title="Normalization">
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
        </DrawerSection>
      )}

      {/* Normalization Ranges (if available) */}
      {log.details?.normalization_ranges && (
        <DrawerSection title="Normalization ranges">
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
        </DrawerSection>
      )}

      {/* Execution Details */}
      {log.details && (log.details.total_executions || log.details.total_tokens_used) && (
        <DrawerSection title="Execution">
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
        </DrawerSection>
      )}
      {/* Generic Details (for other event types). AI entries are
          excluded: AiActionDetails above already renders them as
          labelled values, and this dump is what FR-A5 replaces. */}
      {log.details && !log.action.startsWith('AIS_') && log.entity_type !== AI_ACTION_ENTITY_TYPE && (
        <DrawerSection title="Event details" testId="audit-event-details">
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
        </DrawerSection>
      )}

      {/* Generic Changes (for other event types) */}
      {log.changes && !log.action.startsWith('AIS_') && (
        <DrawerSection title="Changes made" testId="audit-changes">
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
        </DrawerSection>
      )}
    </>
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
  // The drawer (L-1d). `isOpen` drives the panel and `openId` names its row.
  // Closing clears only `isOpen`, so the content stays during Radix's slide-out
  // instead of blanking (SA S-1); the next open replaces `openId`. Modal does
  // not freeze `logs`: a read already in flight can land while the drawer is
  // open, and the effect below handles a row that leaves the page (QA B-1).
  const [isOpen, setIsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The row's Open button: focus goes back to it on close (D-6). */
  const opener = useRef<HTMLButtonElement | null>(null);
  /** Where focus goes when the opener's row is gone (QA B-1): the content area. */
  const contentRef = useRef<HTMLDivElement | null>(null);
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
  /**
   * The business the admin last picked, with the name the picker showed, so the
   * chip names it at once instead of waiting for rows (F-31). Not in the URL (a
   * name is not a filter). Read only while its id is the applied filter, so
   * Clear, the chip's X, Back/Forward or a link to another id need no reset.
   */
  const [pickedBusiness, setPickedBusiness] = useState<{ accountId: string; name: string | null } | null>(null);
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

  /** The row the drawer shows; null once that row is no longer loaded. */
  const selected = openId === null ? null : logs.find((log) => log.id === openId) ?? null;

  const openRow = (id: string, button: HTMLButtonElement) => {
    opener.current = button;
    setOpenId(id);
    setIsOpen(true);
  };

  // QA B-1: the open row left `logs` (a read landed without it). The drawer has
  // already closed (its `open` prop went false, and Radix does not call
  // onOpenChange for a prop change), so end the open state too. Otherwise a
  // later read that brings the row back would reopen the drawer unasked.
  useEffect(() => {
    if (isOpen && selected === null) {
      setIsOpen(false);
      setOpenId(null);
    }
  }, [isOpen, selected]);

  // D-6: back to the row's Open button; when that row is no longer on the page
  // its button is detached, so focus goes to the content area, never <body>.
  const returnFocus = () => {
    if (opener.current?.isConnected) opener.current.focus();
    else contentRef.current?.focus();
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

  // §5.5 part 7 (L-1e): "Business: {name}" or the short id, the full id on
  // hover, X "Remove business". The picked name first (only for the id it was
  // picked for), then the loaded rows; a picked unnamed business (null) falls
  // through to the rows, then the short id.
  const pickedName = pickedBusiness && pickedBusiness.accountId === filters.account ? pickedBusiness.name : null;
  const chips: AdminActiveChip[] = filters.account
    ? [
        businessFilterChip({
          accountId: filters.account,
          name: pickedName ?? accountFilterName(logs, filters.account),
          onRemove: () => setFilters({ account: '' }),
        }),
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
          // The shared picker (C-6, L-1e), labelled "Business" by default. The
          // fixed width keeps its standing hint from stretching the row. The
          // business filter is the only one applied at the DATABASE level to a
          // single account (route.ts `.eq('user_id', accountId)`). The hint is
          // said out loud because the list is `business_profiles`: an account
          // with no profile row can only be reached by pasting its id.
          <div className="w-full sm:w-72">
            <AdminBusinessPicker
              selectedAccountId={filters.account}
              onSelect={(account, name) => {
                setPickedBusiness({ accountId: account, name });
                setFilters({ account });
              }}
              hint="Only accounts with a business profile can be found by name. Paste a full account id to filter by any other account."
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

      <div ref={contentRef} tabIndex={-1} aria-busy={loading} className="space-y-6 focus:outline-none">
        {loading && logs.length === 0 && !error ? (
          <AdminLoading what={WHAT} />
        ) : (
          <>
            {/* Count line and pager. Hidden only on an error with no rows, so a
                failed first read shows no zero count under the red box (SA
                N-2); a search with no matches on this page keeps its pager.

                The route's total is the UNFILTERED count, and the free-text
                search is applied in memory to one page of rows (route.ts:96-98,
                :172). So with a search term active, "X of Y" is false in both
                halves — say what is actually true instead (FR-A4b). The page
                number itself is honest (it is the real offset page); only the
                page *count* is derived from the unfiltered total.

                Every place that would PRINT that count is therefore branched on
                isSearchActive — here and in the pager's own "Page n of m" label
                below. What stays deliberately unbranched is the pager's
                BEHAVIOUR: First/Previous/Next/Last and their enable/disable
                logic still run off pagination.totalPages, because they page the
                underlying unfiltered stream, which is what the route actually
                does. Making them describe a filtered set needs the filtered
                count, i.e. the separately tracked search fix (Non-Goal 2). The
                exemption covers the buttons, not the number they sit beside. */}
            {!(error && logs.length === 0) && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className={ADMIN_COUNT_LINE} data-testid="audit-count">
                  {isSearchActive ? (
                    <>
                      Showing {formatCount(pagination.showing)} matches on this page{' '}
                      <span className="text-slate-500">(Page {currentPage})</span>
                    </>
                  ) : (
                    <>
                      Showing {formatCount(pagination.showing)} of {formatCount(pagination.total)} audit logs
                      {pagination.totalPages > 1 && (
                        <>
                          {' '}
                          <span className="text-slate-500">
                            (Page {currentPage} of {formatCount(pagination.totalPages)})
                          </span>
                        </>
                      )}
                    </>
                  )}
                </p>

                {pagination.totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || loading}
                      className={ADMIN_BUTTON}
                    >
                      First
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1 || loading}
                      className={ADMIN_BUTTON}
                    >
                      Previous
                    </button>
                    {/* Label only — see the note above the count line. The
                        buttons either side keep using pagination.totalPages. */}
                    <span className="min-w-[100px] text-center text-sm text-slate-400">
                      {isSearchActive
                        ? `Page ${currentPage}`
                        : `Page ${currentPage} of ${formatCount(pagination.totalPages)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(prev => Math.min(pagination.totalPages, prev + 1))}
                      disabled={!pagination.hasMore || loading}
                      className={ADMIN_BUTTON}
                    >
                      Next
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage(pagination.totalPages)}
                      disabled={currentPage === pagination.totalPages || loading}
                      className={ADMIN_BUTTON}
                    >
                      Last
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* The search caveat (FR-A4b) as the standard's Partial notice (§5.10). */}
            {isSearchActive && (
              <AdminNotice testId="audit-search-caveat">
                Search scans only the current page of results. Use the Action, Entity Type,
                Severity and date filters for complete results.
              </AdminNotice>
            )}

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
              <div className={ADMIN_TABLE_WRAP}>
                <table className={ADMIN_TABLE} aria-label="Audit events" data-testid="audit-table">
                  <thead className={ADMIN_THEAD}>
                    <tr>
                      <th scope="col" className={ADMIN_TH}>Details</th>
                      <th scope="col" className={ADMIN_TH}>Time (UTC)</th>
                      <th scope="col" className={ADMIN_TH}>Event</th>
                      <th scope="col" className={ADMIN_TH}>Severity</th>
                      <th scope="col" className={ADMIN_TH}>Entity</th>
                      <th scope="col" className={ADMIN_TH}>Resource</th>
                      <th scope="col" className={ADMIN_TH}>Business</th>
                      <th scope="col" className={ADMIN_TH}>User</th>
                    </tr>
                  </thead>
                  <tbody className={ADMIN_TBODY}>
                    {logs.map((log) => {
                      const userLabel = auditUserLabel(log);
                      return (
                        <tr key={log.id} data-testid="audit-row">
                          <td className={ADMIN_TD}>
                            <OpenRowButton
                              testId="audit-open-details"
                              label={`Open details for ${getActionLabel(log.action)} at ${formatUtc(log.created_at)}`}
                              onOpen={(button) => openRow(log.id, button)}
                            />
                          </td>
                          <td className={`${ADMIN_TD} whitespace-nowrap`}>{formatUtc(log.created_at)}</td>
                          <td className={ADMIN_TD}>
                            <div className="flex items-center gap-2 text-slate-200">
                              <span className="flex-shrink-0" aria-hidden="true">
                                {getActionIcon(log.action)}
                              </span>
                              {getActionLabel(log.action)}
                            </div>
                            {/* Kept visible on the row, as it was on the card. */}
                            {log.compliance_flags && log.compliance_flags.length > 0 && (
                              <div className="text-[11px] text-sky-300">{log.compliance_flags.join(', ')}</div>
                            )}
                          </td>
                          <td className={ADMIN_TD}>
                            <SeverityChip severity={log.severity} testId="audit-severity" />
                          </td>
                          <td className={ADMIN_TD}>{log.entity_type}</td>
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
                              it is: no "missing" word and no em dash. Fixing the writers
                              is deliberately out of scope — making the gap visible first
                              is the point. */}
                          <td className={ADMIN_TD} data-testid="audit-cell-resource">
                            {log.resource_name ? (
                              log.resource_name
                            ) : (
                              <>
                                <span className="text-slate-500">Entity id</span>{' '}
                                <span className={ADMIN_TD_ID} title={log.entity_id}>
                                  {formatShortId(log.entity_id)}
                                </span>
                              </>
                            )}
                          </td>
                          {/* §5.7 "never blank": an em dash when the account has no
                              business profile (every agent-platform row) or the
                              business has not named itself (L-1d SA Q-4). */}
                          <td className={ADMIN_TD} data-testid="audit-cell-business">
                            {log.business?.company_name || <span className="text-slate-500">—</span>}
                          </td>
                          {/* Name, then sign-in email, then the account id, shortened
                              with the full id on hover. A system row has no user. */}
                          <td className={ADMIN_TD} data-testid="audit-cell-user">
                            {log.user_id && userLabel ? (
                              userLabel === log.user_id ? (
                                <span className={ADMIN_TD_ID} title={log.user_id}>
                                  {formatShortId(log.user_id)}
                                </span>
                              ) : (
                                userLabel
                              )
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* One drawer for the page, outside the table (C-9). It renders the row
          already in memory: opening and closing it asks for nothing (R-6). */}
      <AdminDrawer
        open={isOpen && selected !== null}
        onClose={() => setIsOpen(false)}
        onReturnFocus={returnFocus}
        title={selected ? getActionLabel(selected.action) : ''}
        titleSuffix={selected ? formatUtc(selected.created_at) : undefined}
        testId="audit-drawer"
      >
        {selected && <AuditEventBody log={selected} />}
      </AdminDrawer>
    </div>
  );
}
