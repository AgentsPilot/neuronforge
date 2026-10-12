'use client';

/**
 * The Businesses drawer body (Admin Layout Standard L-4b, §2.6 of the L-4b
 * workplan): the row detail that was an inline expanded table row, moved into
 * the page's one `AdminDrawer`. Same blocks, same order: the Business OS panel
 * first, the danger area last. The page owns the three detail reads
 * (`useBusinessDetails`); this body only shows them.
 *
 * The danger area is byte-equivalent to the expanded row's: the gate, the
 * Delete… entry and its dialog, then the hard delete locked to this row's
 * email. It is never mounted while the drawer is closed: the drawer renders
 * this body only when open (Radix unmounts closed content).
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DrawerField, DrawerFields, DrawerSection } from '@/app/admin/components/layout/AdminDrawer';
import { AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { BusinessOsPanel } from './BusinessOsPanel';
import { BusinessAuditSection } from './BusinessAuditSection';
import { DeleteBusinessDialog } from './DeleteBusinessDialog';
import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';
import { ageLine, formatCost, formatNumber } from '@/app/admin/users/usersFormat';
import type {
  AdminUserRow,
  AuditEventFilter,
  AuditLogEntry,
  UserDetailedStats,
  UserLoginStats,
} from '@/app/admin/users/types';

/**
 * AU-2 (user decision 2026-10-08): the AD-1/AD-2 "Delete…" preview entry is
 * hidden until AD-2 is activated. Button, dialog, route and tests stay;
 * un-hiding is this one line.
 */
const SHOW_AD1_DELETE_ENTRY = false;

export interface BusinessDetailProps {
  user: AdminUserRow;
  /** Absent until the login-stats read succeeded (the section is then not shown, as before). */
  loginStats?: UserLoginStats;
  /** Absent until the stats read settled; a section inside is `null` when it could not be read. */
  detailedStats?: UserDetailedStats;
  auditLogs: AuditLogEntry[];
  auditFilter: AuditEventFilter;
  onAuditFilterChange: (value: AuditEventFilter) => void;
  /** The account's three reads are running. */
  isLoading: boolean;
  /** The page's list read (`fetchUsers`), after a deletion or a hard delete. */
  refreshList: () => Promise<void>;
}

/** A UTC time with its age as a second line (§5.11; the L-4a list rule). */
function TimeWithAge({ iso }: { iso: string }) {
  return (
    <>
      <span className="block">{formatUtc(iso)}</span>
      <span className="block text-xs text-slate-400">{ageLine(iso)}</span>
    </>
  );
}

