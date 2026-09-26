// lib/repositories/ArchiveRepository.ts
// Access for the admin Archiving module. READ-ONLY in Slice 1.
//
// INTENTIONAL SERVICE-ROLE CLIENT (RLS bypass). Archiving is platform
// maintenance across every account; there is no per-user caller. CLAUDE.md
// Rule 4 is met BY NAME instead of by argument: every method that reads across
// accounts ends in `AllAccounts`, so "all accounts" is reached by calling a
// differently named method, never by leaving an argument out (the
// `TokenUsageRepository` precedent).
//
// ONLY CALLER: `GET /api/admin/archiving`, which is behind `requireAdmin`.
//
// Slice 1 reads `audit_trail` counts only. No insert, update or delete exists
// here; Slice 2 adds the run methods and Slice 3 the per-user ones (condition
// C-7: all archive access goes through this file).
//
// No row content is ever read. Counts select nothing (`head: true`), and the
// oldest-row lookup selects `created_at` alone, so no personal data passes
// through (AC-14). Counts use `count: 'exact', head: true` because PostgREST
// aggregates are disabled on this project (F-10).
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const AUDIT_TRAIL = 'audit_trail';

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
   * `<` is the same comparison Slice 2's move function uses (requirement §5.3).
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
