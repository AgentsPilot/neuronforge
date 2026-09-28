/**
 * One account's entitlement snapshot, rendered exactly as
 * `GET /api/admin/business-os/entitlements/accounts/[accountId]` returns it:
 * tier, cohort, state, basis, and for each capability in force its value and
 * the layer that decided it.
 *
 * Extracted from AccountLookup (admin reorganisation slice 2b) so the
 * Businesses panel shows the SAME rendering, not a second one that could drift.
 * Read-only, and it imports nothing but the screen's own types.
 */

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
export const ENTITLEMENT_ERROR_COPY: Record<string, string> = {
  not_a_business_os_account:
    'That id is not a Business OS account. It may be a valid login on the agent platform — the two products have separate plans.',
  invalid_account_id: 'That does not look like an account id.',
  entitlement_inputs_unavailable:
    'The entitlement inputs could not be read, so nothing is being shown rather than a guess.',
  tenant_check_failed:
    'Whether this is a Business OS account could not be determined — one of the two reads failed. Nothing is being shown rather than a guess; try again.',
  'Internal server error': 'Something failed on the server. The correlation id is in the logs.',
};

export function EntitlementSnapshot({ payload }: { payload: AccountPayload }) {
  // The server decides what counts as granted, with `isGrantingValue`. The one
  // rule, asked once, and this component is not entitled to a second opinion.
  const granted = Object.entries(payload.capabilities).filter(([, resolved]) => resolved.granting);

  return (
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
  );
}