function pluginName(plugin: string): string {
  return plugin.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

export function BusinessDetail({
  user,
  loginStats,
  detailedStats,
  auditLogs,
  auditFilter,
  onAuditFilterChange,
  isLoading,
  refreshList,
}: BusinessDetailProps) {
  /** The read-only deletion preview (admin delete AD-1c); local now that the body is one account. */
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  if (isLoading) return <AdminLoading what="the business details" />;

  return (
    <>
      {/* Business OS first (slice 2b): business, plan, AI spend, AI failures. */}
      <BusinessOsPanel accountId={user.id} userName={user.full_name} />

      <DrawerSection title="User information">
        <DrawerFields>
          <DrawerField label="Full Name">{user.full_name || 'N/A'}</DrawerField>
          {user.company && <DrawerField label="Company">{user.company}</DrawerField>}
          {user.phone && <DrawerField label="Phone">{user.phone}</DrawerField>}
          <DrawerField label="User ID">
            <span className="break-all font-mono text-xs">{user.id}</span>
          </DrawerField>
          {/* No role row (SA-5a-1, as U-9): the Supabase sign-in role is not an admin indicator (admins: admin_users only). */}
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title="Account timeline">
        <DrawerFields>
          <DrawerField label="Created" testId="detail-created">
            <TimeWithAge iso={user.created_at} />
          </DrawerField>
          <DrawerField label="Last Sign In" testId="detail-last-sign-in">
            {user.last_sign_in_at ? <TimeWithAge iso={user.last_sign_in_at} /> : 'Never'}
          </DrawerField>
          {user.updated_at && (
            <DrawerField label="Last Updated" testId="detail-updated">
              <TimeWithAge iso={user.updated_at} />
            </DrawerField>
          )}
        </DrawerFields>
      </DrawerSection>

      <DrawerSection title="Security">
        <DrawerFields>
          <DrawerField label="Email Verified">{user.email_confirmed ? '✓ Yes' : '✗ No'}</DrawerField>
          <DrawerField label="Auth Providers">
            <span className="flex flex-wrap gap-1">
              {user.providers && user.providers.length > 0 ? (
                user.providers.map((provider) => (
                  <span key={provider} className="rounded bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-300">
                    {provider}
                  </span>
                ))
              ) : (
                <span className="text-slate-400">None</span>
              )}
            </span>
          </DrawerField>
        </DrawerFields>
      </DrawerSection>

      {loginStats && (
        <DrawerSection title="Login activity">
          <DrawerFields>
            <DrawerField label="Total Logins">
              <span className="tabular-nums">{loginStats.total_logins || 0}</span>
            </DrawerField>
            <DrawerField label="Failed Logins">
              <span className="tabular-nums">{loginStats.failed_logins || 0}</span>
            </DrawerField>
            <DrawerField label="Unique IPs">
              <span className="tabular-nums">{loginStats.unique_ips || 0}</span>
            </DrawerField>
            <DrawerField label="Last Login IP">
              <span className="font-mono">{loginStats.last_login_ip || 'N/A'}</span>
            </DrawerField>
          </DrawerFields>
        </DrawerSection>
      )}

      {/* The AgentsPilot fold (agents, agent executions) and the Subscription
          card (AP Pilot-Credit table, never rendered) were removed in
          ADMIN_BOS_CLEANUP slice 5a: their reads named columns that do not exist. */}

      {detailedStats && (
        <DrawerSection title="Connected plugins" testId="plugins-card">
          {detailedStats.plugins === null ? (
            <p className="text-sm text-red-300">The connected plugins could not be read.</p>
          ) : (
            <>
              <p className="text-sm text-slate-300 tabular-nums">
                {detailedStats.plugins.active}/{detailedStats.plugins.total} active
              </p>
              {detailedStats.plugins.list.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {detailedStats.plugins.list.map((plugin, idx) => (
                    <span
                      key={idx}
                      className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                        plugin.is_active
                          ? 'border border-orange-500/30 bg-orange-500/20 text-orange-300'
                          : 'border border-slate-600 bg-slate-700/50 text-slate-400'
                      }`}
                    >
                      {/* The chip's own colour: decoration only (T-6). The word says the state (A-7). */}
                      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
                      {pluginName(plugin.plugin)}
                      {!plugin.is_active && (
                        <>
                          {' '}
                          <span className="text-xs">inactive</span>
                        </>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No plugins connected</p>
              )}
            </>
          )}
        </DrawerSection>
      )}

      {/* AI spend, all products (token_usage, 30 days). F-24 (two AI spend blocks) stays the user's. */}
      {detailedStats && (
        <DrawerSection
          title="AI spend, all products (30 days; may be incomplete above 1,000 calls)"
          testId="ai-spend-card"
        >
          {detailedStats.tokens === null ? (
            <p className="text-sm text-red-300">The AI usage records could not be read.</p>
          ) : (
            <>
              <DrawerFields>
                <DrawerField label="Input Tokens">
                  <span className="tabular-nums">{formatNumber(detailedStats.tokens.total_input_tokens)}</span>
                </DrawerField>
                <DrawerField label="Output Tokens">
                  <span className="tabular-nums">{formatNumber(detailedStats.tokens.total_output_tokens)}</span>
                </DrawerField>
                <DrawerField label="LLM Calls">
                  <span className="tabular-nums">{formatNumber(detailedStats.tokens.total_calls)}</span>
                </DrawerField>
                <DrawerField label="Total Cost">
                  <span className="tabular-nums text-cyan-300">{formatCost(detailedStats.tokens.total_cost_usd)}</span>
                </DrawerField>
              </DrawerFields>

              {detailedStats.tokens.by_model.length > 0 && (
                <div>
                  {/* Not a heading: each DrawerSection has exactly one (L-1d M-4). */}
                  <p className="mb-2 text-sm font-semibold text-slate-300">Cost by Model</p>
                  <ul className="max-h-48 space-y-2 overflow-y-auto">
                    {detailedStats.tokens.by_model.map((model, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/50 p-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm text-white">{model.model}</span>
                          <span className="text-xs text-slate-400">{formatNumber(model.calls)} calls</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm tabular-nums">
                          <span className="text-slate-400">
                            <span className="text-blue-300">{formatNumber(model.input)}</span> in /{' '}
                            <span className="text-slate-200">{formatNumber(model.output)}</span> out
                          </span>
                          <span className="font-semibold text-cyan-300">{formatCost(model.cost)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DrawerSection>
      )}

      <BusinessAuditSection logs={auditLogs} filter={auditFilter} onFilterChange={onAuditFilterChange} />

      {/* Danger area (admin delete AD-1c, FR-A1): inside the open drawer only, never the list row. */}
      <div
        data-testid="danger-area"
        className="p-6 rounded-xl border border-rose-500/40 bg-rose-500/5"
      >
        <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-400" aria-hidden="true" />
          Danger area
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Permanent actions for this account. Each runs a check first; a refused check changes nothing.
        </p>
        {SHOW_AD1_DELETE_ENTRY && (
          <>
            <button
              type="button"
              data-testid="delete-business-open"
              onClick={(e) => {
                e.stopPropagation();
                setIsDeleteOpen(true);
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-rose-500/50 text-rose-200 hover:bg-rose-500/20 transition-colors"
            >
              Delete…
            </button>
            <DeleteBusinessDialog
              open={isDeleteOpen}
              onOpenChange={(next) => setIsDeleteOpen(next)}
              accountId={user.id}
              onDeleted={() => {
                // FR-A9: after a deletion the row reads "No Business OS business".
                void refreshList();
              }}
            />
          </>
        )}
        {/* AU-1: the Danger Zone's hard delete, locked to this row's email (tag = email). */}
        {user.email ? (
          <TestAccountCleanupPanel
            key={user.id}
            lockedEmail={user.email}
            tone="admin-dark"
            onRemoved={() => {
              // AU-C2: CLEAN only, once the admin clicks Done (or the panel unmounts); the row leaves the list.
              void refreshList();
            }}
          />
        ) : (
          <p className="text-sm text-slate-400">This login has no email, so it cannot be removed here.</p>
        )}
      </div>
    </>
  );
}
