/**
 * The delete flow of the test-account cleanup, in the order SA-6 and R-6 fix:
 *
 *   1. the typed confirmation equals the email (G-3), before anything runs
 *   2. the check; it must come from the function version this build expects
 *      (R-6), and every blocker must be G-12, or there must be none
 *   3. the deletion receipt is prepared for the login the check resolved
 *      (data export DE-10b.1): a failure here stops before any file goes
 *   4. remove exactly the storage objects the check returned
 *   5. the delete, whose own G-12 re-check proves the folders empty, and which
 *      inserts the receipt last inside its transaction (R-2)
 *
 * Storage goes FIRST because it cannot join the database transaction, and
 * doing the delete first would need G-12 switched off (a fork of the logic)
 * and could leave files under a login that no longer exists. Residue case,
 * accepted by the user for test accounts (BQ-3): files removed, then step 5
 * blocks on a guard that appeared in between. The outcome says so.
 *
 * The close-and-anonymise sibling is
 * lib/business-os/account-deletion/runAccountAnonymise.ts (same order).
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 *
 * @module lib/business-os/test-account-cleanup/runCleanupDelete
 */

import 'server-only';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import { withFilesRemoved, type DeletionReceiptBase } from '@/lib/business-os/account-deletion/receiptInput';
import {
  CleanupRpcError,
  type CleanupBlocker,
  type CleanupCheckResult,
  type CleanupDeleteInput,
  type CleanupReport,
  type TestAccountCleanupRepository,
} from '@/lib/repositories/TestAccountCleanupRepository';

/** Why the tool cannot run at all on this deployment: answered 503. */
export type CleanupUnavailableReason = 'not_configured' | 'not_authorised' | 'function_missing' | 'function_out_of_date';

/** Database time of each function call in this run, in ms (SA C-2). Null when that call did not return. */
export interface CleanupServerMs {
  check: number | null;
  delete: number | null;
}

/** Builds the receipt for the login the check resolved. Throws to stop the run before the storage step. */
export type PrepareReceipt = (targetUserId: string) => Promise<DeletionReceiptBase>;

export type CleanupDeleteOutcome =
  | {
      kind: 'removed';
      targetUserId: string | null;
      filesRemoved: number;
      report: CleanupReport;
      serverMs: CleanupServerMs;
      receiptId: string | null;
    }
  | {
      kind: 'refused';
      reason: 'confirmation_mismatch' | 'blocked';
      targetUserId: string | null;
      guards: string[];
      blockers: CleanupBlocker[];
      filesRemoved: number;
      message: string;
      /** Set once the check returned. */
      serverMs?: CleanupServerMs;
    }
  | { kind: 'unavailable'; reason: CleanupUnavailableReason; targetUserId: string | null; filesRemoved: number; error: Error | null }
  | {
      kind: 'failed';
      stage: 'check' | 'receipt' | 'storage' | 'delete';
      targetUserId: string | null;
      filesRemoved: number;
      error: Error;
    };

const normalise = (value: string): string => value.trim().toLowerCase();

/** True when the typed confirmation equals the email (G-3, same rule as the function). */
export function confirmationMatches(confirmEmail: string, email: string): boolean {
  return normalise(confirmEmail) === normalise(email);
}

/** An rpc error that means "the tool is not usable here", not "this run failed". */
export function unavailableReasonOf(error: Error | null): CleanupUnavailableReason | null {
  if (!(error instanceof CleanupRpcError)) return null;
  return error.kind === 'failed' ? null : error.kind;
}

/**
 * Go on only on OK, or on BLOCKED where at least one blocker exists and every
 * one is G-12. A BLOCKED verdict with no parsed blocker (a row the parser
 * missed) must refuse: storage would go and the function would refuse.
 */
export function checkAllowsRun(check: CleanupCheckResult): boolean {
  const storageOnly = check.blockers.length > 0 && check.blockers.every((blocker) => blocker.guard === 'G-12');
  return (check.verdict === 'OK' || storageOnly) && check.targetUserId !== null;
}

