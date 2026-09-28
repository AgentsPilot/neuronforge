import 'server-only';

/**
 * What a plan OFFERS, described for someone who does not have it yet — the
 * invite page's "what you are offered" (invite-only signup, Slice 0; SA M-3).
 *
 * ── Why this lives inside the entitlements module ───────────────────────────
 * Describing a plan honestly means resolving it: a synthetic account on that
 * plan (`previewAccountFor`) through `resolveEntitlements`, then the same
 * presentation helpers the admin Tiers screen and the customer "Your plan"
 * section use. `resolveEntitlements` is the one symbol a capability gate would
 * reach through, so no file OUTSIDE this module imports it
 * (`enforcementPoints.test.ts` allow-lists importers by exact symbol). Callers
 * outside get this read-only view instead, which can describe a plan and can
 * refuse nothing.
 *
 * Read-only and pure: no I/O, no account, no database. It takes a plan id from
 * config, never a user id.
 */

import { groupByCategory, isHiddenFromCustomer } from './customerPlanView';
import { describePlanCapabilities, planLabel, planMonthlyPriceUsd, previewAccountFor } from './planPresentation';
import { resolveEntitlements } from './resolver';
import type { EntitlementConfig } from './source';
import type { CapabilityDef } from './types';

/** One row of "what the plan includes": a category and its features, joined. */
export interface PlanOfferCategory {
  category: string;
  label: string;
  summary: string;
}

/** A plan as an offer: its name, its price, and what it includes. */
export interface PlanOffer {
  planName: string;
  /** A cohort is what somebody has while NOT paying, so it is free by definition. */
  free: boolean;
  monthlyPriceUsd: number;
  included: PlanOfferCategory[];
}

/**
 * Describe `planId` (a tier or a cohort in `config`) as an offer.
 *
 * Only granting capabilities a customer may be told about are listed
 * (`isHiddenFromCustomer`, the customer section's own rule), grouped by
 * category. Nothing withheld is named.
 */
export function describePlanOffer(config: EntitlementConfig, planId: string, now: Date): PlanOffer {
  const catalog = config.catalog as Record<string, CapabilityDef>;
  const resolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, now),
    overrides: [],
    addons: [],
    now,
  });

  const features = describePlanCapabilities(resolution, catalog)
    .filter((row) => row.granting && !isHiddenFromCustomer(row.capability, catalog[row.capability]))
    .map((row) => ({ capability: row.capability, label: row.label, value: row.display }));

  return {
    planName: planLabel(config, planId),
    free: !config.tierOrder.includes(planId),
    monthlyPriceUsd: planMonthlyPriceUsd(config, planId),
    included: groupByCategory(features, catalog).map((row) => ({
      category: row.category,
      label: row.label,
      summary: row.summary,
    })),
  };
}
