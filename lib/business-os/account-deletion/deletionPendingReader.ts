/**
 * Is a deletion request open for this account? (DL-1b; requirement XC-19,
 * BQ-34; workplan docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §8.)
 *
 * The ONE reader the plan checkout, the Boost checkout and the plain plan
 * reactivate use to refuse while a request is open ("Keep your account
 * first"). "Open" is any of `requesting`, `pending`, `grace`, `locked`: stages
 * A to C, plus D, where nobody can sign in anyway.
 *
 * It reads the closure repository, NOT the entitlements module (XC-19): a
 * deletion request refuses a purchase by the account's lifecycle, never by
 * plan. It imports nothing from `lib/business-os/entitlements/` (its test
 * pins that).
 *
 * TENANCY (tenant-isolation-guard). Service role: the closure table has no
 * policy by design. The id is always the caller's SESSION user (or the session
 * account through `resolveAccountId`, the same id today); the repository
 * filters `user_id` on it. It never takes a request value.
 *
 * Fails closed: a read error is `unreadable`, and every caller refuses on it.
 * Never throws.
 *
 * @module lib/business-os/account-deletion/deletionPendingReader
 */

import { AccountClosureRepository } from '@/lib/repositories/AccountClosureRepository';

/** `none`: no open request. `open`: one exists. `unreadable`: the read failed (refuse). */
export type DeletionPendingState = 'none' | 'open' | 'unreadable';

/** The port type the checkouts and the cancel engine take. */
export type DeletionPendingReader = (userId: string) => Promise<DeletionPendingState>;

type OpenReader = Pick<AccountClosureRepository, 'findOpenForUser'>;

let shared: AccountClosureRepository | null = null;

/** Built on first use, never at import, so a module that only names the type creates no client. */
function sharedRepository(): AccountClosureRepository {
  if (shared === null) shared = new AccountClosureRepository();
  return shared;
}

export async function readDeletionPending(userId: string, repo?: OpenReader): Promise<DeletionPendingState> {
  try {
    // SA CR-5: the shared repository is built INSIDE the try, so a constructor throw
    // (a missing service-role env, say) is `unreadable` too, as the header promises.
    const reader = repo ?? sharedRepository();
    const found = await reader.findOpenForUser(userId);
    if (found.error) return 'unreadable';
    return found.data ? 'open' : 'none';
  } catch {
    // The repository never throws by contract; if it ever does, refuse.
    return 'unreadable';
  }
}
