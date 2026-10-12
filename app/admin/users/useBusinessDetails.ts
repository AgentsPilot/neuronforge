'use client';

/**
 * The three per-account detail reads of the Businesses screen (Admin Layout
 * Standard L-4b, §2.2 / §2.4 of the L-4b workplan): login stats, audit events
 * and the connected-plugins / AI-spend stats.
 *
 * Page-owned on purpose, not a drawer resource (R-6, SA Q-3): the results are
 * a per-account cache that outlives the drawer. The list's Login Activity
 * column reads it, and a reopen is served from it (QA-P8, O-3). So closing the
 * drawer never aborts a read or drops a result, and every result is stored
 * under its own account id: a late answer can never show under another one.
 *
 * Each body is read through `readJsonBody` with the status checked first, so
 * a body that is not JSON affects only its own section (SA Q-4). Before L-4b a
 * parser error in any body skipped the sections after it.
 */

import { useCallback, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import type {
  AuditEventFilter,
  AuditLogEntry,
  UserDetailedStats,
  UserLoginStats,
} from '@/app/admin/users/types';

// The page's module name, so log queries written for the page still match.
const logger = createLogger({ module: 'AdminUsersPage' });

/** Stored when the stats request itself failed, so both cards say so (SA-5a-2). */
const UNREADABLE_STATS: UserDetailedStats = { tokens: null, plugins: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface BusinessDetails {
  loginStats: Record<string, UserLoginStats>;
  auditLogs: Record<string, AuditLogEntry[]>;
  detailedStats: Record<string, UserDetailedStats>;
  loading: Record<string, boolean>;
  auditFilters: Record<string, AuditEventFilter>;
  setAuditFilter: (accountId: string, value: AuditEventFilter) => void;
  /** Reads the account's three sections unless all four parts are already held (O-3). */
  loadDetails: (accountId: string) => Promise<void>;
}

export function useBusinessDetails(): BusinessDetails {
  const [loginStats, setLoginStats] = useState<Record<string, UserLoginStats>>({});
  const [auditLogs, setAuditLogs] = useState<Record<string, AuditLogEntry[]>>({});
  const [detailedStats, setDetailedStats] = useState<Record<string, UserDetailedStats>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [auditFilters, setAuditFilters] = useState<Record<string, AuditEventFilter>>({});

  const setAuditFilter = useCallback((accountId: string, value: AuditEventFilter) => {
    setAuditFilters((prev) => ({ ...prev, [accountId]: value }));
  }, []);

  // Honest deps (SA S-3): the cache check reads this render's maps, so it can
  // never skip a read on a stale "loaded" or repeat one already held.
  const loadDetails = useCallback(
    async (accountId: string) => {
      // Don't fetch if already loaded. A stats section that could not be read
      // is not "loaded": it is fetched again on the next open, not cached (O-3).
      if (
        loginStats[accountId] &&
        auditLogs[accountId] &&
        detailedStats[accountId]?.tokens &&
        detailedStats[accountId]?.plugins
      ) {
        return;
      }

      setLoading((prev) => ({ ...prev, [accountId]: true }));

      try {
        // Fetch all data in parallel
        const [loginResponse, auditResponse, statsResponse] = await Promise.all([
          fetch(`/api/admin/users/${accountId}/login-stats`),
          fetch(`/api/admin/users/${accountId}/audit-logs`),
          fetch(`/api/admin/users/${accountId}/stats`),
        ]);

        // Login statistics. An unreadable body is not stored, so the next
        // open reads it again.
        if (loginResponse.ok) {
          const body = await readJsonBody(loginResponse);
          if (body === null) {
            // SA S-2: facts only (section and status), never the body.
            logger.error({ section: 'login-stats', status: loginResponse.status }, 'User detail body could not be read');
          } else {
            setLoginStats((prev) => ({ ...prev, [accountId]: body.data as UserLoginStats }));
          }
        }

        // Audit events. An unreadable body is never stored as [], which would
        // cache "no events" for good (SA Q-4).
        if (auditResponse.ok) {
          const body = await readJsonBody(auditResponse);
          if (body === null) {
            logger.error({ section: 'audit-logs', status: auditResponse.status }, 'User detail body could not be read');
          } else {
            const logs = (body.data as AuditLogEntry[] | null | undefined) || [];
            setAuditLogs((prev) => ({ ...prev, [accountId]: logs }));
          }
        }

        // Detailed stats (connected plugins and AI spend)
        if (statsResponse.ok) {
          const body = await readJsonBody(statsResponse);
          if (body === null) {
            logger.error({ section: 'stats', status: statsResponse.status }, 'User detail body could not be read');
            // As the old shared catch did for this case: unreadable unless
            // this account already holds a result (SA 5a code review, QA E-1).
            setDetailedStats((prev) => (prev[accountId] ? prev : { ...prev, [accountId]: UNREADABLE_STATS }));
          } else {
            const data = isRecord(body.data) ? body.data : null;
            // Facts only: the payload holds plugin keys and AI spend for one
            // person (QA E-3). Never the payload itself.
            const plugins = data && isRecord(data.plugins) ? data.plugins : null;
            logger.debug(
              {
                success: body.success === true,
                tokens: data?.tokens ? 'ok' : 'unavailable',
                plugins: plugins?.total ?? null,
              },
              'User detailed stats response'
            );
            // A failed request stores both sections as unreadable, so the
            // cards say so instead of vanishing (SA-5a-2).
            const detailed: UserDetailedStats =
              body.success === true && data
                ? {
                    tokens: (data.tokens as UserDetailedStats['tokens'] | undefined) ?? null,
                    plugins: (data.plugins as UserDetailedStats['plugins'] | undefined) ?? null,
                  }
                : UNREADABLE_STATS;
            setDetailedStats((prev) => ({ ...prev, [accountId]: detailed }));
          }
        } else {
          logger.error({ status: statsResponse.status }, 'Failed to fetch detailed stats');
          setDetailedStats((prev) => ({ ...prev, [accountId]: UNREADABLE_STATS }));
        }

        // Initialize audit filter for this user
        if (!auditFilters[accountId]) {
          setAuditFilters((prev) => ({ ...prev, [accountId]: 'all' }));
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to fetch user details');
        // A rejected fetch (network error, blocked request) must not make the
        // cards vanish silently either: mark them unreadable unless this
        // account already holds a result (SA 5a code review, QA E-1).
        setDetailedStats((prev) => (prev[accountId] ? prev : { ...prev, [accountId]: UNREADABLE_STATS }));
      } finally {
        setLoading((prev) => ({ ...prev, [accountId]: false }));
      }
    },
    [loginStats, auditLogs, detailedStats, auditFilters]
  );

  return { loginStats, auditLogs, detailedStats, loading, auditFilters, setAuditFilter, loadDetails };
}
