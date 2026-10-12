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
 *
 * Admin Layout Standard L-12: the shared header (h1 = the sidebar label, the
 * "Read-only" badge as the neutral chip), Refresh in the Refresh-only bar with
 * "Read at", the shared loading and error states (Try again), UTC times through
 * the shared formatter, and the standard card shell. No KPI strip (D-5 (a)),
 * no filters, no table, no drawer, no dialog. The body is read through
 * `readAdminResponse`, status first (F-85): the route's own words, the shared
 * fixed sentences, or the session-ended words; never a parser message. The
 * request line is unchanged. A failed read still clears the lists, and now
 * also "Read at", so no clock names a list that is no longer shown (§5.5,
 * SA L-12 Q-3).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Info, Mail, Shield } from 'lucide-react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import type { AdminListData } from '@/lib/admin/adminList-types';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AdminUsersPage' });

const ADMIN_LIST_URL = '/api/admin/admins';

/** Noun phrase for the shared states, the fallback words and the Refresh name. */
const WHAT = 'the admin list';

/**
 * A 2xx `success: true` whose lists are not both arrays (SA W-3a). Same words as
 * the shared fallback, which the helper does not export (the Invites and
 * Messages precedent); a test pins that the two never drift (SA S-5).
 */
const UNUSABLE = 'Could not read the admin list. Try again in a moment.';

type Status = 'loading' | 'ready' | 'error';

/** Lists this page can vouch for (SA W-3a). `success: true` is checked by the helper. */
function isAdminListData(data: unknown): data is AdminListData {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as { tableAdmins?: unknown; envOnlyAdmins?: unknown };
  return Array.isArray(candidate.tableAdmins) && Array.isArray(candidate.envOnlyAdmins);
}

const CARD = 'rounded-xl border border-slate-700 bg-slate-800/40 p-4';
const CARD_TITLE = 'mb-3 flex items-center gap-2 text-sm font-semibold text-white';
const ITEM = 'rounded-lg border border-slate-700 bg-slate-900/40 p-3';

export default function AdminUsersPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<AdminListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  // Only the latest request may set state, so a slow earlier response cannot
  // overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setStatus('loading');

    // Never leave a list (or a clock naming it) on screen that this request
    // could not confirm (SA W-3b).
    const fail = (message: string) => {
      setData(null);
      setReadAt(null);
      setError(message);
      setStatus('error');
    };

    let response: Response;
    try {
      response = await fetch(ADMIN_LIST_URL, { method: 'GET' });
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      // No address in the log: only the error.
      logger.warn({ err }, 'Admin list request failed');
      fail(ADMIN_NETWORK_ERROR);
      return;
    }

    // Never throws: an unreadable body becomes the fixed fallback.
    const result = await readAdminResponse<AdminListData>(response, { what: WHAT, sessionEndedCopy: true });
    if (requestId !== latestRequest.current) return;

    if (result.ok && isAdminListData(result.data)) {
      setData(result.data);
      setReadAt(new Date().toISOString());
      setError(null);
      setStatus('ready');
      return;
    }

    // The HTTP status only: never the body or the message (SA N-2).
    logger.warn({ status: response.status }, 'Admin list request failed');
    fail(result.ok ? UNUSABLE : result.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isLoading = status === 'loading';

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin users"
        purpose="Who can open admin."
        badge={{ label: 'Read-only', testId: 'read-only-badge' }}
      />

      <AdminFilterBar onRefresh={() => void load()} busy={isLoading} what={WHAT} readAt={readAt} />

      {/* Always mounted, so a refresh keeps the lists on screen while it reads (§5.10). */}
      <div data-testid="admin-users-content" aria-busy={isLoading} className="space-y-6">
        {status === 'error' && error && (
          <AdminError message={error} testId="admin-list-error" onRetry={() => void load()} />
        )}

        {status === 'loading' && !data && <AdminLoading what={WHAT} />}

        {data && status !== 'error' && (
          <>
            {/* Table admins */}
            <section className={CARD}>
              <h2 className={CARD_TITLE}>
                <Shield className="h-4 w-4 text-slate-400" aria-hidden="true" />
                From the admin_users table
              </h2>
              {data.tableAdmins.length === 0 ? (
                <p className="text-sm text-slate-400">No active rows in the admin_users table.</p>
              ) : (
                <ul className="space-y-3">
                  {data.tableAdmins.map((admin) => (
                    <li key={admin.email} data-testid="table-admin" className={ITEM}>
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                        <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        {admin.email}
                      </div>
                      {/* Inline spans, not a dl: row metadata, and the pinned text keeps its spaces (SA Q-6). */}
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                        <span>Linked to a login: {admin.linkedToLogin ? 'yes' : 'not yet'}</span>
                        <span>Added {formatUtc(admin.addedAt)}</span>
                      </div>
                      {admin.notes && <p className="mt-1 text-sm text-slate-400">{admin.notes}</p>}
                      {admin.alsoInEnv && (
                        <p className="mt-2 text-xs text-sky-300">
                          Also in the environment setting: removing the row alone does not revoke access
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Environment admins */}
            <section className={CARD}>
              <h2 className={CARD_TITLE}>
                <Shield className="h-4 w-4 text-slate-400" aria-hidden="true" />
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
                      className={`flex items-center gap-2 text-sm font-medium text-white ${ITEM}`}
                    >
                      <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                      {admin.email}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {/*
        How access is granted and revoked (FR-AU4). The doc path is text: the app
        does not serve /docs. A neutral standing note, not the amber notice: it
        says nothing is missing (SA L-12 Q-4).
      */}
      <div className={CARD} data-testid="access-info">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-400" aria-hidden="true" />
          <div className="space-y-1 text-sm text-slate-300">
            <p>Access comes from the admin_users table or the ADMIN_EMAILS environment setting.</p>
            <p className="text-slate-400">
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
