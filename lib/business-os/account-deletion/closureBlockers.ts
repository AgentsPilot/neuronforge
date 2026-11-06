/**
 * What blocks a deletion REQUEST at stage A (DL-1b; requirement XC-5; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §9; SA W-4, Q-14, Q-15).
 *
 * The cleanup function's check reports every guard that would stop an
 * anonymise TODAY. A request is not an anonymise: the plan is set not to renew
 * (so G-6 cannot block it), files are removed at stage E (G-12), and the
 * engineering guards are ours to clear before E, not the owner's. So the
 * request reads the RAW guard rows (never `runAccountDeletionCheck`'s
 * `blockers`, which already dropped G-12 and put `unknown` in its place, W-4)
 * and keeps only what the owner can fix, or what means the check may not be
 * about this login:
 *
 * | Guard | At A |
 * |---|---|
 * | G-8 Stripe Connect, G-9 client money (by item) | block (BQ-21) |
 * | G-4 an admin login | block (`admin_account`) |
 * | G-1, G-2, G-2a, G-3 the identity of the login | block, fail closed (`contact_support`, Q-14) |
 * | G-6 plan running, G-12 files | ignored |
 * | G-5, G-7, G-10, G-11, G-13 to G-22 | do not block: listed in `engineering` |
 * | an id this file does not know | block, fail closed (`contact_support`) |
 * | the check resolved another login, or BLOCKED with no row the parser read | block as `unknown` |
 *
 * A failed last payment (BQ-11, `payment_failed`) is decided from our billing
 * row before the check runs; it is not a guard row.
 *
 * The same function serves the pre-check route (Q-15) and, later, the lock
 * re-check (DL-4). Pure and client-safe.
 *
 * @module lib/business-os/account-deletion/closureBlockers
 */

import type { GuardRowLike } from './blockerCopy';

export type RequestGuardClass = 'block' | 'ignore' | 'engineering';

/** Every guard the generated function emits, classified for stage A. A test reads the generator. */
export const REQUEST_GUARD_CLASS: Readonly<Record<string, RequestGuardClass>> = {
  'G-1': 'block',
  'G-2': 'block',
  'G-2a': 'block',
  'G-3': 'block',
  'G-4': 'block',
  'G-5': 'engineering',
  'G-6': 'ignore',
  'G-7': 'engineering',
  'G-8': 'block',
  'G-9': 'block',
  'G-10': 'engineering',
  'G-11': 'engineering',
  'G-12': 'ignore',
  'G-13': 'engineering',
  'G-14': 'engineering',
  'G-15': 'engineering',
  'G-16': 'engineering',
  'G-17': 'engineering',
  'G-18': 'engineering',
  'G-19': 'engineering',
  'G-20': 'engineering',
  'G-21': 'engineering',
  'G-22': 'engineering',
};

export interface RequestBlockerInput {
  /** The check's raw guard rows, G-12 included (W-4). */
  rows: readonly GuardRowLike[];
  /** The check's verdict was BLOCKED. */
  verdictBlocked: boolean;
  /** The check resolved the session's own login (G-2a, checked again here). */
  resolvedThisLogin: boolean;
}

export interface RequestBlockers {
  /** The rows that refuse the request. Map with `toBlockerViews`. */
  blocking: GuardRowLike[];
  /** Guard ids that do not block at A, for the log (and, later, the ready list). */
  engineering: string[];
}

function classOf(guard: string): RequestGuardClass {
  return Object.prototype.hasOwnProperty.call(REQUEST_GUARD_CLASS, guard) ? REQUEST_GUARD_CLASS[guard] : 'block';
}

export function requestBlockers(input: RequestBlockerInput): RequestBlockers {
  const blocking: GuardRowLike[] = [];
  const engineering = new Set<string>();
  for (const row of input.rows) {
    const kind = classOf(row.guard);
    if (kind === 'block') blocking.push({ guard: row.guard, item: row.item, found: row.found });
    else if (kind === 'engineering') engineering.add(row.guard);
  }
  // Another login, or BLOCKED with nothing the parser read: ours to clear, never "ready".
  if (!input.resolvedThisLogin || (input.verdictBlocked && input.rows.length === 0)) {
    blocking.push({ guard: 'unknown' });
  }
  return { blocking, engineering: [...engineering] };
}
