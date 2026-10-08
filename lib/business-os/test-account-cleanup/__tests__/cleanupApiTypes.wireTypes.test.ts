/**
 * The Danger Zone panel re-declares the cleanup routes' payloads in the
 * client-safe `cleanupApiTypes.ts` (it must not import the `server-only`
 * repository). These type-level assertions stop the two copies drifting
 * (the `adminDeletionPreview.wireTypes` precedent).
 *
 * ── What enforces them is `npm run typecheck:bos-llm`, NOT Jest ──────────
 * This one file is listed in that gate's SCOPED_DIRS, so the aliases below are
 * compiled there and a drift fails with `TS2344`. Jest transpiles without type
 * diagnostics in this repo, so the runtime body is deliberately trivial.
 */

import type {
  CleanupBlockerView,
  CleanupCheckRowView,
  CleanupCheckView,
  CleanupDeleteErrorCode,
  CleanupDeleteView,
  CleanupReportView,
  CleanupStorageObjectView,
} from '../cleanupApiTypes';
import type {
  CleanupBlocker,
  CleanupCheckResult,
  CleanupCheckRow,
  CleanupReport,
  StorageObjectRef,
} from '@/lib/repositories/TestAccountCleanupRepository';
import type { CleanupDeleteOutcome, CleanupUnavailableReason } from '../runCleanupDelete';

/** Fails to compile if `Actual` is not assignable to `Expected`. */
type Satisfies<Expected, Actual extends Expected> = Actual;

/** What POST .../check sends as `data` (the route adds `functionUpToDate`). */
type ServerCheck = CleanupCheckResult & { functionUpToDate: boolean };
/** What POST .../delete sends as `data` on success. */
type ServerDelete = Pick<Extract<CleanupDeleteOutcome, { kind: 'removed' }>, 'targetUserId' | 'filesRemoved' | 'report' | 'serverMs'>;
/**
 * Every `error` code of POST .../delete: the outcome reasons and stages from
 * runCleanupDelete, plus the two literals the route writes itself (invalid
 * body, the unexpected catch).
 */
type ServerDeleteCode =
  | Extract<CleanupDeleteOutcome, { kind: 'refused' }>['reason']
  | CleanupUnavailableReason
  | `${Extract<CleanupDeleteOutcome, { kind: 'failed' }>['stage']}_failed`
  | 'invalid_body'
  | 'Internal server error';

type CheckS2C = Satisfies<CleanupCheckView, ServerCheck>;
type CheckC2S = Satisfies<ServerCheck, CleanupCheckView>;
type BlockerS2C = Satisfies<CleanupBlockerView, CleanupBlocker>;
type BlockerC2S = Satisfies<CleanupBlocker, CleanupBlockerView>;
type RowS2C = Satisfies<CleanupCheckRowView, CleanupCheckRow>;
type RowC2S = Satisfies<CleanupCheckRow, CleanupCheckRowView>;
type StorageS2C = Satisfies<CleanupStorageObjectView, StorageObjectRef>;
type StorageC2S = Satisfies<StorageObjectRef, CleanupStorageObjectView>;
type ReportS2C = Satisfies<CleanupReportView, CleanupReport>;
type ReportC2S = Satisfies<CleanupReport, CleanupReportView>;
type DeleteS2C = Satisfies<CleanupDeleteView, ServerDelete>;
type DeleteC2S = Satisfies<ServerDelete, CleanupDeleteView>;
type CodeS2C = Satisfies<CleanupDeleteErrorCode, ServerDeleteCode>;
type CodeC2S = Satisfies<ServerDeleteCode, CleanupDeleteErrorCode>;

describe('the cleanup panel wire types match what the routes send', () => {
  it('check, blocker, row, storage, report, delete and the delete error codes are assignable both ways (checked by tsc, not Jest)', () => {
    const checks: Array<
      | CheckS2C
      | CheckC2S
      | BlockerS2C
      | BlockerC2S
      | RowS2C
      | RowC2S
      | StorageS2C
      | StorageC2S
      | ReportS2C
      | ReportC2S
      | DeleteS2C
      | DeleteC2S
      | CodeS2C
      | CodeC2S
      | null
    > = new Array(14).fill(null);
    expect(checks).toEqual(new Array(14).fill(null));
  });
});
