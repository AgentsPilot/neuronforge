'use client';

/**
 * Business OS Tiers — what the four Business OS plans are, and what none of
 * them is doing yet.
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
 * than a convention.
 *
 * ── Read-only (v1) ──────────────────────────────────────────────────────────
 * Nothing here writes. The write operations exist on the accounts route, are
 * audited, and are named on the page rather than silently absent.
 *
 * @see docs/workplans/business-os-tiers-admin-page.md
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { AccountLookup } from './components/AccountLookup';
import { EnforcementBanner } from './components/EnforcementBanner';
import { NotBuiltPanel } from './components/NotBuiltPanel';
import { PlanCard } from './components/PlanCard';
import type { PlansPayload } from './types';

export default function BusinessOsTiersPage() {
  const [payload, setPayload] = useState<PlansPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/business-os/entitlements/plans');
      const body = await response.json();
      if (!response.ok || !body?.success) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not read the plans');
      }
      setPayload(body.data as PlansPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">Business OS Tiers</h1>
              <span className="rounded bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                Read-only
              </span>
            </div>
            <p className="max-w-3xl text-sm text-slate-400">
              The four Business OS plans, what each includes, and what cannot be sold at all. Read
              from the same configuration the resolver uses, so this page cannot disagree with the
              system.{' '}
              <span className="text-slate-500">
                This is Business OS — not the agent platform&apos;s free tier, which lives on the
                Onboarding page.
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div
          data-testid="page-error"
          className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" aria-hidden="true" />
          <p className="text-sm text-rose-100">{error}</p>
        </div>
      )}

      {loading && !payload && <p className="text-sm text-slate-400">Reading the configuration…</p>}

      {payload && (
        <>
          {/* First, above everything, and never conditional on the mode being
              off: when it is `enforce` it says so in different words rather
              than disappearing. A banner that vanishes is a banner nobody
              learns to look for. */}
          <EnforcementBanner
            mode={payload.mode}
            meaning={payload.modeMeaning}
            envVar={payload.modeEnvVar}
            enforced={payload.enforced}
          />

          {payload.withheldWithoutGate.length > 0 && (
            <section
              data-testid="no-gate-summary"
              className="rounded-lg border border-slate-700/60 bg-slate-800/30 p-4"
            >
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

          <section>
            <h2 className="mb-3 text-sm font-semibold text-white">The four plans</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {payload.plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Matrix version {payload.matrixVersion}. Two of these are tiers (something to buy) and
              two are cohorts (what somebody has while they are not paying).
            </p>
          </section>

          <NotBuiltPanel capabilities={payload.notBuilt} />

          <AccountLookup />

          <section className="rounded-lg border border-slate-700/60 p-4">
            <h2 className="text-sm font-semibold text-slate-300">Changing any of this</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Not from here. This page reads. What a plan includes is a configuration change in{' '}
              <span className="font-mono text-slate-300">
                lib/business-os/entitlements/config/tierMatrix.ts
              </span>{' '}
              — adding a capability to a tier is one line, removing one needs a recorded removal and
              a version bump. Per-account operations exist as audited API calls and are deliberately
              not buttons yet:
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {payload.writeOpsNotOnThisPage.map((operation) => (
                <li
                  key={operation}
                  className="rounded bg-slate-700/50 px-2 py-0.5 font-mono text-xs text-slate-400"
                >
                  {operation}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
