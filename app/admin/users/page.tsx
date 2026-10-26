'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Phone, Building, XCircle } from 'lucide-react';
import { clientLogger } from '@/lib/logger/client';
import { AdminDrawer } from '@/app/admin/components/layout/AdminDrawer';
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
  ADMIN_TD_OPEN,
  ADMIN_TH,
  ADMIN_TH_OPEN,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { rowOpenTarget } from '@/app/admin/components/layout/rowOpenClick';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';
import { useAdminFilters } from '@/app/admin/components/layout/useAdminFilters';
import { BusinessDetail } from './components/BusinessDetail';
import { BusinessesKpis } from './components/BusinessesKpis';
import { UserNameLine } from './components/UserNameLine';
import { CreditsLeftCell } from './components/CreditsLeftCell';
import { rowToggleName, toStatusFilter, type StatusFilter } from './userName';
import { USERS_FILTER_SPEC, USERS_WHAT } from './usersFilters';
import { ageLine } from './usersFormat';
import { useBusinessDetails } from './useBusinessDetails';
import type { AdminUserRow } from './types';

// A client file logs through the client logger (Admin Layout Standard F-56; follow-ups LF-F3, SA-F3).
const logger = clientLogger.child({ module: 'AdminUsersPage' });

/** One row of the list route (the type moved to `types.ts` in L-4b). */
type User = AdminUserRow;

