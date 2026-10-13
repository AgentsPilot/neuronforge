'use client';

/**
 * Plans & entitlements (the sidebar label; this page was "Business OS Tiers"
 * until Admin Layout Standard L-5) — what the four Business OS plans are, and
 * what none of them is doing yet.
 *
 * ── Why this is its own page and not part of /admin/onboarding ──────────────
 * `/admin/onboarding` is the **agent platform's** free tier. Business OS is a
 * different product with a different plan set, a different config and a
 * different enforcement switch. Putting them on one screen would make it easy
 * to change the wrong product's plan, which is exactly what the user asked to
 * avoid when he asked for this page.
 *
 * ── Why this page adds no guard of its own ──────────────────────────────────
 * `app/admin/layout.tsx` awaits `requireAdminPage()` before this page's RSC
 * payload is produced, and a page cannot skip its parent layout. Protection is
 * a property of the route tree. A second check here would read as though the
 * first were optional.
 *
 * ── Why this file imports nothing from the entitlements module ──────────────
 * Every plan, price, allowance, capability value and the mode itself arrive in
 * the `GET` payload, already decided. If this page could import the config it
 * could also re-derive from it — and each re-derivation is a second copy of a
 * rule that already exists, free to drift from the resolver's. So the boundary
 * is HTTP, and `adminPlansView` is `server-only` to make that structural rather
 * than a convention. The one import from outside this folder is the shared
 * admin layout folder, which may not import the entitlements module either
 * (Admin Layout Standard §6.1 S-4).
 *
 * ── Layout (Admin Layout Standard L-5) ──────────────────────────────────────
 * The shared header (h1 = the sidebar label, "Read-only" as the neutral chip,
 * the server's "As of"), the KPI strip (every figure from the one plans read),
 * the Refresh-only bar, the shared loading and error states, then the content.
 * A failed refresh keeps the cards on screen under the error (an existing
 * choice): nothing here confirms an action, so stale cards mislead nobody, and
 * the "As of" line still dates them. The strip hides while the error shows.
 *
 * ── Read-only (v1) ──────────────────────────────────────────────────────────
 * Nothing here writes. The write operations exist on the accounts route, are
 * audited, and are named on the page rather than silently absent.
 *
 * ── One account (Admin Layout follow-ups LF-2) ──────────────────────────────
 * This page used to carry an id-only "Look up an account" box. The Businesses
 * drawer reads the same route and renders the same `EntitlementSnapshot`, and
 * Businesses finds an account by name, business name or full id, so the box
 * was a second, weaker way to the same view (user answer Q-2 (a)). A pointer
 * line replaces it. How a plan's contents change is documented in
 * docs/architecture/BUSINESS_OS_ENTITLEMENTS.md, not repeated here (SA V-8).
 *
 * @see docs/workplans/business-os-tiers-admin-page.md
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';
import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';
import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_NETWORK_ERROR, readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';

import { EnforcementBanner } from './components/EnforcementBanner';
import { NotBuiltPanel } from './components/NotBuiltPanel';
import { PlanCard } from './components/PlanCard';
import { PlansKpis } from './components/PlansKpis';
import type { PlansPayload } from './types';

/** Noun phrase for the loading line, the fallback error and the Refresh name. */
const WHAT = 'the plans';

/** §5.7 card shell. */
const CARD = 'rounded-xl border border-slate-700 bg-slate-800/40 p-4';

