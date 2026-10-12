'use client';

/**
 * The Plans & entitlements KPI strip (Admin Layout Standard §7.8, K-1 to K-10).
 *
 * Four tiles, every figure from the page's one plans read (K-9), each a
 * same-page anchor to the part of the page that explains it (K-6). The tile
 * test ids are `kpi-*`, never a section's own ids (L-3 SA M-1).
 *
 * ── Colour (SA L-5 Q-1, D-4 (a)) ────────────────────────────────────────────
 * Every tile is neutral, the Enforcement tile included, in every mode. Health's
 * tile for the same fact is amber only when enforcement is requested and
 * refused, a fact this payload does not carry (K-5: no client copy of a server
 * rule), so an amber "Needs a look" for the normal production state would
 * contradict the landing page. The banner the tile links to keeps its own
 * amber / emerald signal.
 *
 * ── Available to buy, not "on sale" (SA L-5 Q-2) ────────────────────────────
 * The tile counts `availableToBuy` only, the flag the cards show as a chip with
 * the same words. `active` is an FYI marker that changes nothing, so combining
 * the two would be a rule no server code holds.
 *
 * Counts and flags only: no plan name, no capability id, no tier literal (the
 * screen's literal rule and the entitlements scans). No fetch here.
 */

import { KpiStrip, KpiTile } from '@/app/admin/components/layout/KpiStrip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';

import type { PlansPayload } from '../types';

/** The mode in words, first letter capitalised. Generic, not a lookup table of mode names. */
function modeInWords(mode: string): string {
  return mode.length === 0 ? mode : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
}

export interface PlansKpisProps {
  /** Null before the first read, and while the page shows an error (K-10). */
  payload: PlansPayload | null;
  /** A read is in flight. */
  loading: boolean;
}

export function PlansKpis({ payload, loading }: PlansKpisProps) {
  // K-10: placeholders while a read with nothing on screen is in flight; no
  // strip at all when there is nothing to show (the error says why).
  if (!payload) return loading ? <KpiStrip loading placeholderCount={4} /> : null;

  const planCount = payload.plans.length;
  const availableCount = payload.plans.filter((plan) => plan.availableToBuy).length;
  const noGateCount = payload.withheldWithoutGate.length;

  return (
    <KpiStrip>
      <KpiTile
        testId="kpi-enforcement"
        label="Enforcement"
        value={modeInWords(payload.mode)}
        sub={payload.enforced ? 'Enforced' : 'Not enforced'}
        href="#enforcement"
      />
      <KpiTile
        testId="kpi-available"
        label="Available to buy"
        value={formatCount(availableCount)}
        sub={`of ${formatCount(planCount)} ${planCount === 1 ? 'plan' : 'plans'}`}
        href="#plans"
      />
      {/* The summary section is not rendered when nothing is withheld without
          a gate, so the tile then has no target (K-6): a group, not a link. */}
      {noGateCount > 0 ? (
        <KpiTile
          testId="kpi-no-gate"
          label="Withheld with no gate"
          value={formatCount(noGateCount)}
          href="#withheld-without-gate"
        />
      ) : (
        <KpiTile testId="kpi-no-gate" label="Withheld with no gate" value={formatCount(noGateCount)} />
      )}
      <KpiTile
        testId="kpi-not-built"
        label="Cannot be sold"
        value={formatCount(payload.notBuilt.length)}
        href="#not-built"
      />
    </KpiStrip>
  );
}
