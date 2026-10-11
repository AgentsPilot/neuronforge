'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clock,
  TrendingUp,
  Users as UsersIcon,
  CheckCircle,
  Phone,
  Building,
  Shield,
  AlertTriangle,
  MapPin,
  XCircle,
  LogIn,
  Settings,
  FileText,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { ArchivedBeforeNotice } from '@/app/admin/components/ArchivedBeforeNotice';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import {
  AdminFilterBar,
  ADMIN_FIELD_CONTROL,
  ADMIN_FIELD_LABEL,
} from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
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
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { BusinessOsPanel } from './components/BusinessOsPanel';
import { BusinessesKpis } from './components/BusinessesKpis';
import { UserNameLine } from './components/UserNameLine';
import { CreditsLeftCell } from './components/CreditsLeftCell';
import { DeleteBusinessDialog } from './components/DeleteBusinessDialog';
import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';
import { rowToggleName, toStatusFilter, type StatusFilter } from './userName';
import { USERS_FILTER_SPEC, USERS_WHAT } from './usersFilters';
import type { RowBusiness, RowCreditsLeft } from './types';

const logger = createLogger({ module: 'AdminUsersPage' });

/**
 * AU-2 (user decision 2026-10-08): the AD-1/AD-2 "Delete…" preview entry is
 * hidden until AD-2 is activated. Button, dialog, route and tests stay;
 * un-hiding is this one line.
 */
const SHOW_AD1_DELETE_ENTRY = false;

interface User {
  id: string;
  full_name: string;
  company?: string;
  email: string;
  email_confirmed: boolean;
  phone?: string;
  last_sign_in_at?: string;
  created_at: string;
  updated_at?: string;
  providers: string[];
  role: string;
  /**
   * The login's Business OS business (one login = one business). `null` = it
   * has none; `undefined` = the lookup failed, so the page says "unknown".
   */
  business?: RowBusiness | null;
  /** Credits left (credit deduction slice 8a): only on rows with a business. */
  creditsLeft?: RowCreditsLeft;
}

/** The business line of a row: the business name, or why there is none. */
function businessLabel(user: User): { text: string; muted: boolean } {
  if (user.business === undefined) return { text: 'Business unknown', muted: true };
  if (user.business === null) return { text: 'No Business OS business', muted: true };
  return { text: user.business.companyName || 'Unnamed business', muted: !user.business.companyName };
}

/** FR-BU4: the list is every login, not only Business OS businesses. The header's purpose line. */
const PURPOSE = 'Every login on the platform. Logins with no business show "No Business OS business".';

/** The list route answers 100 rows at most on screen; the rest are counted (F-27 stays open). */
const LIST_ROW_CAP = 100;

const SEARCH_DEBOUNCE_MS = 300;

const MS_PER_HOUR = 3_600_000;

/**
 * The age line under a list timestamp (§5.11: relative time only as a
 * secondary hint under the UTC time; L-4a SA M-3). List cells only: always a
 * relative age, never a locale date. `formatDate` (below) stays as it was for
 * the row detail, which L-4b owns.
 */
function listAge(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';
  const hours = Math.floor((Date.now() - time) / MS_PER_HOUR);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "1 user" / "N users", or the capped sentence (§5.7 Count line). */
function countLine(shown: number): string {
  if (shown > LIST_ROW_CAP) {
    return `Showing the first ${LIST_ROW_CAP} of ${shown.toLocaleString('en-US')} users, newest first. Narrow the list with the search or the status.`;
  }
  return `${shown.toLocaleString('en-US')} ${shown === 1 ? 'user' : 'users'}`;
}

/** What the list route returns besides the rows (it answers at the top level, not under `data`). */
interface ListRead {
  rows: User[];
  stats: UserStats | null;
  search: SearchInfo | null;
}

interface UserLoginStats {
  total_logins: number;
  failed_logins: number;
  last_login_ip?: string;
  last_login_at?: string;
  unique_ips: number;
}

/**
 * `GET /api/admin/users/[id]/stats` (ADMIN_BOS_CLEANUP slice 5a). A section is
 * `null` when its read failed, or when the whole request failed (SA-5a-2); the
 * card then says it could not be read, never zeros.
 */
interface UserDetailedStats {
  tokens: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    total_calls: number;
    by_model: Array<{ model: string; input: number; output: number; cost: number; calls: number }>;
  } | null;
  plugins: {
    total: number;
    active: number;
    list: Array<{ plugin: string; connected_at: string; is_active: boolean }>;
  } | null;
}

/** Stored when the stats request itself failed, so both cards say so (SA-5a-2). */
const UNREADABLE_STATS: UserDetailedStats = { tokens: null, plugins: null };

interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  resource_name: string | null;
  changes: any;
  details: any;
  ip_address: string | null;
  severity: 'info' | 'warning' | 'critical';
  compliance_flags: string[];
  created_at: string;
}

interface SearchInfo {
  businessSearch: 'ok' | 'failed' | 'skipped';
  businessMatchesCapped: boolean;
  businessMatchLimit: number;
}

