'use client';

/**
 * Business OS Signup Invites — issue, list and revoke invite links (invite-only
 * signup, Slice 0).
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
 * source guard (`__tests__/source.guard.test.ts`) keeps it that way.
 *
 * ── The link is shown once ──────────────────────────────────────────────────
 * The create response's link lives only in this component's state. It is never
 * stored, so a reload loses it; the database keeps only its hash.
 *
 * ── Filters and search (Slice 1c, SA F-9) ───────────────────────────────────
 * Applied here, over the rows the GET already returned (the newest 500). What
 * the admin types stays in this component: it is never sent to the server and
 * never logged. `truncated` says when older invites exist beyond that ceiling.
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md §3.3
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Plus, RefreshCw } from 'lucide-react';

import { CreateInviteForm } from './components/CreateInviteForm';
import { CreatedLinkPanel } from './components/CreatedLinkPanel';
import { EnforcementNote } from './components/EnforcementNote';
import { InviteFilters } from './components/InviteFilters';
import { InviteList } from './components/InviteList';
import { EMPTY_INVITE_FILTER, filterInvites, isFilterActive, type InviteListFilter } from './inviteFilter';
import type { CreatedInvite, InviteRow, InvitesPayload } from './types';

export default function BusinessOsInvitesPage() {
  const [payload, setPayload] = useState<InvitesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      const response = await fetch('/api/admin/business-os/invites', { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error('Could not read invites. If this persists, the invites table may not be installed yet.');
      }
      setPayload(body.data as InvitesPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read invites.');
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

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <h1 className="mb-1 text-xl font-semibold text-white">Business OS Signup Invites</h1>
            <p className="max-w-3xl text-sm text-slate-400">
              Business OS is invite-only. Create an invite for one email address, copy its link, and follow it here.
              A link is shown once, when you create it.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={!payload || creating}
              className="flex items-center gap-2 rounded bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New invite
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div data-testid="page-error" className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
          <p className="text-sm text-rose-100">{error}</p>
        </div>
      )}

      {loading && !payload && <p className="text-sm text-slate-400">Reading invites…</p>}

      {payload && (
        <>
          <EnforcementNote mode={payload.enforcementMode} />

          {/* T-16 (SA): an indicator on this page, no email. Derived from data on the
              server, so it also counts a signup killed by its timeout. */}
          {payload.stoppedHalfway && payload.stoppedHalfway.count > 0 && (
            <div
              data-testid="stopped-halfway-banner"
              role="status"
              className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
              <p className="text-sm text-amber-100">
                {payload.stoppedHalfway.count === 1
                  ? '1 signup stopped halfway.'
                  : `${payload.stoppedHalfway.count} signups stopped halfway.`}{' '}
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

          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">Invites (newest first)</h2>
            {payload.invites.length > 0 && (
              <InviteFilters
                filter={filter}
                inviteTypes={payload.formOptions.inviteTypes}
                shown={visibleInvites.length}
                total={payload.invites.length}
                isActive={filterActive}
                onChange={setFilter}
                onClear={() => setFilter(EMPTY_INVITE_FILTER)}
              />
            )}
            {payload.truncated && (
              <p data-testid="invite-list-truncated" className="mb-3 text-xs text-slate-400">
                Showing the newest {payload.invites.length} invites. Older invites are not listed, so filters and
                search do not reach them.
              </p>
            )}
            <InviteList
              invites={visibleInvites}
              onRevoked={replaceRow}
              emptyMessage={filterActive ? 'No invites match these filters.' : 'No invites yet.'}
            />
          </section>
        </>
      )}
    </div>
  );
}
