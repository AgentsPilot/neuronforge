import 'server-only';

/**
 * The plans ONE account's row records, named and related, for the admin plan
 * card in the Businesses drawer.
 *
 * ── Why the server answers this ─────────────────────────────────────────────
 * The card says, in plain words, which plan is deciding access ("Running on:
 * Essentials"), what free access sits underneath it, and whether that free
 * access would take over if the paid plan is not renewed. Three facts the
 * admin screen cannot work out on its own:
 *
 *   - the plan NAMES live in config and are read by `planLabel`, which is
 *     `server-only`;
 *   - "would the cohort take over" is a lifecycle question (a trial's end is
 *     derived from its start and duration history, and a paid plan's end has a
 *     renewal settlement margin), and the screen must not answer a lifecycle
 *     question with a second rule;
 *   - "is the paid plan lower than the free access" is a comparison along the
 *     config tier order and the cohort's `base`.
 *
 * So the route sends the answers. Every one of them comes from the function
 * that already owns it: `planLabel` / `planInheritsFrom` for names and bases,
 * `deriveLifecycle` for whether the cohort is live, `tierSettlementEndsAt` for
 * when the paid plan really ends. Nothing here re-decides precedence: the
 * resolver's `basis` still says which plan is deciding, and the card reads it.
 *
 * Read-only and pure given `(config, row, now)`; it refuses nothing, so it is
 * not a gate.
 */

import { fromPlanRow, type EntitlementAccount } from './account';
import { deriveLifecycle, tierSettlementEndsAt } from './lifecycle';
import { planInheritsFrom, planLabel } from './planPresentation';
import type { EntitlementConfig } from './source';

/** A plan id and its config name. */
export interface AdminPlanName {
  id: string;
  name: string;
}

/** The cohort the row records, as if no paid plan were on top of it. */
export interface AdminAccountCohort extends AdminPlanName {
  /**
   * When the free access ends on its own: the admin-set end date, or a trial's
   * derived end. `null` when it has no end date (or a trial has not started).
   */
  endsAt: string | null;
  /** Is the free access live right now, ignoring any paid plan? */
  liveNow: boolean;
  /**
   * Is it still live when the paid plan's dated end (plus the renewal
   * settlement margin) passes, i.e. does it take over if the paid plan is not
   * renewed? `null` when there is no dated paid plan to outlive.
   */
  outlivesTier: boolean | null;
  /** The paid plan this free access resolves through, when it names one. */
  base: AdminPlanName | null;
}

export interface AdminAccountPlans {
  tier: AdminPlanName | null;
  cohort: AdminAccountCohort | null;
  /**
   * The recorded paid plan sits LOWER in the config tier order than the
   * cohort's base: paying gives the account less than its free access would.
   */
  tierBelowCohortBase: boolean;
}

type PlanRow = Parameters<typeof fromPlanRow>[0];

function lifecycleInputsOf(config: EntitlementConfig) {
  return {
    cohorts: config.cohorts,
    tierOrder: config.tierOrder,
    subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory,
    renewalSettlementMarginHistory: config.lifecycle.renewalSettlementMarginHistory,
  };
}

/**
 * The cohort on its own at `at`, through the resolver's own lifecycle: the
 * account with its paid plan taken away. Live means the cohort is the basis
 * and the account is not in grace or paused; an anomaly (an unknown cohort, a
 * trial with no clock) is not live.
 */
function cohortAlone(
  account: EntitlementAccount,
  config: EntitlementConfig,
  at: Date
): { live: boolean; endsAt: string | null } {
  const result = deriveLifecycle({ ...account, tier: null, tierExpiresAt: null }, lifecycleInputsOf(config), at);
  const live = result.basis.kind === 'cohort' && result.state !== 'grace' && result.state !== 'paused';
  return { live, endsAt: result.accessEndsAt };
}

function rankOf(config: EntitlementConfig, tierId: string | null): number {
  return tierId === null ? -1 : config.tierOrder.indexOf(tierId);
}

export function describeAccountPlans(
  config: EntitlementConfig,
  row: PlanRow | null,
  now: Date
): AdminAccountPlans {
  if (!row) return { tier: null, cohort: null, tierBelowCohortBase: false };

  const account = fromPlanRow(row);
  // An empty string is no assignment, as `deriveLifecycle` reads it.
  const tierId = account.tier || null;
  const cohortId = account.cohort || null;

  const tier: AdminPlanName | null = tierId ? { id: tierId, name: planLabel(config, tierId) } : null;

  let cohort: AdminAccountCohort | null = null;
  let tierBelowCohortBase = false;

  if (cohortId) {
    const current = cohortAlone(account, config, now);

    let outlivesTier: boolean | null = null;
    if (tierId && account.tierExpiresAt) {
      const tierEndsAt = tierSettlementEndsAt(
        account.tierExpiresAt,
        config.lifecycle.renewalSettlementMarginHistory
      );
      outlivesTier = cohortAlone(account, config, new Date(tierEndsAt)).live;
    }

    const baseId = planInheritsFrom(config, cohortId);
    cohort = {
      id: cohortId,
      name: planLabel(config, cohortId),
      endsAt: current.endsAt,
      liveNow: current.live,
      outlivesTier,
      base: baseId ? { id: baseId, name: planLabel(config, baseId) } : null,
    };

    const tierRank = rankOf(config, tierId);
    const baseRank = rankOf(config, baseId);
    tierBelowCohortBase = tierRank >= 0 && baseRank >= 0 && tierRank < baseRank;
  }

  return { tier, cohort, tierBelowCohortBase };
}
