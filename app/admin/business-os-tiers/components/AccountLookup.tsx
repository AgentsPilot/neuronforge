/**
 * One account: what it is on, what state it is in, and which layer decided each
 * capability.
 *
 * ── It reads the endpoint that already exists ───────────────────────────────
 * `GET /api/admin/business-os/entitlements/accounts/[accountId]` returns the
 * resolution, the trace and the plan row. Nothing new was built for this, and
 * nothing here re-resolves anything: the layer names in the table are the
 * resolver's own `decidedBy`, not this component's opinion about which layer
 * ought to have won.
 *
 * ── Read-only ───────────────────────────────────────────────────────────────
 * There is no form that writes. `assign_tier`, `set_cohort` and the rest are
 * POSTs on that same route, audited, and they stay there until the user asks
 * for buttons.
 *
 * ── Why the empty state says what it says ───────────────────────────────────
 * A 404 here means "not a Business OS account", which is a fact about the
 * account and not an error in the page — an admin typing a valid agent-platform
 * user id will hit it, and should be told which product they are looking at.
 *
 * QA (2026-09-24): that 404 used to be unreachable. The GET path resolved a
 * snapshot for ANY id and returned 200, so an agent-platform-only id produced a
 * confident panel describing a plan that does not exist. The read path now runs
 * the same tenancy check as the write path, which is what makes the copy below
 * true rather than aspirational.
 *
 * ── It answers no question the server has already answered ──────────────────
 * `granting` and `basis.kind` both arrive in the payload. This component used
 * to compute the first with `value !== false` — a second granting rule, on a
 * screen whose plan cards use the resolver's — and render the second, which is
 * an object, straight into JSX.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { ADMIN_FIELD_CONTROL } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminError } from '@/app/admin/components/layout/AdminStates';
import { ADMIN_BUTTON } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';

import type { AccountPayload } from '../types';
import { ENTITLEMENT_ERROR_COPY, EntitlementSnapshot } from './EntitlementSnapshot';

export function AccountLookup() {
  const [accountId, setAccountId] = useState('');
  const [payload, setPayload] = useState<AccountPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = accountId.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setPayload(null);

    try {
      // Only the fetch sits inside this try: a rejection is a network failure
      // (§5.10 rule 3), and the browser's own message is never shown (rule 4).
      let response: Response;
      try {
        response = await fetch(
          `/api/admin/business-os/entitlements/accounts/${encodeURIComponent(trimmed)}`
        );
      } catch {
        setError(ADMIN_NETWORK_ERROR);
        return;
      }

      // Never throws (Admin Layout Standard L-5, F-37): a non-JSON reply falls
      // to "Could not read that account. Try again in a moment.", and a 401 /
      // 403 from the admin guard says the session ended (RC-4; the route itself
      // never answers either, so no code below is masked). Otherwise the
      // message is the route's code verbatim, worded through the same copy
      // table as before; `accountLookup.contract` proves every code has a
      // sentence.
      const result = await readAdminResponse<AccountPayload>(response, {
        what: 'that account',
        sessionEndedCopy: true,
      });
      if (!result.ok) {
        setError(ENTITLEMENT_ERROR_COPY[result.message] ?? result.message);
        return;
      }

      setPayload(result.data);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      data-testid="account-lookup"
      className="rounded-xl border border-slate-700 bg-slate-800/40 p-4"
    >
      <header className="mb-3 border-b border-slate-700 pb-3">
        <h2 className="text-sm font-semibold text-white">Look up an account</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          What one account is on right now, and the layer that decided each capability. Read-only.
        </p>
        {/*
          SA: say why it is an id, in the place somebody would otherwise ask for
          an email box. Searching by email would turn a plan-configuration
          screen into a way to search PEOPLE, which is a different thing with
          different consequences — and it already exists, done properly, on the
          Businesses screen.
        */}
        <p className="mt-1 max-w-3xl text-xs text-slate-400">
          An account <strong>id</strong>, not an email. Searching by email would make this a way to
          look people up, which is not what a plan-configuration screen should be — find the id on{' '}
          <Link href="/admin/users" className="underline hover:text-slate-300">
            Businesses
          </Link>{' '}
          and paste it here.
        </p>
      </header>

      {/* The shared field and button classes, with only layout classes added
          (width, flex, gap): never a second colour, padding or border that
          would rely on class order to win (§6.1 S-9). */}
      <form onSubmit={lookup} className="flex flex-wrap gap-2">
        <input
          type="text"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="Account id"
          aria-label="Account id"
          className={`${ADMIN_FIELD_CONTROL} min-w-[22rem] flex-1 font-mono`}
        />
        <button
          type="submit"
          disabled={loading || accountId.trim().length === 0}
          className={`${ADMIN_BUTTON} flex items-center gap-2`}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Reading…' : 'Look up'}
        </button>
      </form>

      {error && (
        <div className="mt-3">
          <AdminError message={error} testId="account-error" />
        </div>
      )}

      {payload && <EntitlementSnapshot payload={payload} />}
    </section>
  );
}
