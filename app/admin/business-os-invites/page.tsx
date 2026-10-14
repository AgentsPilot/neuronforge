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
 * link and the list. A failed Refresh keeps the list on screen under the error
 * (an existing choice) and hides the strip (K-10).
 *
 * ── New invite and Revoke (Admin Layout Follow-ups LF-3a, OR-2, OR-3) ───────
 * "New invite" opens a drawer whose body is the create form (OR-2, a new use of
 * `AdminDrawer`, SA-C9). The page owns three things about it:
 * - the draft. Escape, an overlay click or the corner close shut the drawer and
 *   keep what was typed; only Cancel or a success clears it, and only once the
 *   close has finished, so the drawer never blanks on its way out. A kept draft
 *   whose type is no longer offered (after a Refresh) reopens as a fresh one.
 * - the in-flight lock. While the create request is in flight the page ignores
 *   the drawer's close, and the form disables Cancel. A success closes the
 *   drawer through page state, never through that guarded path.
 * - focus. After a success it goes to the created-link panel's heading, so the
 *   shown-once link is announced and Copy is one Tab away; otherwise back to
 *   "New invite"; failing both, the content area, never the page body.
 * The link panel stays here on the page, outside the drawer, so no drawer close
 * can lose it. Revoke asks in a dialog (OR-3) the page renders once, so it
 * outlives the row's button, which leaves as soon as the row is Revoked; focus
 * goes back to that button, else to the content area. Neither surface writes
 * the URL, history or storage (D-7 (a)).
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md §3.3
 * @see docs/workplans/ADMIN_LAYOUT_L6_WORKPLAN.md
 * @see docs/workplans/ADMIN_LAYOUT_LF3A_WORKPLAN.md
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';

import { AdminDrawer } from '@/app/admin/components/layout/AdminDrawer';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_COUNT_LINE } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';

import { CreateInviteForm, initialInviteDraft, type InviteDraft } from './components/CreateInviteForm';
import { CreatedLinkPanel } from './components/CreatedLinkPanel';
import { InviteFilters, INVITES_WHAT } from './components/InviteFilters';
import { InviteKpis } from './components/InviteKpis';
import { InviteList } from './components/InviteList';
import { RevokeDialog } from './components/RevokeDialog';
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

/**
 * Focus `target` only when it can take focus now: present, still in the page
 * and not disabled. True only if focus really landed there (SA C4 b).
 */
function focusIfAble(target: HTMLElement | null): boolean {
  if (!target || !target.isConnected) return false;
  if (target instanceof HTMLButtonElement && target.disabled) return false;
  target.focus();
  return document.activeElement === target;
}

export default function BusinessOsInvitesPage() {
  const [payload, setPayload] = useState<InvitesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [filter, setFilter] = useState<InviteListFilter>(EMPTY_INVITE_FILTER);
  const [draft, setDraft] = useState<InviteDraft | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InviteRow | null>(null);
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  const [revokeKey, setRevokeKey] = useState(0);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const newInviteRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const revokeOpenerRef = useRef<HTMLButtonElement | null>(null);
  /** The drawer is meant to be open: read by the close-finished callback. */
  const isCreateOpen = useRef(false);
  /** A create request is in flight: the drawer refuses to close (SA-C9). */
  const isCreateBusy = useRef(false);
  /** Set by a success: focus the link panel once the drawer has closed. */
  const focusPanelNext = useRef(false);
  /** Set by Cancel or a success: clear the draft once the drawer has closed. */
  const clearDraftNext = useRef(false);
  const isRevokeOpenRef = useRef(false);

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

  const openCreate = () => {
    if (!payload) return;
    const options = payload.formOptions;
    // Read the ref now: a state updater may run after it has been reset.
    const startFresh = clearDraftNext.current;
    clearDraftNext.current = false;
    setDraft((current) => {
      if (startFresh || !current) return initialInviteDraft(options);
      const stillOffered = options.inviteTypes.some((type) => type.type === current.inviteType && type.available);
      return stillOffered ? current : initialInviteDraft(options);
    });
    isCreateOpen.current = true;
    setCreating(true);
  };

  const shutCreate = () => {
    isCreateOpen.current = false;
    setCreating(false);
  };

  /** Escape, an overlay click or the corner close: never in flight, and the draft stays. */
  const onCreateClose = () => {
    if (isCreateBusy.current) return;
    shutCreate();
  };

  const onCreateCancel = () => {
    if (isCreateBusy.current) return;
    clearDraftNext.current = true;
    shutCreate();
  };

  const onCreated = (result: CreatedInvite) => {
    setCreated(result);
    setPayload((current) => (current ? { ...current, invites: [result.invite, ...current.invites] } : current));
    focusPanelNext.current = true;
    clearDraftNext.current = true;
    // Through page state, not `onCreateClose`: the busy ref is still set until the form's finally.
    shutCreate();
  };

  const onCreateClosed = () => {
    const toPanel = focusPanelNext.current;
    focusPanelNext.current = false;
    if (clearDraftNext.current) {
      clearDraftNext.current = false;
      setDraft(null);
    }
    // Reopened while the close was still running: leave focus in the drawer.
    if (isCreateOpen.current) return;
    if (toPanel && focusIfAble(panelHeadingRef.current)) return;
    if (focusIfAble(newInviteRef.current)) return;
    contentRef.current?.focus();
  };

  const openRevoke = (invite: InviteRow, button: HTMLButtonElement) => {
    revokeOpenerRef.current = button;
    isRevokeOpenRef.current = true;
    setRevokeTarget(invite);
    setRevokeKey((key) => key + 1);
    setIsRevokeOpen(true);
  };

  const shutRevoke = () => {
    isRevokeOpenRef.current = false;
    setIsRevokeOpen(false);
  };

  const onRevokeClosed = () => {
    if (isRevokeOpenRef.current) return;
    if (focusIfAble(revokeOpenerRef.current)) return;
    contentRef.current?.focus();
  };

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
            ref={newInviteRef}
            onClick={openCreate}
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

      <div
        ref={contentRef}
        tabIndex={-1}
        data-testid="invites-content"
        aria-busy={loading && payload !== null}
        className="space-y-6 focus:outline-none"
      >
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
                headingRef={panelHeadingRef}
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
                onRevoke={openRevoke}
                emptyMessage={filterActive ? 'No invites match these filters.' : 'No invites yet.'}
                onClearFilters={filterActive ? clearFilter : undefined}
              />
            </section>
          </>
        )}
      </div>

      <AdminDrawer
        open={creating}
        onClose={onCreateClose}
        onReturnFocus={onCreateClosed}
        title="New invite"
        testId="create-invite-drawer"
      >
        {payload && draft && (
          <CreateInviteForm
            options={payload.formOptions}
            draft={draft}
            onDraftChange={setDraft}
            onBusyChange={(isBusy) => {
              isCreateBusy.current = isBusy;
            }}
            onCancel={onCreateCancel}
            onCreated={onCreated}
          />
        )}
      </AdminDrawer>

      {revokeTarget && (
        <RevokeDialog
          open={isRevokeOpen}
          invite={revokeTarget}
          openKey={revokeKey}
          onClose={shutRevoke}
          onRevoked={(updated) => {
            replaceRow(updated);
            shutRevoke();
          }}
          onReturnFocus={onRevokeClosed}
        />
      )}
    </div>
  );
}
