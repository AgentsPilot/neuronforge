/**
 * The self-delete's way into the cleanup engine (data export DE-10b.2;
 * workplan §2.3; SA workplan review V-1, V-2).
 *
 * The customer routes never import `TestAccountCleanupRepository` (the
 * `no-deletion-paths` family-5 allow-list holds real importers only, and no
 * route file was added to it). They call these two runners, which sit next to
 * `runAccountAnonymise` and are the only self-service importers:
 *
 *   runAccountDeletionCheck   the drawer pre-check: `anonymise_check`, which
 *                             the function sets read-only itself, plus the
 *                             version check (R-6)
 *   runSelfAccountAnonymise   the delete: `runAccountAnonymise` with no actor
 *                             and the session email as its own confirmation
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
  type PrepareReceipt,
} from '@/lib/business-os/test-account-cleanup/runCleanupDelete';
import { runAccountAnonymise, type AnonymiseRunOutcome } from '@/lib/business-os/account-deletion/runAccountAnonymise';
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
      serverMs: number | null;
    }
  | { kind: 'unavailable'; reason: CleanupUnavailableReason; error: Error | null }
  | { kind: 'failed'; error: Error };

type CheckRepo = Pick<TestAccountCleanupRepository, 'anonymiseCheck'>;
type AnonymiseRepo = Pick<TestAccountCleanupRepository, 'anonymiseCheck' | 'emptyStorage' | 'anonymise'>;

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
  const canDelete = checkAllowsRun(check) && check.targetUserId === input.subject.toLowerCase();
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
    serverMs: check.serverMs,
  };
}

/**
 * The delete. No actor (`p_actor` NULL: the receipt's origin is `owner`), and
 * the session email is its own confirmation, so G-3 holds by construction.
 */
export function runSelfAccountAnonymise(
  input: SelfDeletionSubject,
  prepareReceipt: PrepareReceipt,
  repo: AnonymiseRepo = new TestAccountCleanupRepository()
): Promise<AnonymiseRunOutcome> {
  return runAccountAnonymise(repo, { email: input.email, subject: input.subject, confirmEmail: input.email }, null, prepareReceipt);
}

/** What a customer route may log about an engine error: its kind and code, never its message. */
export function errorKindFacts(error: unknown): { kind: string | null; code: string | null; name: string | null } {
  if (error instanceof CleanupRpcError) return { kind: error.kind, code: error.code, name: error.name };
  return { kind: null, code: null, name: error instanceof Error ? error.name : null };
}
