/**
 * The JSON shapes of `/api/admin/test-account-cleanup/*`, as the browser
 * reads them. Client-safe: no imports, so the Danger Zone panel never pulls
 * the repository (`server-only`) into a client bundle.
 *
 * Mirrors `CleanupCheckResult` and `CleanupReport` in
 * `lib/repositories/TestAccountCleanupRepository.ts` and the response bodies
 * of the check and delete routes. Change them together.
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md (slice 2)
 *
 * @module lib/business-os/test-account-cleanup/cleanupApiTypes
 */

export interface CleanupCheckRowView {
  /** VERDICT, guard, remove, storage, trigger or kept. */
  section: string;
  status: string;
  item: string;
  found: number | null;
  detail: string;
}

export interface CleanupBlockerView {
  guard: string;
  item: string;
  found: number | null;
  /** How to clear it. */
  clears: string;
}

export interface CleanupStorageObjectView {
  bucket: string;
  path: string;
}

/** `data` of a successful POST .../check. */
export interface CleanupCheckView {
  version: string;
  verdict: 'OK' | 'BLOCKED';
  targetUserId: string | null;
  blockers: CleanupBlockerView[];
  storageObjects: CleanupStorageObjectView[];
  rows: CleanupCheckRowView[];
  /** false: the applied database function is from another build; the delete will refuse (R-6). */
  functionUpToDate: boolean;
  /** Time the database function took, in ms (SA C-2). Null from a function version that does not report it. */
  serverMs: number | null;
}

export interface CleanupReportView {
  tables: Array<{ table: string; rowsRemoved: number }>;
  total: {
    result: string;
    rowsRemoved: number;
    tablesRemoved: number;
    removedLogin: string | null;
    removedAt: string | null;
    sameRun: boolean;
  };
}

/** `data` of a successful POST .../delete. */
export interface CleanupDeleteView {
  targetUserId: string | null;
  filesRemoved: number;
  report: CleanupReportView;
  /** Database time of the check and of the delete call, in ms (SA C-2). */
  serverMs: { check: number | null; delete: number | null };
}

/**
 * Every `error` code POST .../delete can answer with. Pinned both ways against
 * the server's reasons in `__tests__/cleanupApiTypes.wireTypes.test.ts`, so a
 * new server code fails `npm run typecheck:bos-llm` instead of falling through
 * to the panel's generic sentence.
 */
export type CleanupDeleteErrorCode =
  | 'invalid_body'
  | 'not_configured'
  | 'not_authorised'
  | 'function_missing'
  | 'function_out_of_date'
  | 'confirmation_mismatch'
  | 'blocked'
  | 'check_failed'
  | 'storage_failed'
  | 'delete_failed'
  | 'Internal server error';

/** A refusal or failure body. `message` and `details` are never rendered. */
export interface CleanupErrorBody {
  success: false;
  /** For the delete, a `CleanupDeleteErrorCode`; kept as string because the check answers its own codes. */
  error?: string;
  guards?: string[];
  blockers?: CleanupBlockerView[];
  filesRemoved?: number;
}
