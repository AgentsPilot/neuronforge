/**
 * The open closure as the Danger Zone shows it (account deletion lifecycle
 * DL-2a; workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.1,
 * D-6, D-7; SA W-4 d, W-12).
 *
 * Pure: a stored row, the owner's timezone read and nothing else in, the wire
 * of `GET /api/business-os/account/closure` out. No I/O, no clock of its own.
 *
 *   requesting   no lock date (the request is still being set up)
 *   pending      the lock date is PROJECTED from the plan end:
 *                `closureLockAt(plan_ends_at, zone)`, the same helper DL-3 uses
 *                when it starts stage C, so the two agree unless the plan end
 *                or the zone moves (D-7). `lockAtIsProjected: true`
 *   grace/locked the STORED `lock_at` in its stored `lock_timezone`
 *
 * W-4 d: when the timezone could not be read, a pending row gets `lockAt: null`
 * and `timezone: 'UTC'`, so the panel uses its `_nodate` lines and formats
 * neither the plan end nor the lock date on a guessed zone.
 *
 * W-12: the date is shown exactly as `closureLockAt` returns it. There is no
 * display-side compensation for the midnight-DST helper bug (R-1); that would
 * hide the bug and disagree with what DL-3 stores.
 *
 * Server-side only by use (it reaches `businessDay` through `closureDates`);
 * no `'use client'` file imports it (SA W-5).
 *
 * @module lib/business-os/account-deletion/closureStatusView
 */

import { resolveBusinessTimezone } from '@/lib/business-os/businessDay';
import { closureLockAt } from './closureDates';
import { GRACE_DAYS, type OpenClosureStatus } from './closureLifecycle';
import type { ClosureStatusView } from './schemas';

/** The closure row fields this view reads. */
export interface ClosureStatusRow {
  status: OpenClosureStatus;
  renewal_was_on: boolean;
  plan_ends_at: string | null;
  lock_at: string | null;
  lock_timezone: string | null;
}

/** The owner's `user_preferences.timezone` read: the stored value (NULL = not asked), or a failed read. */
export type TimezoneRead = { ok: true; stored: string | null } | { ok: false };

const UTC = 'UTC';

function isUsableInstant(value: string | null): value is string {
  return value !== null && !Number.isNaN(new Date(value).getTime());
}

/** The pending row's projected lock, or null when its plan end or the zone is unknown. */
function projectedLock(planEndsAt: string | null, zone: TimezoneRead): { lockAt: string | null; timezone: string } {
  if (!zone.ok) return { lockAt: null, timezone: UTC };
  if (!isUsableInstant(planEndsAt)) {
    return { lockAt: null, timezone: resolveBusinessTimezone({ preferencesTimezone: zone.stored }).timezone };
  }
  const lock = closureLockAt(new Date(planEndsAt), zone.stored);
  return { lockAt: lock.lockAt, timezone: lock.lockTimezone };
}

/** True when the view needs the owner's timezone read (a pending row only). */
export function needsTimezone(status: OpenClosureStatus): boolean {
  return status === 'pending';
}

export function closureStatusView(row: ClosureStatusRow, zone: TimezoneRead): ClosureStatusView {
  const base = {
    status: row.status,
    planEndsAt: row.plan_ends_at,
    renewalWasOn: row.renewal_was_on,
    graceDays: GRACE_DAYS,
  };

  if (row.status === 'pending') {
    const lock = projectedLock(row.plan_ends_at, zone);
    // W-4 d: no zone, no date of any kind on this view.
    return { ...base, planEndsAt: zone.ok ? row.plan_ends_at : null, lockAt: lock.lockAt, lockAtIsProjected: lock.lockAt !== null, timezone: lock.timezone };
  }

  if (row.status === 'grace' || row.status === 'locked') {
    const stored = isUsableInstant(row.lock_at) ? row.lock_at : null;
    const timezone = row.lock_timezone && row.lock_timezone.trim() !== '' ? row.lock_timezone : UTC;
    return { ...base, lockAt: stored, lockAtIsProjected: false, timezone };
  }

  // `requesting`: nothing is fixed yet.
  return { ...base, lockAt: null, lockAtIsProjected: false, timezone: UTC };
}
