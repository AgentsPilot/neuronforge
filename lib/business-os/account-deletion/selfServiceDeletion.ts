/**
 * The self-delete's way into the cleanup engine (data export DE-10b.2;
 * workplan §2.3; SA workplan review V-1, V-2).
 *
 * The customer routes never import `TestAccountCleanupRepository` (the
 * `no-deletion-paths` family-5 allow-list holds real importers only, and no
 * route file was added to it). They call this runner, the only self-service
 * importer:
 *
 *   runAccountDeletionCheck   the drawer pre-check and the deletion request's
 *                             check: `anonymise_check`, which the function sets
 *                             read-only itself, plus the version check (R-6)
 *
 * DL-1b (workplan BUSINESS_OS_DELETION_DL1B_WORKPLAN.md D-9; SA W-4, W-9): the
 * self-service anonymise runner is GONE, with its import of the anonymise
 * engine. No customer route deletes anything any more (requirement XC-6); the
 * request route records a request and the lifecycle (DL-3 to DL-5) closes the
 * account later. The check now also returns its RAW guard rows, the verdict
 * and whether it resolved this login, so the request's XC-5 filter
 * (`closureBlockers.ts`) never reads the drawer's G-12-less list (W-4).
 *
 * The email and the subject id come from the session (`getUser()`) in the
 * route, never from a body. G-2a proves in the database that they name the
 * same login.
 *
 * Errors are reduced to `{ kind, code }` for logging (`errorKindFacts`): a
 * database message is never logged from a customer route (DE-10b.1 QA E-1).
 *
 * @module lib/business-os/account-deletion/selfServiceDeletion
 */

import 'server-only';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import {
  checkAllowsRun,
  unavailableReasonOf,
  type CleanupUnavailableReason,
} from '@/lib/business-os/test-account-cleanup/runCleanupDelete';
import type { GuardRowLike } from '@/lib/business-os/account-deletion/blockerCopy';
import { CleanupRpcError, TestAccountCleanupRepository } from '@/lib/repositories/TestAccountCleanupRepository';

export interface SelfDeletionSubject {
  /** `user.email` from the session. Never logged. */
  email: string;
  /** `user.id` from the session. */
  subject: string;
}

export type AccountDeletionCheckOutcome =
  | {
      kind: 'checked';
      /** True when the delete would go ahead (OK, or files only). */
      canDelete: boolean;
      targetUserId: string | null;
      /** The rows to show as blockers. Empty when `canDelete`. Never G-12. */
      blockers: GuardRowLike[];
      /** The informational rows (billing kept, consent kept, sent invoices). */
      notes: GuardRowLike[];
      guards: string[];
      /** DL-1b (W-4): every guard row the check reported, G-12 included, unfiltered. */
      rows: GuardRowLike[];
      /** DL-1b (W-4): the check's verdict was BLOCKED. */
      verdictBlocked: boolean;
      /** DL-1b (W-4): the check resolved the session's own login. */
      resolvedThisLogin: boolean;
      serverMs: number | null;
    }
  | { kind: 'unavailable'; reason: CleanupUnavailableReason; error: Error | null }
  | { kind: 'failed'; error: Error };

type CheckRepo = Pick<TestAccountCleanupRepository, 'anonymiseCheck'>;

const toRow = (row: { guard: string; item: string; found: number | null }): GuardRowLike => ({
  guard: row.guard,
  item: row.item,
  found: row.found,
});

export async function runAccountDeletionCheck(
  input: SelfDeletionSubject,
  repo: CheckRepo = new TestAccountCleanupRepository()
): Promise<AccountDeletionCheckOutcome> {
  const checked = await repo.anonymiseCheck({ email: input.email, subject: input.subject });
  if (checked.error || !checked.data) {
    const error = checked.error ?? new Error('Check returned nothing');
    const unavailable = unavailableReasonOf(error);
    return unavailable ? { kind: 'unavailable', reason: unavailable, error } : { kind: 'failed', error };
  }
  const check = checked.data;
  if (check.version !== CLEANUP_FUNCTION_VERSION) return { kind: 'unavailable', reason: 'function_out_of_date', error: null };

  // G-2a proves this in the database; checked again so a parser miss can never show "ready" for another login.
  const resolvedThisLogin = check.targetUserId === input.subject.toLowerCase();
  const canDelete = checkAllowsRun(check) && resolvedThisLogin;
  let blockers: GuardRowLike[] = [];
  if (!canDelete) {
    blockers = check.blockers.filter((row) => row.guard !== 'G-12').map(toRow);
    // BLOCKED with nothing the customer can read (a row the parser missed, or another login): ours to clear.
    if (blockers.length === 0) blockers = [{ guard: 'unknown' }];
  }
  return {
    kind: 'checked',
    canDelete,
    targetUserId: check.targetUserId,
    blockers,
    notes: check.notes.map(toRow),
    guards: [...new Set(check.blockers.map((row) => row.guard))],
    rows: check.blockers.map(toRow),
    verdictBlocked: check.verdict !== 'OK',
    resolvedThisLogin,
    serverMs: check.serverMs,
  };
}

/** What a customer route may log about an engine error: its kind and code, never its message. */
export function errorKindFacts(error: unknown): { kind: string | null; code: string | null; name: string | null } {
  if (error instanceof CleanupRpcError) return { kind: error.kind, code: error.code, name: error.name };
  return { kind: null, code: null, name: error instanceof Error ? error.name : null };
}
