/**
 * The grant rules shared by the admin operations and the invite redemption
 * (requirement T-2, SA R-5; invite-only signup Slice 1b).
 *
 * Two callers place an account on a champion basis: an admin through
 * `adminOps.ts`, and an invitee through the redemption flow. They must apply
 * the SAME rule, so it lives here once:
 *
 * - **RC-4, silence is never "forever".** A champion's end must be decided:
 *   either an explicit end (or explicit "no end", `null`) from an admin, or,
 *   on an invite row, `access_open_ended = true` with no months, or `false`
 *   with a positive month count.
 * - **GR-1, a grant must still exist in config.** An invite created for a
 *   cohort that has since left the config is refused rather than written.
 *
 * Pure: no I/O, no resolver, no account. It decides nothing about what an
 * account may DO, so it is not a capability gate.
 */

import { CHAMPION_ACCESS_MONTHS_MAX } from './config/invites';
import { COHORT_IDS } from './config/cohorts';
import type { EntitlementConfig } from './source';

/** The cohort whose end must always be decided (RC-4). */
const END_REQUIRED_COHORT = 'champion';

/**
 * RC-4 for an admin operation: `true` when a champion placement leaves the end
 * unsaid. `undefined` is "not said"; `null` is an explicit "no end date".
 */
export function championEndDecisionMissing(cohort: string | null, expiresAt: unknown): boolean {
  return cohort === END_REQUIRED_COHORT && expiresAt === undefined;
}

/** Is `id` a cohort the config still defines? (GR-1) */
export function isGrantableCohort(config: EntitlementConfig, id: string): boolean {
  return (COHORT_IDS as readonly string[]).includes(id) && Object.prototype.hasOwnProperty.call(config.cohorts, id);
}

/** The grant facts of an invite row, as the redemption reads them. */
export interface InviteCohortGrantFacts {
  grant_kind: string;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
}

/**
 * May this invite row be redeemed as a cohort placement? (R-5)
 *
 * Checked in TypeScript BEFORE the claim; the finalise function repeats the
 * cohort-id equality in SQL and computes the end date from the same columns.
 */
export function isRedeemableCohortGrant(config: EntitlementConfig, row: InviteCohortGrantFacts): boolean {
  if (row.grant_kind !== 'cohort') return false;
  if (!isGrantableCohort(config, row.grant_id)) return false;
  if (row.access_open_ended === true) return row.access_months === null;
  if (row.access_open_ended === false) {
    return (
      typeof row.access_months === 'number' &&
      Number.isInteger(row.access_months) &&
      row.access_months >= 1 &&
      row.access_months <= CHAMPION_ACCESS_MONTHS_MAX
    );
  }
  return false;
}
