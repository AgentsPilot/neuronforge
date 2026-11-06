/**
 * The dates of a deletion request (DL-1b; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md D-4; SA W-11).
 *
 * The lock date is the START of local day 15 in the owner's timezone: day 1
 * is the local day the grace period starts, so a request at 23:30 and one at
 * 00:10 the next morning lock a day apart, and a DST week still lands on a
 * local midnight (`businessDayFor` shifts by calendar day, never by 24 h).
 *
 *   lock_at = businessDayFor(now, zone, GRACE_DAYS).startUtc   (GRACE_DAYS = 14)
 *
 * The zone is `user_preferences.timezone` only (CLAUDE.md: `business_profiles.timezone`
 * does not exist). NULL ("not asked") and an unusable name both resolve to
 * `UTC` through `resolveBusinessTimezone`, and the RESOLVED zone is what is
 * stored in `lock_timezone`, so every later message names the zone the date
 * was computed in.
 *
 * Pure: no I/O, no clock of its own. DL-3 reuses it for a paid account's
 * stage C.
 *
 * @module lib/business-os/account-deletion/closureDates
 */

import { businessDayFor, resolveBusinessTimezone } from '@/lib/business-os/businessDay';
import { GRACE_DAYS } from './closureLifecycle';

export interface ClosureLockDate {
  /** ISO, UTC: the start of local day GRACE_DAYS + 1. */
  lockAt: string;
  /** The zone the date was computed in (`UTC` when none was usable). */
  lockTimezone: string;
}

/** The lock date of a grace period that starts at `now`, in the stored zone (or UTC). */
export function closureLockAt(now: Date, storedTimezone: string | null): ClosureLockDate {
  const zone = resolveBusinessTimezone({ preferencesTimezone: storedTimezone }).timezone;
  return { lockAt: businessDayFor(now, zone, GRACE_DAYS).startUtc, lockTimezone: zone };
}