interface UserStats {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  // What the list route says about its own search (QA E-4): a capped
  // business-name search, or one that failed, is stated, never hidden.
  const [searchInfo, setSearchInfo] = useState<SearchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  /** A list read has succeeded since the last failure: tiles and table show (K-10, §5.10). */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When the list was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  /** The account whose read-only deletion preview is open (admin delete AD-1c). */
  const [deleteDialogUserId, setDeleteDialogUserId] = useState<string | null>(null);
  const [userLoginStats, setUserLoginStats] = useState<Record<string, UserLoginStats>>({});
  const [userAuditLogs, setUserAuditLogs] = useState<Record<string, AuditLogEntry[]>>({});
  const [userDetailedStats, setUserDetailedStats] = useState<Record<string, UserDetailedStats>>({});
  const [loadingUserDetails, setLoadingUserDetails] = useState<Record<string, boolean>>({});
  // Opens on active logins (user feedback on slice 2 check M-2, 2026-09-26).
  // The list route already accepts status=active; its own default stays 'all'.
  // L-4a: the status lives in the URL (`?status=`, default omitted, §5.6); the
  // search text stays page state and never reaches the URL (D-6 (a)).
  const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(USERS_FILTER_SPEC);
  const filter: StatusFilter = toStatusFilter(filters.status);
  const [searchTerm, setSearchTerm] = useState('');
  const [auditFilters, setAuditFilters] = useState<Record<string, 'all' | 'login' | 'security' | 'settings'>>({});

  const searchId = useId();
  const statusId = useId();
  /** Always mounted, so focus has a connected place to land (§5.12 A-3). */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Newest read wins (§5.10; SA M-5): only the read holding the latest number may set read state. */
  const readSeq = useRef(0);
  /** The search text of the last read STARTED, whoever started it (SA M-1, D-16). */
  const lastSearched = useRef<string | null>(null);
  /** Focus was inside the content area when the newest read started (SA Q-14, S-5). */
  const focusWasInside = useRef(false);
  /** Bumped when the newest read settles; the focus fallback runs after that commit (S-5). */
  const [settledReads, setSettledReads] = useState(0);
  /**
   * What the next read asks for. A ref, so `fetchUsers` keeps one identity and
   * its callers (the detail's `onRemoved` / `onDeleted`, Refresh, Try again)
   * always read the current status and search.
   */
  const query = useRef<{ status: StatusFilter; search: string }>({ status: filter, search: searchTerm });