export default function BusinessOsTiersPage() {
  const [payload, setPayload] = useState<PlansPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Only the fetch sits inside this try: a rejection here is a network
      // failure, and nothing else is ever labelled as one (§5.10 rule 3). The
      // browser's own message is never shown (rule 4). The call keeps its one
      // argument (F-38 is a data item, not this slice).
      let response: Response;
      try {
        response = await fetch('/api/admin/business-os/entitlements/plans');
      } catch {
        setError(ADMIN_NETWORK_ERROR);
        return;
      }
      // Never throws: a non-JSON reply (an HTML 504 from the edge, say) falls
      // to the fixed sentence, and a 401 / 403 says the session ended (RC-4).
      const result = await readAdminResponse<PlansPayload>(response, { what: WHAT, sessionEndedCopy: true });
      if (!result.ok) {
        // `payload` is kept on purpose: see the Layout note above.
        setError(result.message);
        return;
      }
      setPayload(result.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Plans & entitlements"
        purpose="What each Business OS plan includes and what cannot be sold, read from the configuration the resolver uses; not the agent platform's free tier, which is on the Onboarding page."
        badge={{ label: 'Read-only', testId: 'read-only-badge' }}
        asOf={payload ? `As of ${formatUtc(payload.generatedAt)}.` : null}
      />

      {/* K-10: hidden while the page shows an error, even over stale cards. */}
      <PlansKpis payload={error ? null : payload} loading={loading} />

      {/* Refresh only: no filters, so no Clear and no "Read at" beside the
          header's server "As of" (§5.5 part 6). */}
      <AdminFilterBar what={WHAT} busy={loading} onRefresh={() => void load()} />

      {error && <AdminError message={error} testId="page-error" onRetry={() => void load()} />}

      {!payload && loading && <AdminLoading what={WHAT} />}

      {payload && (
        <div data-testid="plans-content" aria-busy={loading} className="space-y-6">
          {/* First in the content (the header, the strip and the bar sit above
              it, §5.1), and never conditional on the mode being off: when it is
              `enforce` it says so in different words rather than disappearing.
              A banner that vanishes is a banner nobody learns to look for. The
              Enforcement tile links straight to it. */}
          <EnforcementBanner
            mode={payload.mode}
            meaning={payload.modeMeaning}
            envVar={payload.modeEnvVar}
            enforced={payload.enforced}
          />

          {payload.withheldWithoutGate.length > 0 && (
            <section id="withheld-without-gate" data-testid="no-gate-summary" className={CARD}>
              <h2 className="text-sm font-semibold text-slate-300">
                Withheld in the plan, not yet refused by the product
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-400">
                {payload.withheldWithoutGate.length} of the capabilities some plan withholds have{' '}
                <strong>no gate built yet</strong> — the configuration says no and nothing asks.
                Each one is marked on the card it appears on. This list shrinks by itself as gates
                are built; it is read from the code, not maintained by hand.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {payload.withheldWithoutGate.map((capability) => (
                  <li
                    key={capability}
                    className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-xs text-amber-300"
                  >
                    {capability}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="plans">
            <h2 className="mb-3 text-sm font-semibold text-white">The four plans</h2>
            {/* Four columns at xl, not §5.7's three: four plans in three columns
                leave an orphan card (SA L-5 Q-7, a recorded deviation). */}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {payload.plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Matrix version {payload.matrixVersion}. Two of these are tiers (something to buy) and
              two are cohorts (what somebody has while they are not paying).
            </p>
          </section>

          <NotBuiltPanel capabilities={payload.notBuilt} />

          {/* Footnote (LF-2): the operations stay named rather than silently
              absent (the Read-only note above); the long text went to the
              entitlements doc, which already had it (SA V-8). */}
          <div data-testid="write-ops-footnote" className="text-xs text-slate-400">
            <span>This page only reads. Per-account changes are audited API operations, not buttons:</span>
            <ul className="mt-1 inline-flex flex-wrap gap-2 align-middle sm:ml-2 sm:mt-0">
              {payload.writeOpsNotOnThisPage.map((operation) => (
                <li
                  key={operation}
                  className="rounded bg-slate-700/50 px-2 py-0.5 font-mono text-xs text-slate-400"
                >
                  {operation}
                </li>
              ))}
            </ul>
          </div>

          {/* In place of the lookup (LF-2, SA-C1): Businesses search matches
              name, business name and full account id, never email (SA V-3). */}
          <p data-testid="businesses-pointer" className="text-sm text-slate-400">
            To see one account&apos;s plan and which layer decided each capability, open the account
            on{' '}
            <Link href="/admin/users" className="underline hover:text-slate-300">
              Businesses
            </Link>{' '}
            (Plan &amp; entitlements). Search Businesses by name, business name or account id.
          </p>
        </div>
      )}
    </div>
  );
}
