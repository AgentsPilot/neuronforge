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
import { Search } from 'lucide-react';

import type { AccountPayload } from '../types';

/**
 * Every failure the read path can return, in the words an admin needs.
 *
 * ── Kept complete by a test, not by memory (QA NEW-3) ───────────────────────
 * `tenant_check_failed` was missing — and it was missing because I added it to
 * the route in the same round that added the payload contract, so the first new
 * code after that contract landed fell straight through the gap it did not
 * cover. An admin saw the raw string.
 *
 * `accountLookup.contract.test.tsx` now reads the route's source, collects
 * every `error: '…'` it can return, and fails if one has no copy here. A new
 * refusal without a sentence is a red test rather than a code on a screen.
 */
const ERROR_COPY: Record<string, string> = {
  not_a_business_os_account:
    'That id is not a Business OS account. It may be a valid login on the agent platform — the two products have separate plans.',
  invalid_account_id: 'That does not look like an account id.',
  entitlement_inputs_unavailable:
    'The entitlement inputs could not be read, so nothing is being shown rather than a guess.',
  tenant_check_failed:
    'Whether this is a Business OS account could not be determined — one of the two reads failed. Nothing is being shown rather than a guess; try again.',
  'Internal server error': 'Something failed on the server. The correlation id is in the logs.',
};

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
      const response = await fetch(
        `/api/admin/business-os/entitlements/accounts/${encodeURIComponent(trimmed)}`
      );
      const body = await response.json();

      if (!response.ok || !body?.success) {
        const code = typeof body?.error === 'string' ? body.error : 'unknown';
        throw new Error(ERROR_COPY[code] ?? `Could not read that account (${code}).`);
      }

      setPayload(body.data as AccountPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that account.');
    } finally {
      setLoading(false);
    }
  };

  // The server decides what counts as granted, with `isGrantingValue`. The one
  // rule, asked once, and this component is not entitled to a second opinion.
  const granted = payload
    ? Object.entries(payload.capabilities).filter(([, resolved]) => resolved.granting)
    : [];

  return (
    <section
      data-testid="account-lookup"
      className="rounded-lg border border-slate-700 bg-slate-800/40 p-4"
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
          Users screen.
        */}
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          An account <strong>id</strong>, not an email. Searching by email would make this a way to
          look people up, which is not what a plan-configuration screen should be — find the id on{' '}
          <a href="/admin/users" className="underline hover:text-slate-300">
            Users
          </a>{' '}
          and paste it here.
        </p>
      </header>

      <form onSubmit={lookup} className="flex flex-wrap gap-2">
        <input
          type="text"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          placeholder="Account id"
          aria-label="Account id"
          className="min-w-[22rem] flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600"
        />
        <button
          type="submit"
          disabled={loading || accountId.trim().length === 0}
          className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Reading…' : 'Look up'}
        </button>
      </form>

      {error && (
        <p data-testid="account-error" className="mt-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      {payload && (
        <div data-testid="account-result" className="mt-4 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {[
              ['Tier', payload.plan?.tier ?? 'none'],
              ['Cohort', payload.plan?.cohort ?? 'none'],
              ['Tier ends', payload.plan?.tier_expires_at ?? 'no end date'],
              ['Cohort ends', payload.plan?.cohort_expires_at ?? 'no end date'],
              ['State', payload.state],
              // `basis` is an object with a `kind` and the name of whatever it
              // stands on. Rendering it directly threw on every lookup, and
              // FR-12 forbids naming a plan here, so neither appears.
              [
                'Basis',
                payload.basis.kind === 'none'
                  ? 'none'
                  : `${payload.basis.kind} ${payload.basis.tier ?? payload.basis.cohort ?? ''}`.trim(),
              ],
              ['Matrix version', String(payload.matrixVersion)],
              ['Anomaly', payload.anomaly ?? 'none'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="font-mono text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Capabilities in force ({granted.length} of{' '}
              {Object.keys(payload.capabilities).length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-1 pr-4 font-normal">Capability</th>
                    <th className="pb-1 pr-4 font-normal">Value</th>
                    <th className="pb-1 font-normal">Decided by</th>
                  </tr>
                </thead>
                <tbody>
                  {granted.map(([capability, resolved]) => (
                    <tr key={capability} className="border-t border-slate-700/60">
                      <td className="py-1 pr-4 font-mono text-slate-300">{capability}</td>
                      {/* QA-8: the server's own rendering, which is the plan
                          cards' rendering. This column used to print the raw
                          JSON of the value. */}
                      <td className="py-1 pr-4 text-slate-200">{resolved.display}</td>
                      {/* FR-10: the layer, never inferred here. An override and
                          a tier can produce the same value, and which one it
                          was is the question an admin is actually asking. */}
                      <td className="py-1 font-mono text-slate-400">{resolved.decidedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            This answer is good for {payload.effectiveWithinSeconds} seconds — an admin change made
            elsewhere can take that long to appear here.
          </p>
        </div>
      )}
    </section>
  );
}
