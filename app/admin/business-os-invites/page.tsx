'use client';

/**
 * Signup Invites (the sidebar label; this page was "Business OS Signup Invites"
 * until Admin Layout Standard L-6) — issue, list and revoke invite links
 * (invite-only signup, Slice 0).
 *
 * ── Why this page adds no guard of its own ──────────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page renders,
 * and a page cannot skip its parent layout. The API routes it calls each gate
 * with `requireAdmin` too. A third check here would read as though the first
 * two were optional.
 *
 * ── Why this file imports nothing from the invites or entitlements modules ──
 * Every option, label, state and the enforcement mode arrive in the GET
 * payload, already decided. If this page could import the config it could
 * re-derive from it, and each re-derivation is a second copy of a rule. The
 * source guard (`__tests__/source.guard.test.ts`) keeps it that way. The one
 * import from outside this folder is the shared admin layout folder, which may
 * not import a Business OS module either (Admin Layout Standard §6.1 S-4).
 *
 * ── The link is shown once ──────────────────────────────────────────────────
 * The create response's link lives only in this component's state. It is never
 * stored, so a reload loses it; the database keeps only its hash.
 *
 * ── The invitation email (Slice 2a) ─────────────────────────────────────────
 * The server emails the invite when the form asks it to, and the create
 * response says what happened in one status word, which the panel shows next
 * to the link. The list's Email status column is derived on the server too.
 *
 * ── Filters and search (Slice 1c, SA F-9) ───────────────────────────────────
 * Applied here, over the rows the GET already returned (the newest 500). What
 * the admin types stays in this component: it is never sent to the server and
 * never logged. `truncated` says when older invites exist beyond that ceiling.
 *
 * ── Why the filters are not in the URL (D-7 (a)) ────────────────────────────
 * Every other migrated admin page keeps its filters in the URL. This one does
 * not, on purpose: it shows a once-only invite link, and the simplest proof
 * that nothing on it survives a reload is that nothing on it is ever written
 * to the URL, history or storage. So the filter is plain `useState`, a reload
 * resets it, and the KPI tiles are not links (K-6). The source guard checks
 * this file and everything it imports, transitively.
 *
 * ── Layout (Admin Layout Standard L-6) ──────────────────────────────────────
 * The shared header (h1 = the sidebar label, "New invite" in its actions, the
 * plan-enforcement badge), the KPI strip, the filter bar, then the content:
 * the shared error and loading states, the stopped-halfway banner, the created
 * link, the form and the list. A failed Refresh keeps the list on screen under
 * the error (an existing choice) and hides the strip (K-10).
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md §3.3
 * @see docs/workplans/ADMIN_LAYOUT_L6_WORKPLAN.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';

import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';

import { CreateInviteForm } from './components/CreateInviteForm';
import { CreatedLinkPanel } from './components/CreatedLinkPanel';
import { InviteFilters, INVITES_WHAT } from './components/InviteFilters';
import { InviteKpis } from './components/InviteKpis';
import { InviteList } from './components/InviteList';
import { EMPTY_INVITE_FILTER, filterInvites, isFilterActive, type InviteListFilter } from './inviteFilter';
import type { CreatedInvite, EnforcementMode, InviteRow, InvitesPayload } from './types';

const PURPOSE =
  'Business OS signup is invite-only: create an invite for one email address, follow it here, and copy its link when you create it, because it is shown only once.';

/**
 * Every failure that is not a network error or an ended session (SA L-6 Q-2,
 * M-2). The route answers a machine code (`could_not_read_invites`), not
 * admin copy, so §5.10 rule 1 (show the route's string) would put a code on
 * screen: these are the §5.10 rule 2 words instead, a recorded page deviation.
 */
const INVITES_READ_FAILED = 'Could not read invites. Try again in a moment.';

/**
 * GR-5 (invite signup): honest status until enforcement. An invite records the
 * plan it grants; whether any plan limits an account is the server's
 * enforcement mode, stated on the page that issues the invites. Until L-6 a
 * yellow note said it, together with words that stopped being true when invite
 * signup went live; the user removed the note (D-18)
 * and the live fact stays as the header's one factual badge (SA M-1). The mode
 * comes only from the payload: no default and no fallback, so an unknown mode
 * shows no badge rather than a guess.
 */
const ENFORCEMENT_BADGE: Readonly<Record<EnforcementMode, string>> = {
  off: 'Plans not enforced',
  shadow: 'Plans not enforced',
  enforce: 'Plans enforced',
};

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

