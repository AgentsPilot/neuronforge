/**
 * The admin Businesses screen re-declares the deletion preview's payload (its
 * source guard forbids `@/lib/business-os` imports). These type-level
 * assertions stop the two copies drifting (admin delete AD-1c; the
 * `adminCreditPosition.wireTypes` precedent).
 *
 * ── What enforces them is `npm run typecheck:bos-llm` — NOT Jest ─────────
 * This one file (not the purge directory) is listed in that gate's
 * SCOPED_DIRS, so the aliases below are compiled there and a drift fails with
 * `TS2344`. Jest transpiles without type diagnostics in this repo, so the
 * runtime body is deliberately trivial.
 */

import type {
  DeletionAreaView,
  DeletionCommitCodeView,
  DeletionCommitResultView,
  DeletionPreviewPayload,
} from '@/app/admin/users/types';
import type { AdminDeletionArea, AdminDeletionPreview } from '../AdminDeletionPreview';
import type { AdminDeletionCommitCode, AdminDeletionCommitCompleted } from '../AdminDeletionCommit';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** Everything the server sends, the client can hold. */
type ServerSatisfiesClient = Satisfies<DeletionPreviewPayload, AdminDeletionPreview>;
/** And the other way: a client field the server never sends would be dead UI. */
type ClientSatisfiesServer = Satisfies<AdminDeletionPreview, DeletionPreviewPayload>;

/** The area union equals the server's, both ways: a new area fails here, not as a blank label. */
type AreaServerSatisfiesClient = Satisfies<DeletionAreaView, AdminDeletionArea['area']>;
type AreaClientSatisfiesServer = Satisfies<AdminDeletionArea['area'], DeletionAreaView>;

/**
 * AD-2b: the commit route's `data` and its refusal codes, both ways. A new
 * server code fails here, so the dialog's exhaustive code → sentence map can
 * never fall through to the generic sentence for a known refusal.
 */
type CommitResult = AdminDeletionCommitCompleted['result'];
type CommitServerSatisfiesClient = Satisfies<DeletionCommitResultView, CommitResult>;
type CommitClientSatisfiesServer = Satisfies<CommitResult, DeletionCommitResultView>;
type CodeServerSatisfiesClient = Satisfies<DeletionCommitCodeView, AdminDeletionCommitCode>;
type CodeClientSatisfiesServer = Satisfies<AdminDeletionCommitCode, DeletionCommitCodeView>;

describe('the deletion preview payload types match what the route sends', () => {
  it('preview and commit payloads are assignable both ways; the area and commit-code unions are equal (checked by tsc, not Jest)', () => {
    const checks: Array<
      | ServerSatisfiesClient
      | ClientSatisfiesServer
      | AreaServerSatisfiesClient
      | AreaClientSatisfiesServer
      | CommitServerSatisfiesClient
      | CommitClientSatisfiesServer
      | CodeServerSatisfiesClient
      | CodeClientSatisfiesServer
      | null
    > = [null, null, null, null, null, null, null, null];
    expect(checks).toEqual([null, null, null, null, null, null, null, null]);
  });
});
