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
import { defaultLocale, type Locale } from '@/lib/i18n/config';

/** One row of "what the plan includes": a category and its features, joined. */
export interface PlanOfferCategory {
  category: string;
  /**
   * The dictionary KEY for the category heading, not the heading itself.
   *
   * This module is inside `entitlements` and cannot reach the platform's
   * translations, so it names the heading and lets the surface render it. The
   * invite page carries its own dictionary (`invitePageCopy.ts`) because it
   * renders in the INVITE's language rather than the viewer's.
   */
  labelKey: string;
  /**
   * A dictionary KEY for the sentence under the row, or `null` (credit deduction
   * slice 6, D-h; SA Q-9). Today only the credits row has one — the sentence
   * saying what a credit is, monthly or one-off by the allowance's shape. The
   * invite page words it from its own dictionary, like the heading.
   */
  noteKey: string | null;
  /**
   * The row's features by name and formatted value — no capability ids, since
   * this reaches a public page. Sent so the surface can apply its one
   * presentation rule (`lib/business-os/planCategoryLine.ts`): a category whose
   * only feature is named like its heading prints the value alone, not
   * "Credits: Credits (…)" (user decision, 2026-10-02). Only the surface knows
   * the heading's words, so only the surface can compare them.
   */
  features: Array<{ label: string; value: string }>;
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
 *
 * `locale` (OI-10): plan and feature names and the value phrases ("per month",
 * "in total") in that language, numbers grouped by it. The invite page passes
 * the invite's own language; the default is English.
 */
export function describePlanOffer(
  config: EntitlementConfig,
  planId: string,
  now: Date,
  locale: Locale = defaultLocale
): PlanOffer {
  const catalog = config.catalog as Record<string, CapabilityDef>;
  const resolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, now),
    overrides: [],
    addons: [],
    now,
  });

  // The customer's own display rule: granting and not hidden. The credit
  // allowance is shown with its number, read off config through the resolver.
  const features = describePlanCapabilities(resolution, catalog, locale)
    .filter((row) => row.granting && !isHiddenFromCustomer(row.capability, catalog[row.capability]))
    .map((row) => ({ capability: row.capability, label: row.label, value: row.display }));

  return {
    planName: planLabel(config, planId, locale),
    free: !config.tierOrder.includes(planId),
    monthlyPriceUsd: planMonthlyPriceUsd(config, planId),
    included: groupByCategory(features, catalog, (capability) => resolution.values[capability]?.value).map((row) => ({
      category: row.category,
      labelKey: row.labelKey,
      noteKey: row.noteKey,
      features: row.features.map((feature) => ({ label: feature.label, value: feature.value })),
      summary: row.summary,
    })),
  };
}
