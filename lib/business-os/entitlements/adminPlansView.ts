import 'server-only';

/**
 * What the Business OS Tiers admin screen reads.
 *
 * ── The one rule this module exists to keep ─────────────────────────────────
 * **The screen must never be able to disagree with the resolver.**
 *
 * So it does not read the tier matrix and describe it. It builds a synthetic
 * account for each plan and RESOLVES it, through `resolveEntitlements` — the
 * same function the product would call. The page therefore shows what an
 * account on that plan would actually get, which is not the same thing as the
 * row in the matrix:
 *
 *   - a COHORT has no row at all. Each one resolves through the tier row its
 *     `base` points at, so a screen that rendered rows would have nothing to
 *     show for the cohorts — half the plans (FR-12 forbids naming them here);
 *   - the `beta` overlay and the `not_built` clamp are applied at resolution,
 *     so a row can say one thing and the customer get another;
 *   - "includes" is decided by `isGrantingValue` — the loader's own function,
 *     the one that refuses a tier granting a `not_built` capability. The screen
 *     asks the question with the same code that enforces it.
 *
 * Everything derived is derived HERE, server-side, and shipped as a field. The
 * page renders strings and booleans it is given; it computes nothing. That is
 * why `server-only` is the first line: an accidental client import is then a
 * build error rather than a review finding.
 *
 * ── Read-only ───────────────────────────────────────────────────────────────
 * Nothing here writes, and nothing here reads the database. It is pure config
 * plus `getEntitlementMode()`, which reads one environment variable.
 *
 * @see docs/workplans/business-os-tiers-admin-page.md
 */

import { describeCapabilityValue } from './capabilityDisplay';
import {
  describePlanCapabilities,
  describePlanEnding,
  planCommercialFlags,
  planInheritsFrom,
  planLabel,
  planMonthlyPriceUsd,
  previewAccountFor,
  type PlanCapabilityRow,
} from './planPresentation';
import { getEntitlementConfig } from './source';
import { getEntitlementMode, MODE_ENV_VAR } from './mode';
import { resolveEntitlements } from './resolver';
import type { CapabilityDef, CapabilityValue } from './types';

// Re-exported because this module was the original home and its own tests (and
// the customer surface's, indirectly) import it from here. Moving the symbol
// without leaving the door open would have made an extraction look like a
// rewrite in the diff.
export { previewAccountFor } from './planPresentation';

/**
 * One capability, as the screen shows it.
 *
 * The shared row (`planPresentation`), not a second definition: the admin screen
 * and the customer's settings must not be able to disagree about what a value
 * says. This screen is the one that also renders `gateBuilt` — "the plan says no
 * and nothing asks" — which is an operator's fact, not a customer's.
 */
export type AdminPlanCapability = PlanCapabilityRow;

/** One of the four plans. */
export interface AdminPlanView {
  id: string;
  /** A tier is something you buy. A cohort is what you have while you do not. */
  kind: 'tier' | 'cohort';
  name: string;
  monthlyPriceUsd: number;
  /** For a cohort, the tier it inherits from — `null` for a tier. */
  inheritsFrom: string | null;
  aiActions: string;
  endsWhen: string;
  /**
   * Is this plan public, and is it sellable? (user decision, 2026-09-27)
   *
   * Two questions with different answers, and an operator needs both at a glance:
   * "which plans can a customer see" and "which can a customer buy" are asked
   * separately in support and in a pricing conversation. Read through
   * `planCommercialFlags`, the same function the customer surface reads, so the
   * screen cannot disagree with what a customer is actually offered.
   *
   * A cohort is not a product, so both are `false` for one — which is a fact
   * about being offered, not about the accounts on it.
   */
  shownToCustomers: boolean;
  availableToBuy: boolean;
  /** What the resolver calls an account on this plan today. */
  state: string;
  /** Which layer the resolution stands on: a tier, a cohort, or nothing. */
  basis: string;
  includes: AdminPlanCapability[];
  withholds: AdminPlanCapability[];
}

/** A capability that cannot be sold at all, and why. */
export interface AdminNotBuiltCapability {
  capability: string;
  label: string;
  category: string;
  note: string;
}

