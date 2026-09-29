import 'server-only';

/**
 * How a PLAN is described to a human — shared by the admin screen and the
 * customer's own settings.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * `adminPlansView` already answered "what does this plan include?" the only
 * honest way: build a synthetic account, resolve it through
 * `resolveEntitlements`, and read the answer. The customer-facing section needs
 * the same answer about the same plans.
 *
 * Copying it would have produced two descriptions of one price list, and the
 * failure mode is not that they look different — it is that the admin screen
 * and the customer's settings eventually disagree about what the customer is
 * paying for. So the derivation moved here and both surfaces import it.
 *
 * What each surface still owns is **what it chooses to show**: the admin screen
 * shows every capability including the ones nothing enforces yet; the customer
 * section shows a shorter, plainer list. That is a filtering decision and it
 * belongs to the surface. The values, the labels and the sentences do not.
 *
 * ── Read-only, and server-only ──────────────────────────────────────────────
 * Nothing here writes, and nothing here reads the database. `server-only` is the
 * first line for the reason `adminPlansView` has it: a client import is then a
 * build error rather than a review finding, and neither page can re-derive a
 * rule that already exists here.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import { describeCapabilityValue } from './capabilityDisplay';
import { hasEnforcementPoint } from './config/enforcementPoints';
import { isGrantingValue } from './schema';
import type { EntitlementAccount } from './account';
import type { EntitlementResolution } from './resolver';
import type { EntitlementConfig } from './source';
import type { CapabilityDef, CapabilityValue } from './types';

/**
 * One capability, as either surface shows it.
 *
 * `display` is rendered here so no page formats a value itself, and `granting`
 * is `isGrantingValue` — the config loader's own function, so "includes" is
 * decided by the code that enforces it rather than by a second opinion.
 */
export interface PlanCapabilityRow {
  capability: string;
  label: string;
  category: string;
  display: string;
  granting: boolean;
  /**
   * Does anything in the product actually refuse this capability?
   *
   * Withheld in the matrix and enforced are different facts. Read from
   * `ENFORCEMENT_POINTS`, whose entries are checked against the source in both
   * directions, so it clears itself in the commit that makes it false.
   *
   * The admin screen shows this. The customer section does **not** — see
   * `customerPlanView`, which refuses to describe a restriction that does not
   * exist rather than annotating it.
   */
  gateBuilt: boolean;
}

/**
 * The account each plan is previewed as.
 *
 * QA (2026-09-24) mutated this function and the suite stayed green, because the
 * test rebuilt the same object and compared the result to itself. It is exported
 * so the 11 fields can be ASSERTED — and the resolved `state` and `basis` are
 * pinned separately, because those are outputs that a wrong synthetic changes
 * and a copied mistake cannot fake.
 *
 * A fixed instant, so two plans are never resolved a millisecond apart.
 */
export function previewAccountFor(
  config: EntitlementConfig,
  planId: string,
  now: Date
): EntitlementAccount {
  const isTier = config.tierOrder.includes(planId);
  const iso = now.toISOString();

  return {
    accountId: `preview-${planId}`,
    tier: isTier ? planId : null,
    planVersion: isTier ? config.matrix.version : 0,
    tierExpiresAt: null,
    cohort: isTier ? null : planId,
    cohortExpiresAt: null,
    // The facts a real account would carry. Dated NOW so a trial preview is a
    // trial that has just started, rather than one that expired years ago.
    onboardingStartedAt: iso,
    profileCreatedAt: iso,
    trialStartedAt: isTier ? null : iso,
    trialEndsAt: null,
    graceEndsAt: null,
  };
}

/**
 * When a plan ends, in one sentence, **read off the configuration**.
 *
 * Not written down per plan: a cohort with a duration history says how long it
 * lasts, a cohort without one has no end date, and a tier has neither because
 * its end date is a per-account fact (`tier_expires_at`). If somebody shortens
 * the trial in config, this sentence changes with it.
 */
export function describePlanEnding(
  config: EntitlementConfig,
  planId: string,
  aiActionsValue: CapabilityValue
): string {
  if (config.tierOrder.includes(planId)) {
    return 'While the plan is paid for. An admin can set an end date on one account.';
  }

  const cohort = config.cohorts[planId as keyof typeof config.cohorts];
  const duration = cohort?.durationHistory?.[cohort.durationHistory.length - 1];

  if (!duration) {
    return 'No end date unless an admin sets one.';
  }

  // A one-off TOTAL is what makes running out an ENDING (FR-27); a monthly rate
  // simply resets. The difference is in the value, so the sentence reads it.
  const isOneOffAllowance =
    !!aiActionsValue && typeof aiActionsValue === 'object' && 'total' in (aiActionsValue as object);

  const clock =
    cohort.clockStartsAt === 'profile_created' ? 'the business profile is created' : 'the first onboarding message';

  return isOneOffAllowance
    ? `${duration.days} days from ${clock}, or when the AI actions run out — whichever comes first.`
    : `${duration.days} days from ${clock}.`;
}

