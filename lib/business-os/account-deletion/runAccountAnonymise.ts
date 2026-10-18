/**
 * Close and anonymise an account (data export DE-10b.1; workplan §5), in the
 * same order as the test-account delete (runCleanupDelete, SA-6, R-6):
 *
 *   1. the typed confirmation equals the email (G-3), before anything runs
 *   2. `anonymise_check`: it must come from the function version this build
 *      expects (R-6); only BLOCKING guards stop it, and G-12 (files) alone is
 *      cleared by step 4. Informational rows (billing kept, consent kept,
 *      invitation link kept, sent invoices) never stop it (TL-6, NBQ-3, NBQ-4)
 *   3. the receipt is prepared for the login the check resolved, which G-2a
 *      proved is the subject: a failure stops before any file goes
 *   4. remove exactly the storage objects the check returned
 *   5. `anonymise`, with its own re-check of every guard, inside one
 *      transaction: plan deletes, blanks, login closure, auth log, survivor
 *      scan, audit row, then the receipt (R-2)
 *
 * C2-11: storage cannot join the transaction. If a guard appears between
 * steps 4 and 5, the files are gone and the account stays. The outcome says so
 * (`filesRemovedThenRefused`), and the route records it.
 *
 * Used by the admin route here and by the self-delete route in DE-10b.2
 * (`actorId` null, receipt origin owner).
 *
 * @module lib/business-os/account-deletion/runAccountAnonymise
 */

import 'server-only';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import {
  checkAllowsRun,
  confirmationMatches,
  unavailableReasonOf,
  type CleanupServerMs,
  type CleanupUnavailableReason,
  type PrepareReceipt,
} from '@/lib/business-os/test-account-cleanup/runCleanupDelete';
import { withFilesRemoved, type DeletionReceiptBase } from '@/lib/business-os/account-deletion/receiptInput';
import type {
  AnonymiseDeleteInput,
  AnonymiseReport,
  CleanupBlocker,
  TestAccountCleanupRepository,
} from '@/lib/repositories/TestAccountCleanupRepository';

export type AnonymiseRunOutcome =
  | {
      kind: 'anonymised';
      targetUserId: string;
      filesRemoved: number;
      report: AnonymiseReport;
      /** The informational rows the check reported (what was kept). */
      notes: CleanupBlocker[];
      serverMs: CleanupServerMs;
    }
  | {
      kind: 'refused';
      reason: 'confirmation_mismatch' | 'blocked';
      targetUserId: string | null;
      guards: string[];
      blockers: CleanupBlocker[];
      filesRemoved: number;
      /** C2-11: the storage step ran, then the anonymise refused. Files gone, account kept. */
      filesRemovedThenRefused: boolean;
      message: string;
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

export async function runAccountAnonymise(
  repo: Pick<TestAccountCleanupRepository, 'anonymiseCheck' | 'emptyStorage' | 'anonymise'>,
  input: AnonymiseDeleteInput,
  actorId: string | null,
  prepareReceipt: PrepareReceipt
): Promise<AnonymiseRunOutcome> {
  if (!confirmationMatches(input.confirmEmail, input.email)) {
    return {
      kind: 'refused',
      reason: 'confirmation_mismatch',
      targetUserId: null,
      guards: ['G-3'],
      blockers: [],
      filesRemoved: 0,
      filesRemovedThenRefused: false,
      message: 'G-3 the confirmation does not equal the email. Nothing was removed.',
    };
  }

  const checked = await repo.anonymiseCheck({ email: input.email, subject: input.subject });
  if (checked.error || !checked.data) {
    const error = checked.error ?? new Error('Check returned nothing');
    const unavailable = unavailableReasonOf(error);
    if (unavailable) return { kind: 'unavailable', reason: unavailable, targetUserId: null, filesRemoved: 0, error };
    return { kind: 'failed', stage: 'check', targetUserId: null, filesRemoved: 0, error };
  }
  const check = checked.data;

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
      filesRemovedThenRefused: false,
      message: 'BLOCKED, nothing was removed.',
      serverMs: { check: check.serverMs, delete: null },
    };
  }
  const targetUserId = check.targetUserId;

  let receipt: DeletionReceiptBase;
  try {
    receipt = await prepareReceipt(targetUserId);
  } catch (err) {
    return { kind: 'failed', stage: 'receipt', targetUserId, filesRemoved: 0, error: err instanceof Error ? err : new Error(String(err)) };
  }

  let filesRemoved = 0;
  if (check.storageObjects.length > 0) {
    const emptied = await repo.emptyStorage(targetUserId, check.storageObjects);
    if (emptied.error || !emptied.data) {
      return {
        kind: 'failed',
        stage: 'storage',
        targetUserId,
        filesRemoved: 0,
        error: emptied.error ?? new Error('Storage step returned nothing'),
      };
    }
    filesRemoved = emptied.data.removed;
  }

  const result = await repo.anonymise(input, actorId, withFilesRemoved(receipt, filesRemoved));
  if (result.error || !result.data) {
    const error = result.error ?? new Error('Anonymise returned nothing');
    const unavailable = unavailableReasonOf(error);
    if (unavailable) return { kind: 'unavailable', reason: unavailable, targetUserId, filesRemoved, error };
    return { kind: 'failed', stage: 'delete', targetUserId, filesRemoved, error };
  }
  if (result.data.kind === 'blocked') {
    return {
      kind: 'refused',
      reason: 'blocked',
      targetUserId,
      guards: result.data.guards,
      blockers: [],
      filesRemoved,
      filesRemovedThenRefused: filesRemoved > 0,
      message: filesRemoved > 0 ? `Files removed, account kept: ${result.data.reason}` : result.data.reason,
      serverMs: { check: check.serverMs, delete: null },
    };
  }
  return {
    kind: 'anonymised',
    targetUserId,
    filesRemoved,
    report: result.data.report,
    notes: check.notes,
    serverMs: { check: check.serverMs, delete: result.data.serverMs },
  };
}