export async function runCleanupDelete(
  repo: Pick<TestAccountCleanupRepository, 'check' | 'emptyStorage' | 'remove'>,
  input: CleanupDeleteInput,
  actorId: string,
  prepareReceipt: PrepareReceipt
): Promise<CleanupDeleteOutcome> {
  // G-3 here as well as in the function: a mismatch must refuse BEFORE the
  // storage step, or the files would go and the account would stay.
  if (!confirmationMatches(input.confirmEmail, input.email)) {
    return {
      kind: 'refused',
      reason: 'confirmation_mismatch',
      targetUserId: null,
      guards: ['G-3'],
      blockers: [],
      filesRemoved: 0,
      message: 'G-3 the confirmation does not equal the email. Nothing was removed.',
    };
  }

  const checked = await repo.check({ email: input.email, tag: input.tag });
  if (checked.error || !checked.data) {
    const error = checked.error ?? new Error('Check returned nothing');
    const unavailable = unavailableReasonOf(error);
    if (unavailable) return { kind: 'unavailable', reason: unavailable, targetUserId: null, filesRemoved: 0, error };
    return { kind: 'failed', stage: 'check', targetUserId: null, filesRemoved: 0, error };
  }
  const check = checked.data;

  // R-6: a function from another build must not drive the storage step.
  if (check.version !== CLEANUP_FUNCTION_VERSION) {
    return { kind: 'unavailable', reason: 'function_out_of_date', targetUserId: check.targetUserId, filesRemoved: 0, error: null };
  }

  if (!checkAllowsRun(check) || check.targetUserId === null) {
    return {
      kind: 'refused',
      reason: 'blocked',
      targetUserId: check.targetUserId,
      guards: [...new Set(check.blockers.map((blocker) => blocker.guard))],
      blockers: check.blockers,
      filesRemoved: 0,
      message: 'BLOCKED, nothing was removed.',
      serverMs: { check: check.serverMs, delete: null },
    };
  }

  let receipt: DeletionReceiptBase;
  try {
    receipt = await prepareReceipt(check.targetUserId);
  } catch (err) {
    return {
      kind: 'failed',
      stage: 'receipt',
      targetUserId: check.targetUserId,
      filesRemoved: 0,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }

  let filesRemoved = 0;
  if (check.storageObjects.length > 0) {
    const emptied = await repo.emptyStorage(check.targetUserId, check.storageObjects);
    if (emptied.error || !emptied.data) {
      return {
        kind: 'failed',
        stage: 'storage',
        targetUserId: check.targetUserId,
        filesRemoved: 0,
        error: emptied.error ?? new Error('Storage step returned nothing'),
      };
    }
    // Partial failures are not decided here: the delete's own G-12 re-check is the proof.
    filesRemoved = emptied.data.removed;
  }

  const removed = await repo.remove(input, actorId, withFilesRemoved(receipt, filesRemoved));
  if (removed.error || !removed.data) {
    const error = removed.error ?? new Error('Delete returned nothing');
    const unavailable = unavailableReasonOf(error);
    if (unavailable) return { kind: 'unavailable', reason: unavailable, targetUserId: check.targetUserId, filesRemoved, error };
    return { kind: 'failed', stage: 'delete', targetUserId: check.targetUserId, filesRemoved, error };
  }
  if (removed.data.kind === 'blocked') {
    return {
      kind: 'refused',
      reason: 'blocked',
      targetUserId: check.targetUserId,
      guards: removed.data.guards,
      blockers: [],
      filesRemoved,
      message: filesRemoved > 0 ? `Files removed, account kept: ${removed.data.reason}` : removed.data.reason,
      serverMs: { check: check.serverMs, delete: null },
    };
  }
  return {
    kind: 'removed',
    targetUserId: check.targetUserId,
    filesRemoved,
    report: removed.data.report,
    serverMs: { check: check.serverMs, delete: removed.data.serverMs },
    receiptId: removed.data.receiptId,
  };
}
