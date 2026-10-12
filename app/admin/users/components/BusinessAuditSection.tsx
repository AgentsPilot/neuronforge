'use client';

/**
 * The per-business audit section of the Businesses drawer (Admin Layout
 * Standard L-4b, §2.7 of the L-4b workplan).
 *
 * Collapsed by default, every time an account is opened (user request,
 * 2026-10-11): one "Show / Hide audit events" button as the section's first
 * child (SA Q-7). The folded part is ALWAYS rendered and hidden with the
 * `hidden` attribute, never unmounted (SA M-2): `ArchivedBeforeNotice` reads
 * the archiving route on mount, so mounting it on expand would send a request.
 * Expanding or collapsing sends nothing; the events come from the page's
 * opening read.
 */

import { useId, useState } from 'react';
import { ArchivedBeforeNotice } from '@/app/admin/components/ArchivedBeforeNotice';
import { DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { ADMIN_FIELD_CONTROL, ADMIN_FIELD_LABEL } from '@/app/admin/components/layout/AdminFilterBar';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import type { AuditEventFilter, AuditLogEntry } from '@/app/admin/users/types';

/** The list shows the newest entries only, as before L-4b. */
const AUDIT_LIST_LIMIT = 50;

/** Narrow a `<select>` value without a cast; anything unknown is `'all'`. */
function toAuditEventFilter(value: string): AuditEventFilter {
  return value === 'login' || value === 'security' || value === 'settings' ? value : 'all';
}

function filterLogs(logs: AuditLogEntry[], filter: AuditEventFilter): AuditLogEntry[] {
  if (filter === 'login') {
    return logs.filter((log) => log.action.includes('LOGIN') || log.action.includes('LOGOUT'));
  }
  if (filter === 'security') {
    return logs.filter(
      (log) => log.action.includes('PASSWORD') || log.action.includes('SECURITY') || log.action.includes('2FA')
    );
  }
  if (filter === 'settings') {
    return logs.filter((log) => log.action.includes('SETTINGS') || log.action.includes('PROFILE'));
  }
  return logs;
}

function formatActionName(action: string): string {
  return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Severity as a §5.9 chip, with the Audit trail page's mapping. `Partial`, so
 * any other stored value shows as `unknown` with its raw word (L-1d SA S-2).
 */
const SEVERITY_TONE: Partial<Record<string, StatusTone>> = { critical: 'danger', warning: 'warn', info: 'info' };
const SEVERITY_WORD: Partial<Record<string, string>> = { critical: 'Critical', warning: 'Warning', info: 'Info' };

function SeverityChip({ severity }: { severity: string }) {
  // Own keys only: a stored value such as "constructor" must not resolve to
  // an Object.prototype member and reach StatusChip as a tone.
  const known = Object.prototype.hasOwnProperty.call(SEVERITY_TONE, severity);
  return (
    <StatusChip tone={(known ? SEVERITY_TONE[severity] : undefined) ?? 'unknown'}>
      {(known ? SEVERITY_WORD[severity] : undefined) ?? (severity || 'Unknown')}
    </StatusChip>
  );
}

export interface BusinessAuditSectionProps {
  logs: AuditLogEntry[];
  /** Held by the page per account, so a chosen filter survives a reopen. */
  filter: AuditEventFilter;
  onFilterChange: (value: AuditEventFilter) => void;
}

export function BusinessAuditSection({ logs, filter, onFilterChange }: BusinessAuditSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const foldId = useId();
  const selectId = useId();
  const shown = filterLogs(logs, filter);

  return (
    <DrawerSection title="Audit trail" testId="detail-audit">
      <button
        type="button"
        data-testid="detail-audit-toggle"
        aria-expanded={expanded}
        aria-controls={foldId}
        onClick={() => setExpanded((open) => !open)}
        className={ADMIN_BUTTON}
      >
        {expanded ? 'Hide audit events' : 'Show audit events'}
      </button>

      <div id={foldId} hidden={!expanded} data-testid="detail-audit-fold" className="space-y-3 pt-1">
        <div>
          <label htmlFor={selectId} className={ADMIN_FIELD_LABEL}>
            Event type
          </label>
          <select
            id={selectId}
            value={filter}
            onChange={(e) => onFilterChange(toAuditEventFilter(e.target.value))}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="all">All Events</option>
            <option value="login">Login Events</option>
            <option value="security">Security Events</option>
            <option value="settings">Settings Changes</option>
          </select>
        </div>

        {/* Older entries may be archived (FR-12, archiving slice 3). */}
        <ArchivedBeforeNotice />

        {shown.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-300">No audit logs found</p>
            <p className="text-sm text-slate-400">User activity will appear here</p>
          </div>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {shown.slice(0, AUDIT_LIST_LIMIT).map((log) => (
              <li
                key={log.id}
                data-testid="detail-audit-event"
                className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3"
              >
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                  <div>
                    <p className="mb-1 text-xs text-slate-400">Action</p>
                    {/* Not a heading: each DrawerSection has exactly one (L-1d M-4). */}
                    <p className="truncate text-sm font-semibold text-white">{formatActionName(log.action)}</p>
                    <div className="mt-2">
                      <SeverityChip severity={log.severity} />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-400">Resource</p>
                    {log.resource_name ? (
                      <p className="truncate text-sm text-white">{log.resource_name}</p>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-400">Time</p>
                    <p className="whitespace-nowrap text-sm text-white">{formatUtc(log.created_at)}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-400">IP Address</p>
                    {log.ip_address ? (
                      <p className="font-mono text-sm text-white">{log.ip_address}</p>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <p className="mb-1 text-xs text-slate-400">Compliance Flags</p>
                    {log.compliance_flags && log.compliance_flags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {log.compliance_flags.map((flag, i) => (
                          <span key={i} className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">
                            {flag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DrawerSection>
  );
}
