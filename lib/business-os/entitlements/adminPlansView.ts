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
import { hasEnforcementPoint } from './config/enforcementPoints';
import { getEntitlementConfig } from './source';
import { getEntitlementMode, MODE_ENV_VAR } from './mode';
import { resolveEntitlements } from './resolver';
import { isGrantingValue } from './schema';
import type { EntitlementAccount } from './account';
import type { EntitlementConfig } from './source';
import type { CapabilityDef, CapabilityValue } from './types';

/** One capability, as the screen shows it. */
export interface AdminPlanCapability {
  capability: string;
  label: string;
  category: string;
  /** Rendered server-side: the page never formats a value itself. */
  display: string;
  /** `isGrantingValue` — the same question the config loader asks. */
  granting: boolean;
  /**
   * Does anything in the product actually refuse this capability (SA R-1)?
   *
   * Withheld in the matrix and enforced are different facts. `false` means the
   * plan says no and nothing asks — which the page must say AT the capability,
   * not only in a banner about the mode. Read from `ENFORCEMENT_POINTS`, whose
   * entries are checked against the source in both directions, so it clears
   * itself in the commit that makes it false.
   */
  gateBuilt: boolean;
}

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

/**
 * The account each plan is previewed as. Exported for its test.
 *
 * QA (2026-09-24) mutated this function and the suite stayed green, because the
 * test rebuilt the same object and compared the result to itself. It is
 * exported now so the 11 fields can be ASSERTED — and the resolved `state` and
 * `basis` are pinned separately, because those are outputs that a wrong
 * synthetic changes and a copied mistake cannot fake.
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
function describeEnding(
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

  const clock = cohort.clockStartsAt === 'profile_created' ? 'the business profile is created' : 'the first onboarding message';

  return isOneOffAllowance
    ? `${duration.days} days from ${clock}, or when the AI actions run out — whichever comes first.`
    : `${duration.days} days from ${clock}.`;
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

    const capabilities = Object.entries(resolution.values).map(([capability, resolved]) => {
      const definition = catalog[capability];
      return {
        capability,
        label: definition.labels.en,
        category: definition.category,
        display: describeCapabilityValue(resolved.value, definition),
        granting: isGrantingValue(resolved.value, definition),
        // A `not_built` capability needs no gate: there is nothing to refuse.
        // Marking it "nothing in the product refuses it yet" reads as "a
        // customer could get this", on the same screen that says it cannot be
        // sold at all (QA NEW-1) — and it buried the one capability the marker
        // exists for in a list of nineteen.
        gateBuilt: definition.lifecycle === 'not_built' || hasEnforcementPoint(capability),
      };
    });

    const presentation = isTier
      ? config.matrix.presentation[planId as keyof typeof config.matrix.presentation]
      : undefined;
    const cohort = isTier ? undefined : config.cohorts[planId as keyof typeof config.cohorts];
    const base = cohort?.base as { tier?: string } | undefined;
    const aiActions = resolution.values['ai.actions'];

    return {
      id: planId,
      kind: isTier ? 'tier' : 'cohort',
      name: (presentation?.labels ?? cohort?.labels)?.en ?? planId,
      // A cohort is what somebody has while they are NOT paying, so the price
      // is zero by definition rather than by omission.
      monthlyPriceUsd: presentation?.monthlyPriceUsd ?? 0,
      inheritsFrom: base?.tier ?? null,
      aiActions: aiActions ? describeCapabilityValue(aiActions.value, catalog['ai.actions']) : 'not configured',
      endsWhen: describeEnding(config, planId, aiActions?.value as CapabilityValue),
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