export interface AdminPlansPayload {
  generatedAt: string;
  mode: 'off' | 'shadow' | 'enforce';
  modeEnvVar: string;
  /** Plain words for the mode that is actually set. Built here, not guessed there. */
  modeMeaning: string;
  enforced: boolean;
  matrixVersion: number;
  /**
   * Capabilities a plan withholds that nothing would refuse (SA R-1).
   *
   * Stated once as well as marked per capability, so the size of the gap is
   * visible without opening four cards. Empty means every withheld capability
   * has a gate — at which point the markers disappear on their own.
   */
  withheldWithoutGate: string[];
  plans: AdminPlanView[];
  notBuilt: AdminNotBuiltCapability[];
  /** Operations that exist in the API and are deliberately not on this screen. */
  writeOpsNotOnThisPage: string[];
}

/** Plain words for the mode that is actually set, so the page states no default. */
function describeMode(mode: 'off' | 'shadow' | 'enforce'): string {
  if (mode === 'off') {
    return 'Nothing is resolved, nothing is recorded and nothing is blocked. The plans below describe an intention, not a behaviour.';
  }
  if (mode === 'shadow') {
    return 'Usage is resolved and recorded so it can be measured. NOTHING IS BLOCKED — every customer keeps every feature, whatever their plan says below.';
  }
  return 'Decisions are acted on: an account without a capability is refused it.';
}

/** The whole payload. One config read, four resolutions, no database. */
export function buildAdminPlansView(now: Date = new Date()): AdminPlansPayload {
  const config = getEntitlementConfig();
  const catalog = config.catalog as Record<string, CapabilityDef>;
  const mode = getEntitlementMode();

  // Free first, then the paid tiers cheapest first — the order the user reads
  // them in, and the order `TIER_ORDER` already defines for the paid half.
  const planIds = [...Object.keys(config.cohorts), ...config.tierOrder];

  const plans = planIds.map((planId): AdminPlanView => {
    const isTier = config.tierOrder.includes(planId);
    const resolution = resolveEntitlements({
      config,
      account: previewAccountFor(config, planId, now),
      overrides: [],
      addons: [],
      now,
    });

    const capabilities = describePlanCapabilities(resolution, catalog);
    const aiActions = resolution.values['ai.actions'];

    return {
      id: planId,
      kind: isTier ? 'tier' : 'cohort',
      name: planLabel(config, planId),
      monthlyPriceUsd: planMonthlyPriceUsd(config, planId),
      inheritsFrom: planInheritsFrom(config, planId),
      aiActions: aiActions ? describeCapabilityValue(aiActions.value, catalog['ai.actions']) : 'not configured',
      endsWhen: describePlanEnding(config, planId, aiActions?.value as CapabilityValue),
      ...planCommercialFlags(config, planId),
      state: resolution.state,
      basis: resolution.basis.kind,
      includes: capabilities.filter((entry) => entry.granting),
      withholds: capabilities.filter((entry) => !entry.granting),
    };
  });

  // Every capability that some plan withholds, that EXISTS, and that nothing
  // enforces (SA R-1, narrowed by QA NEW-1).
  //
  // De-duplicated and sorted: it is a set of capabilities, not a count of
  // cards. It empties itself as gates are built, because `gateBuilt` is read
  // from `ENFORCEMENT_POINTS` rather than written down anywhere — and it never
  // overlaps `notBuilt`, which is the other panel's subject.
  const withheldWithoutGate = [
    ...new Set(
      plans.flatMap((plan) =>
        plan.withholds.filter((entry) => !entry.gateBuilt).map((entry) => entry.capability)
      )
    ),
  ].sort();

  const notBuilt = Object.entries(catalog)
    .filter(([, definition]) => definition.lifecycle === 'not_built')
    .map(([capability, definition]) => ({
      capability,
      label: definition.labels.en,
      category: definition.category,
      note: definition.note ?? 'No evidence recorded in the catalog.',
    }));

  return {
    generatedAt: now.toISOString(),
    mode,
    modeEnvVar: MODE_ENV_VAR,
    modeMeaning: describeMode(mode),
    enforced: mode === 'enforce',
    matrixVersion: config.matrix.version,
    withheldWithoutGate,
    plans,
    notBuilt,
    // Named rather than hidden: the operations exist, they are audited, and
    // this screen deliberately does not offer them (v1 is read-only).
    writeOpsNotOnThisPage: [
      'assign_tier',
      'set_cohort',
      'set_expiry',
      'add_override',
      'end_override',
      'reset_plan_state',
      'launch_champion_existing',
    ],
  };
}