/**
 * Every capability in a resolution, described.
 *
 * Takes a resolution rather than a plan id, so it serves both a synthetic plan
 * preview and a REAL account read through `EntitlementService.getSnapshot` —
 * which is the whole reason the customer section can use the resolver the
 * system uses instead of a description of it.
 */
export function describePlanCapabilities(
  resolution: EntitlementResolution,
  catalog: Record<string, CapabilityDef>
): PlanCapabilityRow[] {
  return Object.entries(resolution.values).map(([capability, resolved]) => {
    const definition = catalog[capability];

    return {
      capability,
      label: definition.labels.en,
      category: definition.category,
      display: describeCapabilityValue(resolved.value, definition),
      granting: isGrantingValue(resolved.value, definition),
      // A `not_built` capability needs no gate: there is nothing to refuse.
      // Marking it "nothing in the product refuses it yet" reads as "a customer
      // could get this", on the same screen that says it cannot be sold at all
      // (QA NEW-1) — and it buried the one capability the marker exists for in
      // a list of nineteen.
      gateBuilt: definition.lifecycle === 'not_built' || hasEnforcementPoint(capability),
    };
  });
}

/**
 * The marketing name of a plan, tier or cohort, from config. Never hard-coded.
 *
 * The `isTier` branch is explicit (SA P-3). Without it the fallback chain runs
 * on to the cohort labels for a TIER whose `presentation` entry is missing —
 * unreachable today only because the config loader requires one for every tier,
 * which moves this function's correctness into an invariant in another file. A
 * tier with no presentation should fall back to its own id, not borrow a
 * cohort's name.
 */
export function planLabel(config: EntitlementConfig, planId: string): string {
  const isTier = config.tierOrder.includes(planId);

  if (isTier) {
    const presentation = config.matrix.presentation[planId as keyof typeof config.matrix.presentation];
    return presentation?.labels?.en ?? planId;
  }

  return config.cohorts[planId as keyof typeof config.cohorts]?.labels?.en ?? planId;
}

/**
 * The monthly price, or zero.
 *
 * A cohort is what somebody has while they are NOT paying, so zero is by
 * definition rather than by omission.
 */
export function planMonthlyPriceUsd(config: EntitlementConfig, planId: string): number {
  const presentation = config.tierOrder.includes(planId)
    ? config.matrix.presentation[planId as keyof typeof config.matrix.presentation]
    : undefined;

  return presentation?.monthlyPriceUsd ?? 0;
}

/**
 * The two commercial flags for a plan (user decision, 2026-09-27).
 *
 * A **cohort** is not a product: nobody is shown "Founding Partner" as a plan to
 * choose and nobody buys it, so it is `shownToCustomers: false` and
 * `availableToBuy: false` here. That is not a hidden plan — a customer ON a
 * cohort is still told what they are on, by `customerPlanView`, which reads the
 * cohort's own label. These flags answer "may this plan be OFFERED?".
 *
 * One reader, so the customer surface and the admin screen cannot disagree about
 * which plans are public and which are sellable.
 */
export function planCommercialFlags(
  config: EntitlementConfig,
  planId: string
): { shownToCustomers: boolean; availableToBuy: boolean } {
  if (!config.tierOrder.includes(planId)) {
    return { shownToCustomers: false, availableToBuy: false };
  }

  const presentation = config.matrix.presentation[planId as keyof typeof config.matrix.presentation];

  return {
    shownToCustomers: presentation?.shownToCustomers ?? false,
    availableToBuy: presentation?.availableToBuy ?? false,
  };
}

/**
 * Is this plan active? The ONE reader, for tiers and cohorts alike.
 *
 * The flag lives in two places because the plans do — a tier's `presentation`
 * block, a cohort's own config beside its `labels` — and this is the only
 * function that knows which, the way `planCommercialFlags` is for the tier flags.
 *
 * **FYI only (2026-09-29).** Read by the admin Tiers page and by nothing that
 * decides anything; `planActive.noEffect.test.ts` holds that. `false` for an
 * unknown id, which cannot happen for a validated config.
 */
export function planActive(config: EntitlementConfig, planId: string): boolean {
  if (config.tierOrder.includes(planId)) {
    return config.matrix.presentation[planId as keyof typeof config.matrix.presentation]?.active ?? false;
  }

  return config.cohorts[planId as keyof typeof config.cohorts]?.active ?? false;
}

/** For a cohort, the tier it resolves through. `null` for a tier. */
export function planInheritsFrom(config: EntitlementConfig, planId: string): string | null {
  if (config.tierOrder.includes(planId)) return null;

  const base = config.cohorts[planId as keyof typeof config.cohorts]?.base as { tier?: string } | undefined;
  return base?.tier ?? null;
}
