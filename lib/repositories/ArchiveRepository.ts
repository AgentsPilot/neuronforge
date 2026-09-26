// lib/repositories/ArchiveRepository.ts
// Access for the admin Archiving module. READ-ONLY in Slice 2a.
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). Archiving is platform
// maintenance across every account; there is no per-user caller. CLAUDE.md
// Rule 4 is met BY NAME instead of by argument: every method that reads account
// data across accounts (`audit_trail`, `archived_records`) ends in
// `AllAccounts`, so "all accounts" is reached by calling a differently named
// method, never by leaving an argument out (the `TokenUsageRepository`
// precedent). Methods over `archive_runs` have plain names: that table holds no
// account data and has no `user_id` at all, so there is no scope to omit
// (Slice 2 SA Q-7).
//
// ONLY CALLER: `GET /api/admin/archiving`, which is behind `requireAdmin`.
//
// Slice 2a adds the archive-side reads (archived total, run list, latest
// cutoff). There is still no insert, update, delete or rpc here: the run
// methods arrive in Slice 2b and the per-user erasure/export methods in
// Slice 3 (condition C-7: all archive access goes through this file).
//
// No row content is ever read. Counts select nothing (`head: true`), the
// oldest-row lookup selects `created_at` alone, and the run list names its
// columns. No method selects `archived_records.payload` (AC-14). Counts use
// `count: 'exact', head: true` because PostgREST aggregates are disabled on this
// project (F-10).
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const AUDIT_TRAIL = 'audit_trail';
const ARCHIVED_RECORDS = 'archived_records';
const ARCHIVE_RUNS = 'archive_runs';

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