  const fetchUsers = useCallback(async () => {
    const { status, search } = query.current;
    readSeq.current += 1;
    const seq = readSeq.current;
    const isNewest = () => seq === readSeq.current;
    lastSearched.current = search;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    focusWasInside.current = Boolean(active && contentRef.current?.contains(active));

    setLoading(true);
    setError(null);

    const fail = (message: string) => {
      setError(message);
      setUsers([]);
      setStats(null);
      setSearchInfo(null);
      setHasLoaded(false);
    };

    try {
      const queryParams = new URLSearchParams({
        status,  // Backend expects 'status' not 'filter'
        search
      });

      // Facts only: the search text may be a person's name or email (QA E-3).
      logger.debug({ status, hasSearch: search.trim() !== '', searchLength: search.length }, 'Fetching admin users');

      // Only the fetch sits inside this try: a rejection here is a network
      // failure; nothing else may be labelled as one.
      let response: Response;
      try {
        response = await fetch(`/api/admin/users?${queryParams}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          cache: 'no-store'
        });
      } catch (err) {
        logger.error({ err }, 'Failed to fetch admin users');
        if (isNewest()) fail(ADMIN_NETWORK_ERROR);
        return;
      }

      logger.debug({ status: response.status, ok: response.ok }, 'Admin users response');

      // §5.10 (C-4): the route's own error, else the fixed copy; never a parser
      // message or statusText. 401 / 403 read "session ended" (SA Q-13).
      const result = await readAdminResponse<ListRead>(response, {
        what: USERS_WHAT,
        sessionEndedCopy: true,
        pick: (body) => ({
          rows: Array.isArray(body.data) ? (body.data as User[]) : [],
          stats: (body.stats as UserStats | undefined) ?? null,
          search: (body.search as SearchInfo | undefined) ?? null,
        }),
      });
      // Counts only: the raw body holds every login's name and email (SA C-15 (b)).
      logger.debug(
        { success: result.ok, rows: result.ok ? result.data.rows.length : 0 },
        'Admin users response parsed'
      );

      // An older read that lands after a newer one started changes nothing (SA M-5).
      if (!isNewest()) return;

      if (!result.ok) {
        logger.error({ status: result.status }, 'Failed to fetch admin users');
        fail(result.message);
        return;
      }

      setUsers(result.data.rows);
      setStats(result.data.stats);
      setSearchInfo(result.data.search);
      setHasLoaded(true);
      setReadAt(new Date().toISOString());

      logger.debug(
        { totalUsers: result.data.rows.length },
        'Processed admin users data'
      );
    } finally {
      if (isNewest()) {
        setLoading(false);
        setSettledReads((n) => n + 1);
      }
    }
  }, []);

  // Declared before the reads below, so they see this render's status and search.
  useEffect(() => {
    query.current = { status: filter, search: searchTerm };
  }, [filter, searchTerm]);

  useEffect(() => {
    void fetchUsers();
  }, [filter, fetchUsers]);

  // D-16 / SA M-1: after the pause, read when, and only when, the text differs
  // from the text of the last read started. That covers an emptied box (the
  // list shows everyone again), skips the mount (the first read sent ''), and
  // skips a second read when the status changed inside the pause.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== lastSearched.current) {
        void fetchUsers();
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, fetchUsers]);

  // §5.12 A-3 (SA Q-14, S-5): when the newest read settles, focus that was
  // inside the content area and fell to <body> with the old content (Try again,
  // the cleanup panel's Done) goes to the content area. A read started from the
  // bar never moves focus. After commit, because the old content leaves only then.
  useEffect(() => {
    if (!focusWasInside.current) return;
    focusWasInside.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) contentRef.current?.focus();
  }, [settledReads]);

  /** §5.5 part 5: back to the defaults (Active, empty search). Exactly one read follows (SA M-1). */
  const clearAll = () => {
    clear();
    setSearchTerm('');
  };

  /** A status tile: its real link (S-3: the path plus `hrefFor`) and the same patch in place. */
  const statusTile = (status: StatusFilter) => ({
    href: `/admin/users${hrefFor({ status })}`,
    apply: () => setFilters({ status }),
  });

  const getFilteredUsers = () => {
    let filtered = users;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.email?.toLowerCase().includes(term) ||
        user.full_name?.toLowerCase().includes(term) ||
        user.company?.toLowerCase().includes(term) ||
        // The route also matches Business OS business names (slice 2); without
        // this, a row found by its business name was hidden again here.
        user.business?.companyName?.toLowerCase().includes(term) ||
        user.id.toLowerCase().includes(term)
      );
    }

    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const isActiveUser = (user: User) => {
    if (!user.last_sign_in_at) return false;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(user.last_sign_in_at) > thirtyDaysAgo;
  };

  const handleViewUserDetails = async (user: User) => {
    // Toggle expansion
    if (expandedUserId === user.id) {
      setExpandedUserId(null);
      return;
    }

    setExpandedUserId(user.id);

    // Don't fetch if already loaded. A stats section that could not be read is
    // not "loaded": it is fetched again on the next open, not cached (O-3).
    if (
      userLoginStats[user.id] &&
      userAuditLogs[user.id] &&
      userDetailedStats[user.id]?.tokens &&
      userDetailedStats[user.id]?.plugins
    ) {
      return;
    }

    setLoadingUserDetails(prev => ({ ...prev, [user.id]: true }));

    try {
      // Fetch all data in parallel
      const [statsResponse, auditResponse, detailedStatsResponse] = await Promise.all([
        fetch(`/api/admin/users/${user.id}/login-stats`),
        fetch(`/api/admin/users/${user.id}/audit-logs`),
        fetch(`/api/admin/users/${user.id}/stats`)
      ]);

      // Process login statistics
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setUserLoginStats(prev => ({ ...prev, [user.id]: statsData.data }));
      }

      // Process audit logs
      if (auditResponse.ok) {
        const auditData = await auditResponse.json();
        setUserAuditLogs(prev => ({ ...prev, [user.id]: auditData.data || [] }));
      }

      // Process detailed stats (connected plugins and AI spend)
      if (detailedStatsResponse.ok) {
        const detailedData = await detailedStatsResponse.json();
        // Facts only: the payload holds plugin keys and AI spend for one
        // person (QA E-3). Never the payload itself.
        logger.debug(
          {
            success: detailedData?.success === true,
            tokens: detailedData?.data?.tokens ? 'ok' : 'unavailable',
            plugins: detailedData?.data?.plugins?.total ?? null,
          },
          'User detailed stats response'
        );
        // A failed request stores both sections as unreadable, so the cards
        // say so instead of vanishing (SA-5a-2).
        const detailed: UserDetailedStats =
          detailedData?.success === true && detailedData.data
            ? { tokens: detailedData.data.tokens ?? null, plugins: detailedData.data.plugins ?? null }
            : UNREADABLE_STATS;
        setUserDetailedStats(prev => ({ ...prev, [user.id]: detailed }));
      } else {
        logger.error({ status: detailedStatsResponse.status }, 'Failed to fetch detailed stats');
        setUserDetailedStats(prev => ({ ...prev, [user.id]: UNREADABLE_STATS }));
      }

      // Initialize audit filter for this user
      if (!auditFilters[user.id]) {
        setAuditFilters(prev => ({ ...prev, [user.id]: 'all' }));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch user details');
      // A rejected fetch (network error, blocked request, non-JSON body) must
      // not make the cards vanish silently either: mark them unreadable unless
      // this row already holds a result (SA 5a code review, QA E-1).
      setUserDetailedStats(prev => (prev[user.id] ? prev : { ...prev, [user.id]: UNREADABLE_STATS }));
    } finally {
      setLoadingUserDetails(prev => ({ ...prev, [user.id]: false }));
    }
  };

  const getFilteredAuditLogs = (userId: string) => {
    const logs = userAuditLogs[userId] || [];
    const filter = auditFilters[userId] || 'all';

    if (filter === 'all') return logs;

    if (filter === 'login') {
      return logs.filter(log =>
        log.action.includes('LOGIN') || log.action.includes('LOGOUT')
      );
    }

    if (filter === 'security') {
      return logs.filter(log =>
        log.action.includes('PASSWORD') || log.action.includes('SECURITY') || log.action.includes('2FA')
      );
    }

    if (filter === 'settings') {
      return logs.filter(log =>
        log.action.includes('SETTINGS') || log.action.includes('PROFILE')
      );
    }

    return logs;
  };

  const formatActionName = (action: string) => {
    return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'warning': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      default: return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    }
  };

  /*
   * `handleTerminateUser` / `openTerminateModal` removed, together with the
   * terminate button and its confirmation modal.
   *
   * They called `POST /api/admin/users/[id]/terminate`, which hard-deleted an
   * arbitrary `auth.users` row from the URL parameter with no authentication of
   * any kind — no `getUser()`, no admin check, and `middleware.ts` skips all of
   * `/api`. That route is now a 410 tombstone, so the affordance is removed
   * rather than repointed: a delete button that fails with a toast is the same
   * broken-delete experience the tombstone exists to end.
   *
   * The admin surface itself is guarded on the server: `app/admin/layout.tsx`
   * awaits `requireAdminPage()` before any admin page renders, and every
   * `/api/admin` handler calls `requireAdmin`. Both are enforced by the admin
   * authz CI guard (docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md).
   *
   * Its replacement is the gated flow in the expanded row's danger area
   * (admin delete AD-1c): a "Delete…" button opening a READ-ONLY preview from
   * `POST /api/admin/users/[id]/deletion/preview` (requireAdmin, target from
   * the path only). The confirm control there is always disabled until the
   * commit slice (AD-2) exists.
   */


  const filteredUsers = getFilteredUsers();

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Businesses" purpose={PURPOSE} />

      {!error && (
        <BusinessesKpis stats={stats} status={filter} firstLoad={!hasLoaded} statusTile={statusTile} />
      )}

      <AdminFilterBar
        what={USERS_WHAT}
        busy={loading}
        onRefresh={() => void fetchUsers()}
        readAt={readAt}
        onClear={clearAll}
        canClear={!isDefault || searchTerm !== ''}
      >
        <div className="w-full sm:w-72">
          <label htmlFor={searchId} className={ADMIN_FIELD_LABEL}>
            Search
          </label>
          <input
            id={searchId}
            type="text"
            placeholder="Search users by name, email, company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${ADMIN_FIELD_CONTROL} w-full`}
          />
        </div>
        <div>
          <label htmlFor={statusId} className={ADMIN_FIELD_LABEL}>
            Status
          </label>
          <select
            id={statusId}
            value={filter}
            onChange={(e) => setFilters({ status: toStatusFilter(e.target.value) })}
            className={ADMIN_FIELD_CONTROL}
          >
            <option value="all">All Users</option>
            <option value="active">Active (30 days)</option>
            <option value="inactive">Inactive (30+ days)</option>
          </select>
        </div>
      </AdminFilterBar>

      {/* Always mounted (§5.10, F-19): a read never unmounts the header, the
          bar or the search box, and an open row stays open across a read
          (L-4a §2.5, SA Q-2). */}
      <div
        ref={contentRef}
        tabIndex={-1}
        aria-busy={loading}
        data-testid="users-content"
        className="space-y-4 focus:outline-none"
      >
        {error && <AdminError message={error} testId="users-error" onRetry={() => void fetchUsers()} />}
        {!error && !hasLoaded && <AdminLoading what={USERS_WHAT} />}

        {!error && hasLoaded && (
          <>
            {searchInfo?.businessMatchesCapped && (
              <AdminNotice testId="business-search-capped">
                More than {searchInfo.businessMatchLimit} businesses match this search; only the first{' '}
                {searchInfo.businessMatchLimit} by name are included. Refine the search to see the rest.
              </AdminNotice>
            )}
            {searchInfo?.businessSearch === 'failed' && (
              <AdminNotice testId="business-search-failed">
                Business names could not be searched just now; these results match people only.
              </AdminNotice>
            )}

            <p data-testid="users-count-line" className={ADMIN_COUNT_LINE}>
              {countLine(filteredUsers.length)}
            </p>

            {/* Users Table. The table keeps its old indentation so the row
                detail below (L-4b) shows no diff at all. */}
            <div className={ADMIN_TABLE_WRAP}>
          <table className={ADMIN_TABLE}>
            <thead className={ADMIN_THEAD}>
              <tr>
                <th scope="col" className={ADMIN_TH}>Business / user</th>
                <th scope="col" className={ADMIN_TH}>Credits left</th>
                <th scope="col" className={ADMIN_TH}>Contact</th>
                {/* No status/role column (U-9, 2026-09-26): the Active badge sits
                    beside the name, and the Supabase sign-in role it would have
                    held is not an admin indicator (admins: admin_users only). */}
                <th scope="col" className={ADMIN_TH}>Login Activity</th>
                <th scope="col" className={ADMIN_TH}>Last Sign In</th>
                <th scope="col" className={ADMIN_TH}>Joined</th>
                <th scope="col" className={ADMIN_TH}>Actions</th>
              </tr>
            </thead>
            <tbody className={ADMIN_TBODY}>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center">
                    {searchTerm.trim() !== '' && filter !== 'all' ? (
                      <>
                        {/* U-4: never widen a search silently; offer it in one click. */}
                        <p data-testid="no-match-filtered" className="text-sm text-slate-200">
                          No match among {filter} users
                        </p>
                        <button
                          type="button"
                          data-testid="search-all-users"
                          onClick={() => setFilters({ status: 'all' })}
                          className={`mt-4 ${ADMIN_BUTTON}`}
                        >
                          Search all users
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-slate-200">No users found</p>
                        <p className="mt-1 text-xs text-slate-400">Try adjusting your search or filter criteria</p>
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                filteredUsers.slice(0, LIST_ROW_CAP).map((user) => {
                  const isExpanded = expandedUserId === user.id;
                  const stats = userLoginStats[user.id];
                  const detailedStats = userDetailedStats[user.id];
                  const isLoading = loadingUserDetails[user.id];
                  const toggleName = rowToggleName(user.full_name, user.email);

                  return (
                    <React.Fragment key={user.id}>
                      {/* Main User Row */}
                      <tr
                        className={`hover:bg-slate-700/30 transition-colors cursor-pointer ${
                          isExpanded ? 'bg-slate-700/20' : ''
                        }`}
                        onClick={() => handleViewUserDetails(user)}
                      >
                        <td className={ADMIN_TD}>
                          <div className="flex items-start gap-3">
                            {isExpanded ? (
                              <ChevronDown className="mt-0.5 w-4 h-4 text-blue-400 flex-shrink-0" aria-hidden="true" />
                            ) : (
                              <ChevronUp className="mt-0.5 w-4 h-4 text-slate-400 flex-shrink-0 rotate-180" aria-hidden="true" />
                            )}
                            <div>
                              {/* Business name and user name together (user decision, 2026-09-25). */}
                              <p
                                data-testid="row-business"
                                className={`text-sm font-semibold ${businessLabel(user).muted ? 'text-slate-400 italic' : 'text-white'}`}
                              >
                                {businessLabel(user).text}
                              </p>
                              <UserNameLine
                                fullName={user.full_name}
                                email={user.email}
                                emailConfirmed={user.email_confirmed}
                                isActive={isActiveUser(user)}
                              />
                              <p data-testid="row-short-id" className={`mt-1 ${ADMIN_TD_ID}`} title={user.id}>
                                {formatShortId(user.id)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className={`${ADMIN_TD} whitespace-nowrap`}>
                          <CreditsLeftCell business={user.business} creditsLeft={user.creditsLeft} />
                        </td>
                        <td className={ADMIN_TD}>
                          <div className="space-y-1">
                            {user.company && (
                              <p className="text-xs text-slate-400 flex items-center gap-1">
                                <Building className="w-3 h-3" aria-hidden="true" />
                                {user.company}
                              </p>
                            )}
                            {user.phone && (
                              <p className="text-xs text-slate-400 flex items-center gap-1">
                                <Phone className="w-3 h-3" aria-hidden="true" />
                                {user.phone}
                              </p>
                            )}
                            {!user.company && !user.phone && (
                              <p className="text-xs text-slate-400">No contact info</p>
                            )}
                          </div>
                        </td>
                        <td className={ADMIN_TD}>
                          {stats ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-xs">
                                <CheckCircle className="w-3 h-3 text-green-400" aria-hidden="true" />
                                <span className="text-green-300 font-medium">{stats.total_logins}</span>
                                <span className="text-slate-400">logins</span>
                              </div>
                              {stats.failed_logins > 0 && (
                                <div className="flex items-center gap-2 text-xs">
                                  <XCircle className="w-3 h-3 text-red-400" aria-hidden="true" />
                                  <span className="text-red-300 font-medium">{stats.failed_logins}</span>
                                  <span className="text-slate-400">failed</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-400">Click to load</span>
                            </div>
                          )}
                        </td>
                        {/* §5.11 (SA Q-9, M-3): the UTC time, with the age as a second line. */}
                        <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="row-last-sign-in">
                          {user.last_sign_in_at ? (
                            <>
                              <span className="block">{formatUtc(user.last_sign_in_at)}</span>
                              <span className="block text-xs text-slate-400">{listAge(user.last_sign_in_at)}</span>
                            </>
                          ) : (
                            'Never'
                          )}
                        </td>
                        <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="row-joined">
                          <span className="block">{formatUtc(user.created_at)}</span>
                          <span className="block text-xs text-slate-400">{listAge(user.created_at)}</span>
                        </td>
                        <td className={ADMIN_TD} onClick={(e) => e.stopPropagation()}>
                          {/* A-2: a named toggle that says whether the detail is open. */}
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Hide' : 'Show'} details for ${toggleName}`}
                            data-testid="row-toggle"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewUserDetails(user);
                            }}
                            className="text-blue-400 hover:text-blue-300 p-1 rounded hover:bg-blue-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-900/50">
                          <td colSpan={7} className="px-6 py-6">
                            {isLoading ? (
                              <div className="text-center py-12">
                                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                                <p className="text-slate-400 text-sm">Loading user details...</p>
                              </div>
                            ) : (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="space-y-6"
                              >
                                {/* Business OS first (slice 2b): business, plan, AI spend, AI failures. */}
                                <BusinessOsPanel accountId={user.id} userName={user.full_name} />

                                {/* User Information Grid */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                  <div className="bg-gradient-to-br from-slate-700/40 to-slate-700/20 p-5 rounded-xl border border-white/5">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                                      <UsersIcon className="w-4 h-4" />
                                      User Information
                                    </h3>
                                    <div className="space-y-3 text-sm">
                                      <div>
                                        <span className="text-slate-400 text-xs">Full Name:</span>
                                        <p className="text-white font-medium">{user.full_name || 'N/A'}</p>
                                      </div>
                                      {user.company && (
                                        <div>
                                          <span className="text-slate-400 text-xs">Company:</span>
                                          <p className="text-white font-medium flex items-center gap-1">
                                            <Building className="w-3 h-3" />
                                            {user.company}
                                          </p>
                                        </div>
                                      )}
                                      {user.phone && (
                                        <div>
                                          <span className="text-slate-400 text-xs">Phone:</span>
                                          <p className="text-white font-medium flex items-center gap-1">
                                            <Phone className="w-3 h-3" />
                                            {user.phone}
                                          </p>
                                        </div>
                                      )}
                                      <div>
                                        <span className="text-slate-400 text-xs">User ID:</span>
                                        <p className="text-white font-mono text-xs break-all">{user.id}</p>
                                      </div>
                                      {/* No role row (SA-5a-1, as U-9): the Supabase sign-in role is not an admin indicator (admins: admin_users only). */}
                                    </div>
                                  </div>

                                  <div className="bg-gradient-to-br from-slate-700/40 to-slate-700/20 p-5 rounded-xl border border-white/5">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                                      <Clock className="w-4 h-4" />
                                      Account Timeline
                                    </h3>
                                    <div className="space-y-3 text-sm">
                                      <div>
                                        <span className="text-slate-400 text-xs">Created:</span>
                                        <p className="text-white font-medium">{new Date(user.created_at).toLocaleDateString()}</p>
                                        <p className="text-slate-500 text-xs">{formatDate(user.created_at)}</p>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-xs">Last Sign In:</span>
                                        <p className="text-white font-medium">
                                          {user.last_sign_in_at
                                            ? new Date(user.last_sign_in_at).toLocaleDateString()
                                            : 'Never'
                                          }
                                        </p>
                                        {user.last_sign_in_at && (
                                          <p className="text-slate-500 text-xs">{formatDate(user.last_sign_in_at)}</p>
                                        )}
                                      </div>
                                      {user.updated_at && (
                                        <div>
                                          <span className="text-slate-400 text-xs">Last Updated:</span>
                                          <p className="text-white font-medium">{new Date(user.updated_at).toLocaleDateString()}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className="bg-gradient-to-br from-slate-700/40 to-slate-700/20 p-5 rounded-xl border border-white/5">
                                    <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                                      <Shield className="w-4 h-4" />
                                      Security
                                    </h3>
                                    <div className="space-y-3 text-sm">
                                      <div>
                                        <span className="text-slate-400 text-xs">Email Verified:</span>
                                        <p className="text-white font-medium">
                                          {user.email_confirmed ? '✓ Yes' : '✗ No'}
                                        </p>
                                      </div>
                                      <div>
                                        <span className="text-slate-400 text-xs">Auth Providers:</span>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                          {user.providers && user.providers.length > 0 ? (
                                            user.providers.map(provider => (
                                              <span key={provider} className="px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-300 rounded">
                                                {provider}
                                              </span>
                                            ))
                                          ) : (
                                            <span className="text-slate-500">None</span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Login Statistics */}
                                {stats && (
                                  <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-6 rounded-xl border border-blue-500/20">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                      <LogIn className="w-5 h-5 text-blue-400" />
                                      Login Activity
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                      <div className="bg-slate-800/50 p-4 rounded-lg">
                                        <div className="flex items-center gap-2 mb-1">
                                          <CheckCircle className="w-4 h-4 text-green-400" />
                                          <span className="text-xs text-slate-400">Total Logins</span>
                                        </div>
                                        <p className="text-2xl font-bold text-white">{stats.total_logins || 0}</p>
                                      </div>
                                      <div className="bg-slate-800/50 p-4 rounded-lg">
                                        <div className="flex items-center gap-2 mb-1">
                                          <XCircle className="w-4 h-4 text-red-400" />
                                          <span className="text-xs text-slate-400">Failed Logins</span>
                                        </div>
                                        <p className="text-2xl font-bold text-white">{stats.failed_logins || 0}</p>
                                      </div>
                                      <div className="bg-slate-800/50 p-4 rounded-lg">
                                        <div className="flex items-center gap-2 mb-1">
                                          <MapPin className="w-4 h-4 text-blue-400" />
                                          <span className="text-xs text-slate-400">Unique IPs</span>
                                        </div>
                                        <p className="text-2xl font-bold text-white">{stats.unique_ips || 0}</p>
                                      </div>
                                      <div className="bg-slate-800/50 p-4 rounded-lg">
                                        <div className="flex items-center gap-2 mb-1">
                                          <MapPin className="w-4 h-4 text-purple-400" />
                                          <span className="text-xs text-slate-400">Last Login IP</span>
                                        </div>
                                        <p className="text-sm font-mono text-white">{stats.last_login_ip || 'N/A'}</p>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* The AgentsPilot fold (agents, agent executions) and the
                                    Subscription card (AP Pilot-Credit table, never rendered) were
                                    removed in ADMIN_BOS_CLEANUP slice 5a: their reads named
                                    columns that do not exist. */}

                                {/* Plugin Connections - Full Width Row */}
                                {detailedStats && (
                                  <div data-testid="plugins-card" className="bg-gradient-to-br from-orange-500/10 to-amber-500/10 p-6 rounded-xl border border-orange-500/20">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                      <Settings className="w-5 h-5 text-orange-400" />
                                      Connected Plugins
                                      {detailedStats.plugins && (
                                        <span className="ml-auto text-sm font-normal text-slate-400">
                                          {detailedStats.plugins.active}/{detailedStats.plugins.total} active
                                        </span>
                                      )}
                                    </h3>
                                    {detailedStats.plugins === null ? (
                                      <p className="text-sm text-red-300">The connected plugins could not be read.</p>
                                    ) : detailedStats.plugins.list.length > 0 ? (
                                      <div className="flex flex-wrap gap-2">
                                        {detailedStats.plugins.list.map((plugin, idx) => (
                                          <span
                                            key={idx}
                                            className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${
                                              plugin.is_active
                                                ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                                                : 'bg-slate-700/50 text-slate-400 border border-slate-600'
                                            }`}
                                          >
                                            <span className={`w-2 h-2 rounded-full ${plugin.is_active ? 'bg-green-400' : 'bg-slate-500'}`} />
                                            {plugin.plugin.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-slate-400 text-sm text-center py-4">No plugins connected</p>
                                    )}
                                  </div>
                                )}

                                {/* AI spend, all products (token_usage, 30 days) */}
                                {detailedStats && (
                                  <div data-testid="ai-spend-card" className="bg-gradient-to-br from-cyan-500/10 to-teal-500/10 p-6 rounded-xl border border-cyan-500/20">
                                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                      <TrendingUp className="w-5 h-5 text-cyan-400" />
                                      AI spend, all products (30 days; may be incomplete above 1,000 calls)
                                    </h3>

                                    {detailedStats.tokens === null ? (
                                      <p className="text-sm text-red-300">The AI usage records could not be read.</p>
                                    ) : (
                                      <>
                                        {/* Summary Stats */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                          <div className="bg-slate-800/50 p-4 rounded-lg">
                                            <p className="text-xs text-slate-400">Input Tokens</p>
                                            <p className="text-xl font-bold text-white">{formatNumber(detailedStats.tokens.total_input_tokens)}</p>
                                          </div>
                                          <div className="bg-slate-800/50 p-4 rounded-lg">
                                            <p className="text-xs text-slate-400">Output Tokens</p>
                                            <p className="text-xl font-bold text-white">{formatNumber(detailedStats.tokens.total_output_tokens)}</p>
                                          </div>
                                          <div className="bg-slate-800/50 p-4 rounded-lg">
                                            <p className="text-xs text-slate-400">LLM Calls</p>
                                            <p className="text-xl font-bold text-white">{formatNumber(detailedStats.tokens.total_calls)}</p>
                                          </div>
                                          <div className="bg-slate-800/50 p-4 rounded-lg">
                                            <p className="text-xs text-slate-400">Total Cost</p>
                                            <p className="text-xl font-bold text-cyan-300">{formatCost(detailedStats.tokens.total_cost_usd)}</p>
                                          </div>
                                        </div>

                                        {/* Cost by Model */}
                                        {detailedStats.tokens.by_model.length > 0 && (
                                          <div>
                                            <h4 className="text-sm font-semibold text-slate-300 mb-3">Cost by Model</h4>
                                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                              {detailedStats.tokens.by_model.map((model, idx) => (
                                                <div key={idx} className="bg-slate-800/50 p-3 rounded-lg flex items-center justify-between">
                                                  <div className="flex items-center gap-3">
                                                    <span className="text-sm font-mono text-white">{model.model}</span>
                                                    <span className="text-xs text-slate-500">{formatNumber(model.calls)} calls</span>
                                                  </div>
                                                  <div className="flex items-center gap-4 text-sm">
                                                    <span className="text-slate-400">
                                                      <span className="text-blue-300">{formatNumber(model.input)}</span> in / <span className="text-green-300">{formatNumber(model.output)}</span> out
                                                    </span>
                                                    <span className="text-cyan-300 font-semibold">{formatCost(model.cost)}</span>
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* Audit Trail */}
                                <div className="bg-slate-700/30 p-6 rounded-xl border border-white/5">
                                  <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                      <FileText className="w-5 h-5 text-indigo-400" />
                                      Audit Trail
                                    </h3>
                                    <select
                                      value={auditFilters[user.id] || 'all'}
                                      onChange={(e) => setAuditFilters(prev => ({ ...prev, [user.id]: e.target.value as any }))}
                                      onClick={(e) => e.stopPropagation()}
                                      className="px-3 py-1 bg-slate-600/50 border border-slate-500 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                      <option value="all">All Events</option>
                                      <option value="login">Login Events</option>
                                      <option value="security">Security Events</option>
                                      <option value="settings">Settings Changes</option>
                                    </select>
                                  </div>

                                  {/* Older entries may be archived (FR-12, archiving slice 3). */}
                                  <ArchivedBeforeNotice className="mb-4" />

                                  {getFilteredAuditLogs(user.id).length === 0 ? (
                                    <div className="text-center py-12">
                                      <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                                      <p className="text-slate-400">No audit logs found</p>
                                      <p className="text-slate-500 text-sm">User activity will appear here</p>
                                    </div>
                                  ) : (
                                    <div className="space-y-2 max-h-96 overflow-y-auto">
                                      {getFilteredAuditLogs(user.id).slice(0, 50).map((log) => (
                                        <div
                                          key={log.id}
                                          className="bg-slate-800/50 p-4 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-all w-full"
                                        >
                                          <div className="grid grid-cols-12 gap-6 items-start w-full">
                                            {/* Action & Severity - 2 cols */}
                                            <div className="col-span-2">
                                              <p className="text-xs text-slate-500 mb-1">Action</p>
                                              <h4 className="font-semibold text-white text-sm truncate">{formatActionName(log.action)}</h4>
                                              <span className={`inline-block mt-2 px-2 py-0.5 text-xs font-semibold rounded-full border ${getSeverityColor(log.severity)}`}>
                                                {log.severity.toUpperCase()}
                                              </span>
                                            </div>

                                            {/* Resource - 3 cols */}
                                            <div className="col-span-3">
                                              <p className="text-xs text-slate-500 mb-1">Resource</p>
                                              {log.resource_name ? (
                                                <p className="text-sm text-white truncate">{log.resource_name}</p>
                                              ) : (
                                                <span className="text-sm text-slate-600">—</span>
                                              )}
                                            </div>

                                            {/* Timestamp - 2 cols */}
                                            <div className="col-span-2">
                                              <p className="text-xs text-slate-500 mb-1">Time</p>
                                              <p className="text-sm text-white flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-slate-400" />
                                                {new Date(log.created_at).toLocaleDateString()}
                                              </p>
                                              <p className="text-xs text-slate-400 mt-0.5">{new Date(log.created_at).toLocaleTimeString()}</p>
                                            </div>

                                            {/* IP Address - 2 cols */}
                                            <div className="col-span-2">
                                              <p className="text-xs text-slate-500 mb-1">IP Address</p>
                                              {log.ip_address ? (
                                                <p className="text-sm text-white font-mono flex items-center gap-1">
                                                  <MapPin className="w-3 h-3 text-slate-400" />
                                                  {log.ip_address}
                                                </p>
                                              ) : (
                                                <span className="text-sm text-slate-600">—</span>
                                              )}
                                            </div>

                                            {/* Compliance Flags - 3 cols */}
                                            <div className="col-span-3">
                                              <p className="text-xs text-slate-500 mb-1">Compliance Flags</p>
                                              {log.compliance_flags && log.compliance_flags.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                  {log.compliance_flags.map((flag, i) => (
                                                    <span key={i} className="px-2 py-0.5 text-xs bg-indigo-500/20 text-indigo-300 rounded">
                                                      {flag}
                                                    </span>
                                                  ))}
                                                </div>
                                              ) : (
                                                <span className="text-sm text-slate-600">—</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Danger area (admin delete AD-1c, FR-A1): expanded row only, never the collapsed row. */}
                                <div
                                  data-testid="danger-area"
                                  className="p-6 rounded-xl border border-rose-500/40 bg-rose-500/5"
                                >
                                  <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-rose-400" />
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
                                          setDeleteDialogUserId(user.id);
                                        }}
                                        className="px-4 py-2 text-sm font-medium rounded-lg border border-rose-500/50 text-rose-200 hover:bg-rose-500/20 transition-colors"
                                      >
                                        Delete…
                                      </button>
                                      <DeleteBusinessDialog
                                        open={deleteDialogUserId === user.id}
                                        onOpenChange={(next) => setDeleteDialogUserId(next ? user.id : null)}
                                        accountId={user.id}
                                        onDeleted={() => {
                                          // FR-A9: after a deletion the row reads "No Business OS business".
                                          void fetchUsers();
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
                                        void fetchUsers();
                                      }}
                                    />
                                  ) : (
                                    <p className="text-sm text-slate-500">This login has no email, so it cannot be removed here.</p>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