export default function BusinessOsInvitesPage() {
  const [payload, setPayload] = useState<InvitesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [filter, setFilter] = useState<InviteListFilter>(EMPTY_INVITE_FILTER);

  const filterActive = isFilterActive(filter);
  const visibleInvites = useMemo(
    () => (payload ? filterInvites(payload.invites, filter) : []),
    [payload, filter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try: a rejection here is a network
      // failure, and nothing else is ever labelled as one (§5.10 rule 3). The
      // browser's own message ("Failed to fetch") is never shown (rule 4).
      let response: Response;
      try {
        response = await fetch('/api/admin/business-os/invites', { cache: 'no-store' });
      } catch {
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      // Never throws: a non-JSON reply falls to the fixed sentence. A status
      // check on the helper's result, never a fork of it (SA Q-2): 401 / 403
      // keep the helper's session-ended words (RC-4), everything else gets
      // this page's sentence, never the route's machine code.
      const result = await readAdminResponse<InvitesPayload>(response, { what: INVITES_WHAT, sessionEndedCopy: true });
      if (!result.ok) {
        // `payload` is kept on purpose: see the Layout note above.
        setError(result.status === 401 || result.status === 403 ? result.message : INVITES_READ_FAILED);
        return;
      }
      setPayload(result.data);
      setReadAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceRow = (invite: InviteRow) =>
    setPayload((current) =>
      current ? { ...current, invites: current.invites.map((row) => (row.id === invite.id ? invite : row)) } : current
    );

  const clearFilter = () => setFilter(EMPTY_INVITE_FILTER);

  // SA M-5: one number for the banner and the tile, so the two cannot drift.
  const stoppedCount = payload?.stoppedHalfway?.count ?? 0;
  const total = payload?.invites.length ?? 0;
  // QA-1: own keys only. A plain lookup would read the prototype for a mode such
  // as "__proto__" or "toString" (crash or junk); any unknown mode → no badge.
  const badgeLabel =
    payload && Object.hasOwn(ENFORCEMENT_BADGE, payload.enforcementMode)
      ? ENFORCEMENT_BADGE[payload.enforcementMode]
      : undefined;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Signup Invites"
        purpose={PURPOSE}
        badge={badgeLabel ? { label: badgeLabel, testId: 'enforcement-mode-badge' } : undefined}
        actions={
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!payload || creating}
            className={`flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40 ${FOCUS_RING}`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New invite
          </button>
        }
      />

      {/* K-10: hidden while the page shows an error, even over a kept list. */}
      <InviteKpis payload={error ? null : payload} stoppedCount={stoppedCount} loading={loading} />

      <InviteFilters
        filter={filter}
        inviteTypes={payload?.formOptions.inviteTypes ?? []}
        hasInvites={total > 0}
        onChange={setFilter}
        onClear={clearFilter}
        onRefresh={() => void load()}
        busy={loading}
        readAt={readAt}
      />

      <div data-testid="invites-content" aria-busy={loading && payload !== null} className="space-y-6">
        {error && <AdminError message={error} testId="page-error" onRetry={() => void load()} />}

        {!payload && loading && <AdminLoading what={INVITES_WHAT} />}

        {payload && (
          <>
            {/* T-16 (SA): an indicator on this page, no email. Derived from data on the
                server, so it also counts a signup killed by its timeout. */}
            {stoppedCount > 0 && (
              <div
                data-testid="stopped-halfway-banner"
                role="status"
                className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
              >
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
                <p className="text-sm text-amber-100">
                  {stoppedCount === 1 ? '1 signup stopped halfway.' : `${stoppedCount} signups stopped halfway.`}{' '}
                  The account may exist without its plan. See the marked rows and the recovery steps in{' '}
                  <code className="text-amber-200">docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md</code>{' '}
                  §6.2.
                </p>
              </div>
            )}

            {/* Keyed by invite so each new link mounts a fresh panel. Without the key,
                React reuses the previous panel and its "Copied" state carries over to a
                link that was never copied, and an admin pastes the old one. */}
            {created && (
              <CreatedLinkPanel
                key={created.invite.id}
                link={created.link}
                email={created.invite.email}
                emailStatus={created.email?.status}
                onDismiss={() => setCreated(null)}
              />
            )}

            {creating && (
              <CreateInviteForm
                options={payload.formOptions}
                onCancel={() => setCreating(false)}
                onCreated={(result) => {
                  setCreating(false);
                  setCreated(result);
                  setPayload((current) => (current ? { ...current, invites: [result.invite, ...current.invites] } : current));
                }}
              />
            )}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-white">Invites (newest first)</h2>
              {total > 0 && (
                <p data-testid="invite-filter-count" className={ADMIN_COUNT_LINE}>
                  {filterActive
                    ? `${visibleInvites.length} of ${total} shown`
                    : `${total} ${total === 1 ? 'invite' : 'invites'}`}
                </p>
              )}
              {payload.truncated && (
                <AdminNotice testId="invite-list-truncated">
                  Showing the newest {payload.invites.length} invites. Older invites are not listed, so filters and
                  search do not reach them.
                </AdminNotice>
              )}
              <InviteList
                invites={visibleInvites}
                onRevoked={replaceRow}
                emptyMessage={filterActive ? 'No invites match these filters.' : 'No invites yet.'}
                onClearFilters={filterActive ? clearFilter : undefined}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
