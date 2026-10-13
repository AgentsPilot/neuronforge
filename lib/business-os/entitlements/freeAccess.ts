/**
 * Free access with no end date (plan payments P-4.1, BQ-P10 "Refuse until end
 * date set"; SA rulings Q-1 and Q-7).
 *
 * A pure, STRUCTURAL reading of an entitlement resolution. It answers one
 * question the checkout asks before it sells a plan: is this account on free
 * access that an admin has not given an end date? Buying a plan would then end
 * free access the account was promised without a date, which the user decided
 * to refuse (BQ-P10) until an admin sets one.
 *
 * The rule, with no cohort id written anywhere (FR-12 spirit, and the
 * `business-os-entitlements` skill):
 *
 *   1. the resolution's basis is a cohort;
 *   2. that cohort has NO `durationHistory` in the config: its end is set per
 *      account by an admin. A cohort with a duration (a trial) always has an end
 *      and is never caught. A cohort the config does not know has no duration
 *      either, so it is caught: fail closed, nothing is sold on a guess;
 *   3. the resolved access end (`lifecycle.accessEndsAt`) is `null`.
 *
 * Not caught, on purpose (SA Q-1): an account whose admin-assigned tier is in
 * force resolves with a TIER basis, so free access is already suspended behind
 * that tier and buying ends none of it. The moment that tier lapses, the cohort
 * is the basis again with no end date, and the rule catches it.
 *
 * The cohort config is a parameter (production default), so a fixture config
 * with renamed cohorts proves no name is read.
 *
 * @module lib/business-os/entitlements/freeAccess
 */

import { COHORTS, type CohortConfig } from './config/cohorts';
import type { EntitlementBasis } from './lifecycle';

/** The two facts of a resolution this reads. `EntitlementResolution` satisfies it. */
export interface FreeAccessResolutionLike {
  basis: EntitlementBasis;
  lifecycle: { accessEndsAt: string | null };
}

/** The cohort config, keyed by cohort id. Only `durationHistory` is read. */
export type FreeAccessCohortConfig = Readonly<Record<string, CohortConfig>>;

/**
 * True when the account is on free access with no end date (BQ-P10): the
 * checkout refuses `free_access_no_end_date` and sells nothing.
 */
export function hasOpenEndedFreeAccess(
  resolution: FreeAccessResolutionLike,
  cohorts: FreeAccessCohortConfig = COHORTS
): boolean {
  const { basis } = resolution;
  if (basis.kind !== 'cohort') return false;
  const cohort = Object.prototype.hasOwnProperty.call(cohorts, basis.cohort) ? cohorts[basis.cohort] : undefined;
  if (cohort?.durationHistory) return false;
  return resolution.lifecycle.accessEndsAt === null;
}

/**
 * What free access a purchase would end TODAY (plan payments P-4.2, M-8;
 * SA Q-3 / W-7), for the sentence beside the Choose list:
 *
 *   timed        a LIVE cohort that has a duration (a trial): BQ-P2's
 *                "Buying ends your free trial today…";
 *   admin_dated  a LIVE admin-dated cohort (no duration) with an end date:
 *                "Buying ends your free access today…" (until P-11 gives a
 *                Founding Partner the rest of their free days);
 *   null         anything else: a tier basis (nothing free is ended), a cohort
 *                already past its end (in grace), or open-ended free access
 *                (BQ-P10 refuses that sale, so no sentence is needed).
 *
 * The values name the STRUCTURE, not a cohort, so this file stays free of any
 * cohort id (its test checks); `planPurchaseView.ts` maps them to the payload's
 * words. "Live" is read from the resolution's own access end, never from a
 * state name: no end yet (a trial whose clock has not started), or an end
 * still in the future. A cohort the config does not know is treated as
 * admin-dated (it has no duration).
 */
export type FreeAccessEndedByPurchase = 'timed' | 'admin_dated' | null;

export function freeAccessEndedByPurchase(
  resolution: FreeAccessResolutionLike,
  now: Date,
  cohorts: FreeAccessCohortConfig = COHORTS
): FreeAccessEndedByPurchase {
  const { basis } = resolution;
  if (basis.kind !== 'cohort') return null;

  const endsAt = resolution.lifecycle.accessEndsAt;
  const endsAtMs = endsAt === null ? null : Date.parse(endsAt);
  // An unreadable end is not a promise we can describe: say nothing.
  if (endsAtMs !== null && !Number.isFinite(endsAtMs)) return null;
  const live = endsAtMs === null || endsAtMs > now.getTime();
  if (!live) return null;

  const cohort = Object.prototype.hasOwnProperty.call(cohorts, basis.cohort) ? cohorts[basis.cohort] : undefined;
  if (cohort?.durationHistory) return 'timed';
  // Admin-dated: with no end date this is BQ-P10's case, refused, so no sentence.
  return endsAtMs === null ? null : 'admin_dated';
}
