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
import type { EntitlementAccount } from './account';
import {
  deriveLifecycle,
  tierSettlementEndsAt,
  type EntitlementBasis,
  type LifecycleInputs,
  type LifecycleResult,
} from './lifecycle';

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

/**
 * The free access an account goes back to when its DATED paid tier lapses
 * (plan payments P-7a.3, BQ-5; SA note on BQ-5 and deviation 5 of P-7a.1), for
 * the sentence a cancelling owner reads in Settings → Plan: "Then you go back
 * to your Founding Partner free access, which runs until {freeUntil}."
 *
 * Answered through the resolver's OWN lifecycle (`deriveLifecycle`) at the
 * moment the tier really ends, its paid-through date plus the renewal
 * settlement margin (`tierSettlementEndsAt`, PF-10), so the sentence can never
 * promise what the lifecycle will not do (AC-F8.3). Not a second rule.
 *
 *   { endsAt }   at that moment the basis is an admin-dated cohort (no
 *                duration in the config: the Founding Partner shape), it is
 *                live (not grace / paused), and its end date is LATER than the
 *                moment (BQ-5's "free-access end after paid-through + 24 h")
 *   null         anything else: no dated tier, no cohort, a timed cohort (a
 *                trial is not "Founding Partner free access"), an unknown
 *                cohort, a cohort that has ended by then, or open-ended free
 *                access (there is no date to name; BQ-P10 refuses selling a
 *                plan to that account anyway)
 *
 * Pure. The structure is read, never a cohort id (the test checks this file).
 */
export interface FreeAccessAfterPaidTier {
  /** ISO: when the free access the account returns to ends. */
  endsAt: string;
}

export function freeAccessAfterPaidTier(
  account: EntitlementAccount | null,
  inputs: LifecycleInputs
): FreeAccessAfterPaidTier | null {
  if (!account || !account.cohort) return null;

  const cohort = Object.prototype.hasOwnProperty.call(inputs.cohorts, account.cohort)
    ? inputs.cohorts[account.cohort]
    : undefined;
  if (!cohort || cohort.durationHistory) return null;

  const survivor = ownCohortAfterPaidTier(account, inputs);
  if (!survivor) return null;

  const endsAt = survivor.lifecycle.accessEndsAt;
  if (endsAt === null) return null;
  const endsAtMs = Date.parse(endsAt);
  if (!Number.isFinite(endsAtMs) || endsAtMs <= survivor.tierEndsAt.getTime()) return null;
  return { endsAt };
}

/**
 * Does the account's OWN cohort survive the end of its dated paid tier?
 * (Account-deletion lifecycle SX-2, SA R-4a: the ONE derivation behind both
 * `freeAccessAfterPaidTier` (P-7a.3) and `afterPlanAccount` (D3 / SX-2b).)
 *
 * Read through the resolver's own lifecycle (`deriveLifecycle`) at the moment
 * the tier really ends: its paid-through date plus the renewal settlement
 * margin (`tierSettlementEndsAt`, PF-10). The cohort survives when, at that
 * moment, the basis is a cohort that is live: not grace, not paused, no
 * anomaly. Any cohort shape counts here (an open-ended or dated Founding
 * Partner, an unexpired trial); `freeAccessAfterPaidTier` narrows it to the
 * BQ-5 shape on top.
 *
 *   { tierEndsAt, lifecycle }  the cohort survives; `lifecycle` is the
 *                              derivation at `tierEndsAt`
 *   null                       no dated tier, no cohort, an unreadable date,
 *                              or the cohort has ended (or never resolved) by then
 *
 * Pure. Reads structure, never a cohort id.
 */
export function ownCohortAfterPaidTier(
  account: EntitlementAccount | null,
  inputs: LifecycleInputs
): { tierEndsAt: Date; lifecycle: LifecycleResult } | null {
  if (!account || !account.tier || !account.tierExpiresAt || !account.cohort) return null;

  const tierEndsAtMs = Date.parse(tierSettlementEndsAt(account.tierExpiresAt, inputs.renewalSettlementMarginHistory));
  if (!Number.isFinite(tierEndsAtMs)) return null;
  const tierEndsAt = new Date(tierEndsAtMs);

  const lifecycle = deriveLifecycle(account, inputs, tierEndsAt);
  if (lifecycle.basis.kind !== 'cohort' || lifecycle.state === 'grace' || lifecycle.state === 'paused' || lifecycle.anomaly) {
    return null;
  }
  return { tierEndsAt, lifecycle };
}
