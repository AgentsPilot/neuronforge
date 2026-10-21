'use client';

/**
 * The Businesses drawer body (Admin Layout Standard L-4b, §2.6 of the L-4b
 * workplan): the row detail that was an inline expanded table row, moved into
 * the page's one `AdminDrawer`. The page owns the three detail reads
 * (`useBusinessDetails`); this body only shows them.
 *
 * Order (Admin Layout follow-ups LF-4a.2, BD-4): the Business OS panel (its
 * header line, the summary strip, Credits & billing, Plan & entitlements, AI
 * usage), then Account & security, Activity, Data export (data export DE-10a,
 * SA-9: directly above the danger area, at the user's request), and the
 * danger area last. The
 * "All products" AI figures come from this body's stats and are handed to the
 * panel, which shows them inside AI usage (BD-7).
 *
 * The danger area is byte-equivalent to the expanded row's: the gate, the
 * Delete… entry and its dialog, then the account cleanup locked to this row's
 * email and id (the test-account hard delete, or close and anonymise, DE-10b.1).
 * It is never mounted while the drawer is closed: the drawer renders
 * this body only when open (Radix unmounts closed content).
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { DrawerField, DrawerFields } from '@/app/admin/components/layout/AdminDrawer';
import { AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { BusinessOsPanel } from './BusinessOsPanel';
import { BusinessAuditSection } from './BusinessAuditSection';
import { DataExportBlock } from './DataExportBlock';
import { AllProductsUsage } from './AllProductsUsage';
import { DeleteBusinessDialog } from './DeleteBusinessDialog';
import { DrawerBox, PART_BOX, PartPurpose } from './DrawerBox';
import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';
import { ageLine } from '@/app/admin/users/usersFormat';
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
  /**
   * BD-14 after a successful Give or Take back: the page's list read that keeps
   * the rows, and so this drawer, when it fails (LF-F2, LF4B-F1).
   */
  refreshListAfterCredits: () => Promise<void>;
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

/** A group label inside a section: a `p`, never a heading (one heading per section, L-1d M-4). */
const GROUP_LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-400';

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
  refreshListAfterCredits,
}: BusinessDetailProps) {
  /** The read-only deletion preview (admin delete AD-1c); local now that the body is one account. */
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  if (isLoading) return <AdminLoading what="the business details" />;

  return (
    <>
      {/* Business OS first (slice 2b): header line, strip, Credits & billing,
          Plan & entitlements, AI usage (with "All products", F-24 / Q-4 (a)). */}
      <BusinessOsPanel
        user={user}
        allProducts={detailedStats ? <AllProductsUsage stats={detailedStats} /> : null}
        onCreditsChanged={() => {
          // BD-14 (LF-4b, SA-C7): once after a successful Give or Take back, so
          // the strip, the list row and the Credits block agree. LF-F2: a failed
          // read keeps the rows, so this drawer and its notice stay open.
          void refreshListAfterCredits();
        }}
      />

      {/* 4. Account & security (BD-10): the four former sections as three
          groups, same fields and words. Group labels are not headings: the
          section has exactly one (L-1d M-4). LF-4d (BD-16): the section and
          each group in a box; a group's purpose line follows its label. */}
      <DrawerBox section="account" title="Account & security" testId="drawer-section-account">
        <div data-testid="account-group-account" className={`${PART_BOX} space-y-1`}>
          <p className={GROUP_LABEL}>Account</p>
          <PartPurpose part="account-account" />
          <DrawerFields>
            <DrawerField label="Full Name">{user.full_name || 'N/A'}</DrawerField>
            {user.company && <DrawerField label="Company">{user.company}</DrawerField>}
            {user.phone && <DrawerField label="Phone">{user.phone}</DrawerField>}
            <DrawerField label="User ID">
              <span className="break-all font-mono text-xs">{user.id}</span>
            </DrawerField>
            {/* No role row (SA-5a-1, as U-9): the Supabase sign-in role is not an admin indicator (admins: admin_users only). */}
            <DrawerField label="Created" testId="detail-created">
              <TimeWithAge iso={user.created_at} />
            </DrawerField>
            {user.updated_at && (
              <DrawerField label="Last Updated" testId="detail-updated">
                <TimeWithAge iso={user.updated_at} />
              </DrawerField>
            )}
          </DrawerFields>
        </div>

        <div data-testid="account-group-signin" className={`${PART_BOX} space-y-1`}>
          <p className={GROUP_LABEL}>Sign-in</p>
          <PartPurpose part="account-signin" />
          <DrawerFields>
            <DrawerField label="Email Verified">{user.email_confirmed ? '✓ Yes' : '✗ No'}</DrawerField>
            <DrawerField label="Auth Providers">
              <span className="flex flex-wrap gap-1">
                {user.providers && user.providers.length > 0 ? (
                  user.providers.map((provider) => (
                    <span key={provider} className="rounded bg-slate-700/60 px-2 py-0.5 text-xs font-medium text-slate-200">
                      {provider}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400">None</span>
                )}
              </span>
            </DrawerField>
            <DrawerField label="Last Sign In" testId="detail-last-sign-in">
              {user.last_sign_in_at ? <TimeWithAge iso={user.last_sign_in_at} /> : 'Never'}
            </DrawerField>
          </DrawerFields>
          {/* Shown only once the login-stats read succeeded, as before (F-105 stays open). */}
          {loginStats && (
            <div data-testid="account-login-stats">
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
            </div>
          )}
        </div>

        {/* The AgentsPilot fold (agents, agent executions) and the Subscription
            card (AP Pilot-Credit table, never rendered) were removed in
            ADMIN_BOS_CLEANUP slice 5a: their reads named columns that do not exist. */}

        {detailedStats && (
          <div data-testid="plugins-card" className={`${PART_BOX} space-y-2`}>
            <p className={GROUP_LABEL}>Connected plugins</p>
            <PartPurpose part="account-plugins" />
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
                            ? 'border border-slate-500 bg-slate-700/60 text-slate-200'
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
          </div>
        )}
      </DrawerBox>

      <BusinessAuditSection logs={auditLogs} filter={auditFilter} onFilterChange={onAuditFilterChange} />

      {/* Data export (DE-10a, BC-5: every login, with or without a business):
          the account's exports, prepare, audited download. Never gates the danger area. */}
      <DataExportBlock key={user.id} accountId={user.id} />

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
        {/* AU-1: the Danger Zone's cleanup, locked to this row's email (tag = email). DE-10b.1: with the
            row's account id it also offers "close and anonymise" (the default) beside the test-account
            hard delete; G-2a proves in the database that the id and the email are the same login. */}
        {user.email ? (
          <TestAccountCleanupPanel
            key={user.id}
            lockedEmail={user.email}
            lockedAccountId={user.id}
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
