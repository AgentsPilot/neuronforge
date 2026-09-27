// lib/repositories/ArchiveRepository.ts
// Access for the admin Archiving module: the overview reads (Slices 1, 2a) and
// the run lifecycle (Slice 2b).
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). Archiving is platform
// maintenance across every account; there is no per-user caller. CLAUDE.md
// Rule 4 is met BY NAME instead of by argument: every method that reads or
// moves account data across accounts (`audit_trail`, `archived_records`) ends in
// `AllAccounts`, so "all accounts" is reached by calling a differently named
// method, never by leaving an argument out (the `TokenUsageRepository`
// precedent). Methods over `archive_runs` have plain names: that table holds no
// account data and has no `user_id` at all, so there is no scope to omit
// (Slice 2 SA Q-7).
//
// ONLY CALLERS: `GET /api/admin/archiving` (reads) and
// `POST /api/admin/archiving/runs` with its runner
// `lib/archiving/server/runArchive.ts` (run methods). Both routes are behind
// `requireAdmin`.
//
// WRITES (Slice 2b). This file writes `archive_runs` only: create, claim for
// Continue, stale takeover and finish. It never writes `audit_trail` or
// `archived_records` directly: rows move only through the database function
// `archive_audit_trail_batch`, which copies, deletes and records the batch in
// one transaction and refuses any run that is not `running` with exactly the
// stored cutoff (decision D-1). Every insert and update is built field by
// field; nothing from a request body is spread into a payload. The per-user
// erasure/export methods arrive in Slice 3 (condition C-7: all archive access
// goes through this file).
//
// No row content is ever read. Counts select nothing (`head: true`), the
// oldest-row lookup selects `created_at` alone, and the run list names its
// columns. No method selects `archived_records.payload` (AC-14). Counts use
// `count: 'exact', head: true` because PostgREST aggregates are disabled on this
// project (F-10).
//
// Methods never throw: they return `{ data, error }` or a discriminated result.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { ArchiveRunStatus, ArchiveSourceKey } from '@/lib/archiving/config';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const AUDIT_TRAIL = 'audit_trail';
const ARCHIVED_RECORDS = 'archived_records';
const ARCHIVE_RUNS = 'archive_runs';

/**
 * The database function that moves one batch of each source. Server-only (it
 * lives here, not in the client-safe registry: Slice 2 SA Q-6), and a full
 * `Record`, so a registry entry without a function is a compile error.
 */
const BATCH_FUNCTIONS: Record<ArchiveSourceKey, string> = {
  audit_trail: 'archive_audit_trail_batch',
};

/** Postgres unique violation: on `archive_runs`, only the one-running-run-per-source index. */
const UNIQUE_VIOLATION = '23505';

/** The run-log columns the admin page shows. Named, never `*`. */
export const ARCHIVE_RUN_COLUMNS =
  'id, source, status, retention_days, cutoff, rows_archived, batches, started_by, started_at, last_batch_at, finished_at, error_code';

/** One `archive_runs` row, as selected by `ARCHIVE_RUN_COLUMNS`. */
export interface ArchiveRunRow {
  id: string;
  source: string;
  status: string;
  retention_days: number;
  cutoff: string;
  /** `bigint` in SQL: PostgREST may hand it back as a number or a numeric string. */
  rows_archived: number | string;
  batches: number;
  started_by: string;
  started_at: string;
  last_batch_at: string | null;
  finished_at: string | null;
  error_code: string | null;
}

