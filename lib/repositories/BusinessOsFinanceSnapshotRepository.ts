// lib/repositories/BusinessOsFinanceSnapshotRepository.ts
// Writes to `business_os_finance_snapshots`, the nightly finance history
// (finance slice 8.2, §11M.7 HS-FR-5; migration 20261078, slice 8.1).
//
// WHO MAY CALL IT: only `lib/business-os/finance/financeSnapshotDeps.ts`
// imports it, and only `lib/business-os/finance/financeSnapshotJob.ts` calls
// `insertSnapshotRows` (8.2-R2, pinned by the finance source guard). The job
// takes no caller input: every row is built from platform aggregates.
//
// SERVICE ROLE, AND NO user_id FILTER, ON PURPOSE. The table holds no tenant
// data: no user id, no account, no name and no money, only counts of accounts
// and amounts of credits per UTC day (HS-W-8, HS-W-9; the 8.1 CHECKs refuse
// anything else). CLAUDE.md rule 4 (`.eq('user_id', userId)`) has nothing to
// scope. RLS is on with no policy; only the service role holds SELECT and a
// five-column INSERT (no UPDATE, no DELETE).
//
// THE TABLE MAY NOT EXIST YET (HS-FR-8b, E-96). 20261078 is applied by hand;
// `probeTable` tells "not installed" from a real failure with the shared
// `isMissingRelationError` (a missing COLUMN is a real failure). That is the
// deliberate exception to the new-repository skill's "stop if the table does
// not exist", as in BosCronRunRepository.
//
// APPEND ONLY. No update, delete or rpc method, ever. Every method returns
// `{ data, error }` and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';
import { isMissingRelationError } from './supabaseErrorCodes';

const TABLE = 'business_os_finance_snapshots';
/** The table's idempotency key (8.1 unique index), the ON CONFLICT target. */
const ON_CONFLICT = 'as_of_date,metric,dimension';

/** Exactly the five columns the 8.1 grant lets the job insert. */
export interface FinanceSnapshotInsertRow {
  as_of_date: string;
  metric: string;
  dimension: string;
  unit: 'accounts' | 'credits';
  value: number;
}

export interface FinanceSnapshotInsertResult {
  /** Rows actually written (the returned ids). */
  written: number;
  /** Rows whose day, metric and dimension were already recorded: sent minus written. */
  alreadyThere: number;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const e = (error ?? {}) as SupabaseErrorLike;
  const wrapped = new Error(e.message ?? 'Supabase error') as Error & { code?: string };
  if (e.code) wrapped.code = e.code;
  return wrapped;
}

export class BusinessOsFinanceSnapshotRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsFinanceSnapshotRepository' });
  }

  /** Whether the table is there (E-96): `installed: false` only for a missing relation. */
  async probeTable(): Promise<RepositoryResult<{ installed: boolean }>> {
    const method = 'probeTable';
    try {
      const { error } = await this.supabase.from(TABLE).select('id').limit(1);
      if (!error) return { data: { installed: true }, error: null };
      if (isMissingRelationError(error)) return { data: { installed: false }, error: null };
      const err = asError(error);
      this.logger.error({ err, method }, 'Finance snapshot table probe failed');
      return { data: null, error: err };
    } catch (error) {
      const err = asError(error);
      this.logger.error({ err, method }, 'Finance snapshot table probe failed');
      return { data: null, error: err };
    }
  }

  /**
   * ONE batched insert, ON CONFLICT DO NOTHING on the day key, returning the ids
   * of the rows actually written (E-88). It needs only the SELECT and the
   * five-column INSERT grants, never UPDATE. Each row is rebuilt field by field
   * (tenant-isolation-guard step 3), so nothing but the five columns is sent.
   */
  async insertSnapshotRows(rows: readonly FinanceSnapshotInsertRow[]): Promise<RepositoryResult<FinanceSnapshotInsertResult>> {
    const method = 'insertSnapshotRows';
    if (rows.length === 0) return { data: { written: 0, alreadyThere: 0 }, error: null };
    const payload = rows.map((row) => ({
      as_of_date: row.as_of_date,
      metric: row.metric,
      dimension: row.dimension,
      unit: row.unit,
      value: row.value,
    }));
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .upsert(payload, { onConflict: ON_CONFLICT, ignoreDuplicates: true })
        .select('id');
      if (error) {
        const err = asError(error);
        this.logger.error({ err, method, rows: payload.length }, 'Finance snapshot insert failed');
        return { data: null, error: err };
      }
      const written = Array.isArray(data) ? data.length : 0;
      return { data: { written, alreadyThere: payload.length - written }, error: null };
    } catch (error) {
      const err = asError(error);
      this.logger.error({ err, method, rows: payload.length }, 'Finance snapshot insert failed');
      return { data: null, error: err };
    }
  }
}

export const businessOsFinanceSnapshotRepository = new BusinessOsFinanceSnapshotRepository();
