/**
 * The deletion lifecycle of an account: the states of a closure request and
 * the rules every stage shares (DL-1a; requirement
 * BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md XC-1, XC-1a, XC-2,
 * XC-3, XC-4; workplan BUSINESS_OS_DELETION_DL1A_WORKPLAN.md §5.1 with SA
 * W-2, W-5 and W-6).
 *
 * PURE and client-safe: constants and one predicate, no imports. The banner
 * (DL-2) may read the state names; nothing here touches the database.
 *
 * The database is the authority for the numbers that matter. Migration
 * 20261093 carries `REQUESTING_SETTLE_MINUTES` and `CLOSURE_LEASE_SECONDS` as
 * SQL literals inside the claim function, so no caller can loosen them, and
 * its status CHECK is `CLOSURE_STATUSES`. This file mirrors them, and
 * supabase/migrations/__tests__/business-os-account-closures.migration.test.ts
 * fails CI when the two disagree (the jobPolicy.ts precedent).
 *
 * There is no `closed` state (SA W-6, XC-1a). At stage E the engine deletes
 * the row inside its own transaction, so "closed" is the absence of the row
 * plus the deletion receipt. The only terminal state that is stored is `kept`.
 *
 * @module lib/business-os/account-deletion/closureLifecycle
 */

/** Every stored state of a closure row (the status CHECK of 20261093). */
export const CLOSURE_STATUSES = ['requesting', 'pending', 'grace', 'locked', 'kept'] as const;
export type ClosureStatus = (typeof CLOSURE_STATUSES)[number];

/** States in which a closure is still open. One open row per account (the partial unique index). */
export const OPEN_CLOSURE_STATUSES = ['requesting', 'pending', 'grace', 'locked'] as const;
export type OpenClosureStatus = (typeof OPEN_CLOSURE_STATUSES)[number];

/** States the lifecycle job may claim (the claim predicate and its partial index). */
export const CLAIMABLE_CLOSURE_STATUSES = ['requesting', 'pending', 'grace'] as const;

/** Who kept the account (XC-1, XC-13). */
export const KEPT_SOURCES = ['owner', 'admin', 'stripe'] as const;
export type KeptSource = (typeof KEPT_SOURCES)[number];

/** One sent-at column per email, named `<email>_email_sent_at` in the table. */
export const CLOSURE_EMAILS = ['requested', 'grace', 'reminder', 'blocked', 'closed', 'kept'] as const;
export type ClosureEmail = (typeof CLOSURE_EMAILS)[number];

/**
 * The only status changes a stored row may make (SA W-5). `requesting → grace`
 * is the free account, which starts stage C at once (XC-2). Removing a
 * `requesting` row is not a transition: it has its own repository method.
 * `kept` has no way out; a later request is a new row.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ClosureStatus, ReadonlyArray<ClosureStatus>>> = {
  requesting: ['pending', 'grace'],
  pending: ['grace', 'kept'],
  grace: ['locked', 'kept'],
  locked: ['kept'],
  kept: [],
};

/** True when `from → to` is in `ALLOWED_TRANSITIONS`. */
export function isAllowedTransition(from: ClosureStatus, to: ClosureStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Stage C: the grace period before the lock, in local days (XC-4). */
export const GRACE_DAYS = 14;

/**
 * A `requesting` row younger than this belongs to the live request route
 * (XC-2), so the claim never takes it. SQL literal `interval '15 minutes'`.
 */
export const REQUESTING_SETTLE_MINUTES = 15;

/**
 * The claim lease (SA W-2). SQL literal `interval '90 seconds'` in the claim
 * predicate: a row claimed longer ago is claimable again, which is the reaper.
 * Above any route or cron maxDuration that runs the lifecycle job.
 */
export const CLOSURE_LEASE_SECONDS = 90;

/** The most rows one claim returns (the claim clamps to 1..100 itself). */
export const CLOSURE_CLAIM_BATCH_MAX = 100;

/** How long the stage D lock bans the login: 10 years, as a Go duration (XC-3). */
export const LOCK_BAN_DURATION = '87600h';

/** The value that lifts a ban (Unlock, Keep after a lock). */
export const UNBAN_DURATION = 'none';

/**
 * A ban further out than this many years is the closed login of a deleted
 * account (the anonymise bans for 100 years, DE-10b.1 F-2). The lock seam never
 * lifts or replaces one.
 */
export const TOMBSTONE_BAN_MIN_YEARS = 99;