export class ArchiveRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ArchiveRepository' });
  }

  /** Every row in `audit_trail`, across all accounts. */
  async countAuditTrailAllAccounts(): Promise<RepositoryResult<number>> {
    const methodLogger = this.logger.child({ method: 'countAuditTrailAllAccounts' });
    try {
      const { count, error } = await this.supabase
        .from(AUDIT_TRAIL)
        .select('id', { count: 'exact', head: true });

      if (error) throw error;
      // A missing count is an unknown, not a zero: returning 0 would let the
      // page show a number nobody measured.
      if (count === null || count === undefined) {
        throw new Error('audit_trail count came back empty');
      }
      return { data: count, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to count audit_trail rows');
      return { data: null, error: toError(error) };
    }
  }

  /** The oldest `created_at` in `audit_trail`, or `null` when the table is empty. */
  async getOldestAuditTrailCreatedAtAllAccounts(): Promise<RepositoryResult<string>> {
    const methodLogger = this.logger.child({ method: 'getOldestAuditTrailCreatedAtAllAccounts' });
    try {
      const { data, error } = await this.supabase
        .from(AUDIT_TRAIL)
        .select('created_at')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;
      const rows = (data ?? []) as Array<{ created_at: string | null }>;
      return { data: rows[0]?.created_at ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to read the oldest audit_trail row');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * Rows with `created_at` strictly before `cutoff`, across all accounts. Strict
   * `<` is the same comparison the move function uses (requirement §5.3).
   */
  async countAuditTrailBeforeAllAccounts(cutoff: Date): Promise<RepositoryResult<number>> {
    const methodLogger = this.logger.child({ method: 'countAuditTrailBeforeAllAccounts' });
    // An invalid date would become the string "Invalid Date" or throw inside
    // toISOString; refuse it before any query is built.
    if (!(cutoff instanceof Date) || Number.isNaN(cutoff.getTime())) {
      const error = new Error('cutoff must be a valid Date');
      methodLogger.error({ err: error }, 'Refused an invalid cutoff');
      return { data: null, error };
    }

    try {
      const { count, error } = await this.supabase
        .from(AUDIT_TRAIL)
        .select('id', { count: 'exact', head: true })
        .lt('created_at', cutoff.toISOString());

      if (error) throw error;
      if (count === null || count === undefined) {
        throw new Error('audit_trail eligible count came back empty');
      }
      return { data: count, error: null };
    } catch (error) {
      methodLogger.error(
        { err: error, cutoff: cutoff.toISOString() },
        'Failed to count audit_trail rows before the cutoff'
      );
      return { data: null, error: toError(error) };
    }
  }

  /** Rows of one source now in the archive, across all accounts. A missing count is an error. */
  async countArchivedAllAccounts(source: string): Promise<RepositoryResult<number>> {
    const methodLogger = this.logger.child({ method: 'countArchivedAllAccounts', source });
    try {
      const { count, error } = await this.supabase
        .from(ARCHIVED_RECORDS)
        .select('id', { count: 'exact', head: true })
        .eq('source', source);

      if (error) throw error;
      if (count === null || count === undefined) {
        throw new Error('archived_records count came back empty');
      }
      return { data: count, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to count archived rows');
      return { data: null, error: toError(error) };
    }
  }

  /** The newest runs of every source, newest first. */
  async listRuns(options: { limit?: number } = {}): Promise<RepositoryResult<ArchiveRunRow[]>> {
    const limit = options.limit ?? 20;
    const methodLogger = this.logger.child({ method: 'listRuns', limit });
    try {
      const { data, error } = await this.supabase
        .from(ARCHIVE_RUNS)
        .select(ARCHIVE_RUN_COLUMNS)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as ArchiveRunRow[], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to list archive runs');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * The latest cutoff among SUCCEEDED runs of one source, or `null` when none
   * has succeeded. Ordered by cutoff, not by run time (Slice 2 SA Q-5): a
   * 365-day run after a 90-day run has an earlier cutoff, and everything before
   * the latest succeeded cutoff is archived. Slice 3's "archived before" notice
   * and the Gap B view read this (TQ-5).
   */
  async getLatestCutoff(source: string): Promise<RepositoryResult<string>> {
    const methodLogger = this.logger.child({ method: 'getLatestCutoff', source });
    try {
      const { data, error } = await this.supabase
        .from(ARCHIVE_RUNS)
        .select('cutoff')
        .eq('source', source)
        .eq('status', 'succeeded')
        .order('cutoff', { ascending: false })
        .limit(1);

      if (error) throw error;
      const rows = (data ?? []) as Array<{ cutoff: string | null }>;
      return { data: rows[0]?.cutoff ?? null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to read the latest archive cutoff');
      return { data: null, error: toError(error) };
    }
  }

  // ── Run lifecycle (Slice 2b) ───────────────────────────────────────────────

  /**
   * Flip every `running` run with no sign of life for `staleAfterMs` to
   * `partial` / `interrupted` (TQ-1). Such a run can only belong to a dead
   * request: the route's `maxDuration` is 60 s. Two plain updates rather than one
   * `or` filter (workplan 2b D-2): `last_batch_at` is either set and old, or null
   * with an old `started_at`, and the two cases are disjoint.
   */
  async takeOverStaleRuns(now: Date, staleAfterMs: number): Promise<RepositoryResult<string[]>> {
    const methodLogger = this.logger.child({ method: 'takeOverStaleRuns' });
    const threshold = new Date(now.getTime() - staleAfterMs).toISOString();
    const patch = { status: 'partial', error_code: 'interrupted', finished_at: now.toISOString() };
    try {
      const batched = await this.supabase
        .from(ARCHIVE_RUNS)
        .update(patch)
        .eq('status', 'running')
        .lt('last_batch_at', threshold)
        .select('id');
      if (batched.error) throw batched.error;

      const neverBatched = await this.supabase
        .from(ARCHIVE_RUNS)
        .update(patch)
        .eq('status', 'running')
        .is('last_batch_at', null)
        .lt('started_at', threshold)
        .select('id');
      if (neverBatched.error) throw neverBatched.error;

      const ids = [
        ...((batched.data ?? []) as Array<{ id: string }>),
        ...((neverBatched.data ?? []) as Array<{ id: string }>),
      ].map((row) => row.id);
      if (ids.length > 0) methodLogger.warn({ runIds: ids }, 'Took over stale archive runs');
      return { data: ids, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to take over stale archive runs');
      return { data: null, error: toError(error) };
    }
  }

  /**
   * Start a run. The insert is built field by field: `cutoff` is computed by the
   * caller on the server, and `startedBy` is the gated admin. A second running
   * run of the same source hits the partial unique index and is `conflict` (AC-7).
   */
  async createRun(input: {
    source: ArchiveSourceKey;
    retentionDays: number;
    cutoff: Date;
    startedBy: string;
  }): Promise<CreateRunResult> {
    const methodLogger = this.logger.child({ method: 'createRun', source: input.source });
    try {
      const { data, error } = await this.supabase
        .from(ARCHIVE_RUNS)
        .insert({
          source: input.source,
          retention_days: input.retentionDays,
          cutoff: input.cutoff.toISOString(),
          status: 'running',
          started_by: input.startedBy,
        })
        .select(ARCHIVE_RUN_COLUMNS)
        .single();

      if (error) {
        if (isUniqueViolation(error)) return { kind: 'conflict' };
        throw error;
      }
      if (!data) throw new Error('archive_runs insert returned no row');
      return { kind: 'created', run: data as ArchiveRunRow };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to create an archive run');
      return { kind: 'error', error: toError(error) };
    }
  }

  /**
   * Claim a `partial` or `failed` run for Continue (C-12). The caller's run id is
   * used only here, and only a continuable run comes back; anything else is
   * `not_continuable`. Writing `last_batch_at` makes the claimed run look alive,
   * so a concurrent request cannot take it over as stale.
   */
  async claimRunForContinue(runId: string, now: Date): Promise<ClaimRunResult> {
    const methodLogger = this.logger.child({ method: 'claimRunForContinue', runId });
    try {
      const { data, error } = await this.supabase
        .from(ARCHIVE_RUNS)
        .update({ status: 'running', last_batch_at: now.toISOString(), finished_at: null, error_code: null })
        .eq('id', runId)
        .in('status', ['partial', 'failed'])
        .select(ARCHIVE_RUN_COLUMNS);

      if (error) {
        if (isUniqueViolation(error)) return { kind: 'conflict' };
        throw error;
      }
      const rows = (data ?? []) as ArchiveRunRow[];
      if (rows.length === 0) return { kind: 'not_continuable' };
      return { kind: 'claimed', run: rows[0] };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to claim an archive run');
      return { kind: 'error', error: toError(error) };
    }
  }

  /**
   * Move one batch through the source's database function. `cutoff` must be the
   * run's STORED value, passed unchanged: the function compares it exactly. The
   * reply is three counts, never row content.
   */
  async runBatchAllAccounts(
    source: ArchiveSourceKey,
    runId: string,
    cutoff: string,
    batchSize: number
  ): Promise<RepositoryResult<ArchiveBatchCounts>> {
    const methodLogger = this.logger.child({ method: 'runBatchAllAccounts', source, runId });
    try {
      const { data, error } = await this.supabase.rpc(BATCH_FUNCTIONS[source], {
        p_run_id: runId,
        p_cutoff: cutoff,
        p_batch_size: batchSize,
      });
      if (error) throw error;

      const rows: unknown[] = Array.isArray(data) ? data : [];
      const row = (rows[0] ?? {}) as Record<string, unknown>;
      const counts = {
        selected: Number(row.selected_count),
        inserted: Number(row.inserted_count),
        deleted: Number(row.deleted_count),
      };
      if (rows.length !== 1 || !Object.values(counts).every(isCount)) {
        throw new Error('archive batch returned an unexpected reply');
      }
      return { data: counts, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Archive batch failed');
      return { data: null, error: toError(error) };
    }
  }

  /** End a running run. Zero rows updated is an error: the run was no longer running. */
  async finishRun(
    runId: string,
    outcome: { status: Exclude<ArchiveRunStatus, 'running'>; errorCode: string | null; now: Date }
  ): Promise<RepositoryResult<ArchiveRunRow>> {
    const methodLogger = this.logger.child({ method: 'finishRun', runId, status: outcome.status });
    try {
      const { data, error } = await this.supabase
        .from(ARCHIVE_RUNS)
        .update({
          status: outcome.status,
          error_code: outcome.errorCode,
          finished_at: outcome.now.toISOString(),
        })
        .eq('id', runId)
        .eq('status', 'running')
        .select(ARCHIVE_RUN_COLUMNS);

      if (error) throw error;
      const rows = (data ?? []) as ArchiveRunRow[];
      if (rows.length === 0) throw new Error('archive run was not running when it was finished');
      return { data: rows[0], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to finish an archive run');
      return { data: null, error: toError(error) };
    }
  }
}

/** The counts one batch reports. `deleted` always equals `selected` (the function's invariant). */
export interface ArchiveBatchCounts {
  selected: number;
  inserted: number;
  deleted: number;
}

export type CreateRunResult =
  | { kind: 'created'; run: ArchiveRunRow }
  | { kind: 'conflict' }
  | { kind: 'error'; error: Error };

export type ClaimRunResult =
  | { kind: 'claimed'; run: ArchiveRunRow }
  | { kind: 'not_continuable' }
  | { kind: 'conflict' }
  | { kind: 'error'; error: Error };

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** PostgREST errors are plain objects, not `Error` instances. */
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error(String(error));
}

// Singleton instance for convenience
export const archiveRepository = new ArchiveRepository();
