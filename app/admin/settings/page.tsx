'use client';

/**
 * Admin users: who can open admin. Read-only.
 *
 * ADMIN_BOS_CLEANUP slice 1 (FR-AU1 to FR-AU5; conditions C-3, C-4; SA W-3, W-5).
 *
 * The only request this page makes is `GET /api/admin/admins`. It lists the
 * active rows of the `admin_users` table and, separately, the addresses granted
 * only by the `ADMIN_EMAILS` environment setting. A table admin who is also in
 * that setting carries a marker, because deactivating the row alone does not
 * revoke their access.
 *
 * There is no add, remove or role control, by decision (OQ-1 = B). The page
 * used to manage a JSON list in `system_settings_config` that granted nothing.
 *
 * A list is shown only when the response vouches for it: anything other than
 * `success: true` with both lists as arrays is an error, and a failed refresh
 * clears the previous list instead of leaving it on screen as if it were
 * current. "No active rows" is never shown for a failed read.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Mail, RefreshCw, Shield } from 'lucide-react';

import type { AdminListData } from '@/lib/admin/adminList-types';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AdminUsersPage' });

const ADMIN_LIST_URL = '/api/admin/admins';

type Status = 'loading' | 'ready' | 'error';

/** A body this page can vouch for (SA W-3a). Anything else is an error. */
function isAdminListBody(body: unknown): body is { success: true; data: AdminListData } {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as { success?: unknown; data?: { tableAdmins?: unknown; envOnlyAdmins?: unknown } };
  return (
    candidate.success === true &&
    !!candidate.data &&
    Array.isArray(candidate.data.tableAdmins) &&
    Array.isArray(candidate.data.envOnlyAdmins)
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function AdminUsersPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AdminListData | null>(null);
  // Only the latest request may set state, so a slow earlier response cannot
  // overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setStatus('loading');
    let httpStatus: number | undefined;
    try {
      const response = await fetch(ADMIN_LIST_URL, { method: 'GET' });
      httpStatus = response.status;
      const body: unknown = await response.json();
      if (requestId !== latestRequest.current) return;
      if (!response.ok || !isAdminListBody(body)) {
        throw new Error('The admin list response could not be used');
      }
      setData(body.data);
      setStatus('ready');
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      // No address in the log: only the error and the HTTP status.
      logger.warn({ err, status: httpStatus }, 'Admin list request failed');
      // Never leave a list on screen that this request could not confirm (SA W-3b).
      setData(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isLoading = status === 'loading';

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="border-b border-slate-700">
        <div className="flex items-center justify-between pb-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-4 mb-1">
              <h1 className="text-xl font-semibold text-white">Admin users</h1>
              <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">Read-only</span>
            </div>
            <p className="text-sm text-slate-400">Who can open admin. Read-only.</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label="Refresh"
            title="Refresh"
            className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-slate-400 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {status === 'error' && (
        <div
          role="alert"
          className="flex items-center gap-3 p-4 rounded-xl border backdrop-blur-xl bg-red-500/20 border-red-500/30 text-red-300"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium">
            Could not load the admin list. Nothing is shown rather than a list that may be wrong.
          </p>
        </div>
      )}

      {status === 'loading' && !data && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
        </div>
      )}

      {data && status !== 'error' && (
        <>
          {/* Table admins */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-blue-400" />
              From the admin_users table
            </h2>
            {data.tableAdmins.length === 0 ? (
              <p className="text-sm text-slate-400">No active rows in the admin_users table.</p>
            ) : (
              <ul className="space-y-3">
                {data.tableAdmins.map((admin) => (
                  <li
                    key={admin.email}
                    data-testid="table-admin"
                    className="p-4 bg-slate-700/30 rounded-xl border border-slate-600/50"
                  >
                    <div className="flex items-center gap-2 font-medium text-white">
                      <Mail className="w-4 h-4 text-slate-400" />
                      {admin.email}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400 mt-1">
                      <span>Linked to a login: {admin.linkedToLogin ? 'yes' : 'not yet'}</span>
                      <span>Added {formatDate(admin.addedAt)}</span>
                    </div>
                    {admin.notes && <p className="text-sm text-slate-400 mt-1">{admin.notes}</p>}
                    {admin.alsoInEnv && (
                      <p className="text-xs text-blue-300 mt-2">
                        Also in the environment setting: removing the row alone does not revoke access
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Environment admins */}
          <section className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-blue-400" />
              Granted by the ADMIN_EMAILS environment setting
            </h2>
            {data.envOnlyAdmins.length === 0 ? (
              <p className="text-sm text-slate-400">No addresses beyond the table.</p>
            ) : (
              <ul className="space-y-3">
                {data.envOnlyAdmins.map((admin) => (
                  <li
                    key={admin.email}
                    data-testid="env-admin"
                    className="flex items-center gap-2 p-4 bg-slate-700/30 rounded-xl border border-slate-600/50 font-medium text-white"
                  >
                    <Mail className="w-4 h-4 text-slate-400" />
                    {admin.email}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* How access is granted and revoked (FR-AU4). The doc path is text: the app does not serve /docs. */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl" data-testid="access-info">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-200 space-y-1">
            <p>Access comes from the admin_users table or the ADMIN_EMAILS environment setting.</p>
            <p className="text-blue-300/80">
              To add or remove an admin, run the seed script or SQL, as described in
              docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md § Bootstrapping Admins. Table changes reach every
              server within about a minute; an ADMIN_EMAILS change needs a redeploy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