// D-17 (user, 2026-10-11): a click anywhere on a row also opens it. The rules
// (never a control inside the row, never while selecting text, always through
// the row's Open button) are the shared `rowOpenTarget` since Money MK-10
// (SA-Q-MK10-1), so this page and Finance cannot drift.

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
  /**
   * LF-F2 (LF4B-F1): the read after a Give or Take back failed, so the rows on
   * screen are the last good read. Cleared by the next read that succeeds, and
   * by an ordinary failed read (which shows the error instead).
   */
  const [listStale, setListStale] = useState(false);
  /** When the list was last read successfully: the bar's "Read at HH:mm UTC". */
  const [readAt, setReadAt] = useState<string | null>(null);
  // The drawer (L-4b, the L-1d way after its QA B-1 fix). `isOpen` drives the
  // panel and `openId` names its account. Closing clears only `isOpen`, so the
  // body stays during Radix's slide-out; the next open replaces `openId`.
  const [isOpen, setIsOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** The row's Open button: focus goes back to it on close (D-6), whichever path opened it (D-17). */
  const opener = useRef<HTMLButtonElement | null>(null);
  // The three detail reads: a per-account cache that outlives the drawer (the
  // Login Activity column and the reopen rule read it; R-6, SA Q-3).
  const details = useBusinessDetails();
  // Opens on active logins (user feedback on slice 2 check M-2, 2026-09-26).
  // The list route already accepts status=active; its own default stays 'all'.
  // L-4a: the status lives in the URL (`?status=`, default omitted, §5.6); the
  // search text stays page state and never reaches the URL (D-6 (a)).
  const { filters, setFilters, clear, isDefault, hrefFor } = useAdminFilters(USERS_FILTER_SPEC);
  const filter: StatusFilter = toStatusFilter(filters.status);
  const [searchTerm, setSearchTerm] = useState('');
  /** SA-Q33: the inbound `account` named a business that is not on screen. Cleared by the next status or search change. */
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  useEffect(() => {
    setDeepLinkMissing(false);
  }, [filter, searchTerm]);

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

  const fetchUsers = useCallback(async (options: { keepRowsOnFail?: boolean } = {}) => {
    const { status, search } = query.current;
    readSeq.current += 1;
    const seq = readSeq.current;
    const isNewest = () => seq === readSeq.current;
    lastSearched.current = search;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    focusWasInside.current = Boolean(active && contentRef.current?.contains(active));

    setLoading(true);
    setError(null);

    // Both callers check `isNewest()` first, so an older read never lands here.
    const fail = (message: string) => {
      if (options.keepRowsOnFail) {
        // LF-F2 (LF4B-F1): the read after a Give or Take back. Keep the rows, so
        // the open drawer and its success notice stay and the admin is not led
        // to give again. Only the state reset is skipped: the caller has logged
        // the error, and `loading` settles in `finally` as for any read. A 401 /
        // 403 "session ended" answer is not shown here, on purpose: the money
        // action just succeeded, and the next Refresh or filter read shows it.
        setListStale(true);
        return;
      }
      setError(message);
      setUsers([]);
      setStats(null);
      setSearchInfo(null);
      setHasLoaded(false);
      setListStale(false);
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
      setListStale(false);

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

  /** BD-14 after a Give or Take back: one read that keeps the rows if it fails (LF-F2, LF4B-F1). */
  const refreshAfterCredits = useCallback(() => fetchUsers({ keepRowsOnFail: true }), [fetchUsers]);

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

  const isActiveUser = (user: User) => {
    if (!user.last_sign_in_at) return false;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(user.last_sign_in_at) > thirtyDaysAgo;
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
   * Its replacement is the gated flow in the drawer's danger area
   * (admin delete AD-1c): a "Delete…" button opening a READ-ONLY preview from
   * `POST /api/admin/users/[id]/deletion/preview` (requireAdmin, target from
   * the path only). The confirm control there is always disabled until the
   * commit slice (AD-2) exists.
   */


  const filteredUsers = getFilteredUsers();
  /** The rows on screen: a drawer never shows an account whose Open button is not on the page. */
  const shownUsers = filteredUsers.slice(0, LIST_ROW_CAP);

  /** The account the drawer shows; null once that row is no longer on screen. */
  const selected = openId === null ? null : shownUsers.find((user) => user.id === openId) ?? null;

  /** The one way a row opens, from its Open button or a row click (D-17): same opener, same reads. */
  const openRow = (user: User, button: HTMLButtonElement) => {
    opener.current = button;
    setOpenId(user.id);
    setIsOpen(true);
    void details.loadDetails(user.id);
  };

  // Money M-1 (SA-Q33, E-38, SA-WR-36): consume the inbound `account` key ONCE,
  // after the first list read that succeeded. A failed read consumes nothing.
  // The hook's mount write has already removed the key from the address bar;
  // the value stays in `filters` until this clears it. The row is looked up in
  // the rows on screen, and the CSS selector is built from that row's id, never
  // from the URL text. Opening goes through `openRow`, so focus returns to the
  // row's Open button on close (D-6).
  const pendingAccount = filters.account;
  const consumeDeepLink = useRef<() => void>(() => undefined);
  consumeDeepLink.current = () => {
    const wanted = pendingAccount.toLowerCase();
    const row = shownUsers.find((user) => user.id.toLowerCase() === wanted) ?? null;
    const button = row
      ? contentRef.current?.querySelector<HTMLButtonElement>(`tr[data-account-id="${row.id}"] [data-testid="row-open"]`) ?? null
      : null;
    if (row && button) openRow(row, button);
    else setDeepLinkMissing(true);
    setFilters({ account: '' });
  };
  useEffect(() => {
    if (!pendingAccount || loading || !hasLoaded) return;
    consumeDeepLink.current();
  }, [pendingAccount, loading, hasLoaded]);

  /**
   * D-17 (SA Q-1): a click anywhere on the row opens it, as a mouse extra. Not
   * on a control inside the row (rule 2), not while selecting text in it
   * (rule 3), and the opener is always that row's Open button (rule 4), never
   * the row, so focus returns to the button whichever path opened it.
   */
  const handleRowClick = (event: React.MouseEvent<HTMLTableRowElement>, user: User) => {
    const button = rowOpenTarget(event);
    if (!button) return;
    openRow(user, button);
  };

  // QA B-1 (L-1d): the open row left the screen (a read landed without it). The
  // drawer has already closed (its `open` prop went false, and Radix does not
  // call onOpenChange for a prop change), so end the open state too. Otherwise
  // a later read that brings the row back would reopen the drawer unasked.
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

  /** Q-8: the business name, else the person as the row names them; never the muted placeholder. */
  const drawerTitle = (user: User): string => {
    const label = businessLabel(user);
    return label.muted ? rowToggleName(user.full_name, user.email) : label.text;
  };

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
          bar or the search box, and an open drawer stays open across a read
          that keeps its row (L-4a §2.5, SA Q-2). */}
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

            {deepLinkMissing && (
              <AdminNotice testId="users-deeplink-missing">This business is not in the current list</AdminNotice>
            )}

            {/* LF-F2 (SA C5): amber, no live role; only the drawer line announces. */}
            {listStale && (
              <AdminNotice testId="users-list-stale">
                The business list could not be refreshed.
                {readAt ? ` These rows are from ${formatUtc(readAt)}.` : ''} Press Refresh to try again.
              </AdminNotice>
            )}

            <p data-testid="users-count-line" className={ADMIN_COUNT_LINE}>
              {countLine(filteredUsers.length)}
            </p>

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
                    {/* LF-8 (user request 2026-10-15): the Open button's narrow last column,
                        named for screen readers only. Still no Actions column (L-4b, SA Q-2 (b)). */}
                    <th scope="col" className={ADMIN_TH_OPEN}>
                      <span className="sr-only">Details</span>
                    </th>
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
                    shownUsers.map((user) => {
                      const isRowOpen = isOpen && openId === user.id;
                      const stats = details.loginStats[user.id];

                      return (
                        // D-17: a mouse extra only. No tabIndex, role, key handler or
                        // ARIA here: the Open button is the keyboard path (SA Q-1).
                        <tr
                          key={user.id}
                          data-account-id={user.id}
                          className={`hover:bg-slate-700/30 transition-colors cursor-pointer ${
                            isRowOpen ? 'bg-slate-700/20' : ''
                          }`}
                          onClick={(event) => handleRowClick(event, user)}
                        >
                          <td className={ADMIN_TD}>
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
                          </td>
                          <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="row-credits-cell">
                            <CreditsLeftCell business={user.business} creditsLeft={user.creditsLeft} />
                          </td>
                          <td className={ADMIN_TD} data-testid="row-contact">
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
                          <td className={ADMIN_TD} data-testid="row-login-activity">
                            {stats ? (
                              <div className="space-y-1">
                                {/* T-6: the count is not green (decoration); a failure stays red. */}
                                <div className="flex items-center gap-2 text-xs">
                                  <span data-testid="row-login-count" className="text-slate-200 font-medium tabular-nums">
                                    {stats.total_logins}
                                  </span>
                                  <span className="text-slate-400">logins</span>
                                </div>
                                {stats.failed_logins > 0 && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <XCircle className="w-3 h-3 text-red-400" aria-hidden="true" />
                                    <span data-testid="row-login-failed" className="text-red-300 font-medium tabular-nums">
                                      {stats.failed_logins}
                                    </span>
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
                                <span className="block text-xs text-slate-400">{ageLine(user.last_sign_in_at)}</span>
                              </>
                            ) : (
                              'Never'
                            )}
                          </td>
                          <td className={`${ADMIN_TD} whitespace-nowrap`} data-testid="row-joined">
                            <span className="block">{formatUtc(user.created_at)}</span>
                            <span className="block text-xs text-slate-400">{ageLine(user.created_at)}</span>
                          </td>
                          <td className={ADMIN_TD_OPEN}>
                            <OpenRowButton
                              label={`Open details for ${rowToggleName(user.full_name, user.email)}`}
                              onOpen={(button) => openRow(user, button)}
                              testId="row-open"
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* One drawer for the page, outside the content wrapper and every error /
          loading branch (C-9; L-2b SA M-4), keyed by the open account (Q-16,
          R-8). Being outside the table also keeps clicks inside it and its
          portaled dialogs from bubbling to a row (D-17 rule 6). */}
      <AdminDrawer
        open={isOpen && selected !== null}
        onClose={() => setIsOpen(false)}
        onReturnFocus={returnFocus}
        title={selected ? drawerTitle(selected) : ''}
        titleSuffix={selected ? formatShortId(selected.id) : undefined}
        testId="users-drawer"
      >
        {/* LF-F2 (SA C4): `listStale` is page-wide and outlives this drawer, so
            the line names no change; the Credits block's notice does that. */}
        {listStale && selected && (
          <p data-testid="drawer-list-stale" role="status" className="text-sm text-slate-400">
            The business list could not be refreshed, so the credits at the top of this panel and in the list may show an older figure.
          </p>
        )}
        {selected && (
          <BusinessDetail
            key={selected.id}
            user={selected}
            loginStats={details.loginStats[selected.id]}
            detailedStats={details.detailedStats[selected.id]}
            auditLogs={details.auditLogs[selected.id] ?? []}
            auditFilter={details.auditFilters[selected.id] ?? 'all'}
            onAuditFilterChange={(value) => details.setAuditFilter(selected.id, value)}
            isLoading={details.loading[selected.id] === true}
            refreshList={fetchUsers}
            refreshListAfterCredits={refreshAfterCredits}
          />
        )}
      </AdminDrawer>
    </div>
  );
}
