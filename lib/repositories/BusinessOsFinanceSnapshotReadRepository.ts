// lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts
// Reads `business_os_finance_snapshots`, the nightly finance history (finance
// slice 8.3, §11M.8 HS-FR-10, E-98; migration 20261078, slice 8.1).
//
// READ ONLY, ON PURPOSE (E-98, SA-W-8.3-5). The writer is a separate
// repository with exactly one importer, the 8.2 job's wiring; this read side
// has no insert, upsert, update, delete or rpc, so a read slice can never
// reach a write (the finance source guard pins both).
//
// WHO MAY CALL IT: only `lib/business-os/finance/financeHistoryDeps.ts`
// imports it, and only `GET /api/admin/business-os/finance/history` (behind
// `requireAdmin`) imports that wiring.
//
// SERVICE ROLE, AND NO user_id FILTER, ON PURPOSE. The table holds no tenant
// data: counts of accounts and amounts of credits per UTC day, no account, no
// name, no money (HS-W-8, HS-W-9). CLAUDE.md rule 4 has nothing to scope.
// Only the five figure columns are ever selected; `id` and `taken_at` stay in
// the database.
//
// THE TABLE MAY NOT EXIST YET (E-100). A missing relation (the shared
// `isMissingRelationError`; a missing COLUMN is a real error) answers
// `not_installed`, the deliberate exception to the new-repository skill's
// "stop if the table does not exist", as in BosCronRunRepository.
//
// Every method returns `{ data, error }` and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';
import { isMissingRelationError } from './supabaseErrorCodes';

const TABLE = 'business_os_finance_snapshots';
/** Exactly the five figure columns (HS-FR-10). */
export const FINANCE_SNAPSHOT_READ_COLUMNS = 'as_of_date, metric, dimension, unit, value';
/** HS-FR-10: at most 93 days of about 40 rows; past this the read is an error, never a partial list. */
export const FINANCE_SNAPSHOT_READ_CEILING = 5000;
/** PostgREST caps every response at 1,000 rows, so the range read pages (SA-CR-8.3 C-1). */
export const FINANCE_SNAPSHOT_READ_PAGE_SIZE = 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface FinanceSnapshotReadRow {
  as_of_date: string;
  metric: string;
  dimension: string;
  unit: 'accounts' | 'credits';
  /** numeric(18,6) comes back as a number or a string; the view reads it with `Number`. */
  value: number | string;
}

export type FinanceSnapshotRead<T> = { state: 'not_installed' } | ({ state: 'ready' } & T);

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

export class BusinessOsFinanceSnapshotReadRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsFinanceSnapshotReadRepository' });
  }

  /** The earliest `as_of_date` recorded, or null when the table is empty. */
  async findFirstSnapshotDate(): Promise<RepositoryResult<FinanceSnapshotRead<{ firstDate: string | null }>>> {
    const method = 'findFirstSnapshotDate';
    try {
      const { data, error } = await this.supabase.from(TABLE).select('as_of_date').order('as_of_date', { ascending: true }).limit(1);
      if (error) {
        if (isMissingRelationError(error)) return { data: { state: 'not_installed' }, error: null };
        const err = asError(error);
        this.logger.error({ err, method }, 'Finance snapshot read failed');
        return { data: null, error: err };
      }
      const first = Array.isArray(data) && data.length > 0 ? (data[0] as { as_of_date: string }).as_of_date : null;
      return { data: { state: 'ready', firstDate: first }, error: null };
    } catch (error) {
      const err = asError(error);
      this.logger.error({ err, method }, 'Finance snapshot read failed');
      return { data: null, error: err };
    }
  }

  /** Every snapshot row with `as_of_date` from `fromDate` to `toDate`, inclusive. An error at the ceiling. */
  async listSnapshotsInRange(
    fromDate: string,
    toDate: string
  ): Promise<RepositoryResult<FinanceSnapshotRead<{ rows: FinanceSnapshotReadRow[] }>>> {
    const method = 'listSnapshotsInRange';
    if (!DATE.test(fromDate) || !DATE.test(toDate)) {
      return { data: null, error: new Error('listSnapshotsInRange needs two YYYY-MM-DD dates') };
    }
    try {
      // SA-CR-8.3 C-1: PostgREST returns at most 1,000 rows per call, so read in pages of that size,
      // ordered by the table's unique key (day, metric, dimension) so the pages never overlap or skip.
      // A short page ends the read; passing the ceiling is an error, never a partial list.
      const rows: FinanceSnapshotReadRow[] = [];
      for (let offset = 0; ; offset += FINANCE_SNAPSHOT_READ_PAGE_SIZE) {
        const { data, error } = await this.supabase
          .from(TABLE)
          .select(FINANCE_SNAPSHOT_READ_COLUMNS)
          .gte('as_of_date', fromDate)
          .lte('as_of_date', toDate)
          .order('as_of_date', { ascending: true })
          .order('metric', { ascending: true })
          .order('dimension', { ascending: true })
          .range(offset, offset + FINANCE_SNAPSHOT_READ_PAGE_SIZE - 1);
        if (error) {
          if (isMissingRelationError(error)) return { data: { state: 'not_installed' }, error: null };
          const err = asError(error);
          this.logger.error({ err, method, offset }, 'Finance snapshot read failed');
          return { data: null, error: err };
        }
        const page = (Array.isArray(data) ? data : []) as FinanceSnapshotReadRow[];
        rows.push(...page);
        if (rows.length > FINANCE_SNAPSHOT_READ_CEILING) {
          const err = new Error('Finance snapshot read reached its ceiling');
          this.logger.error({ err, method, ceiling: FINANCE_SNAPSHOT_READ_CEILING }, 'Finance snapshot read reached its ceiling');
          return { data: null, error: err };
        }
        if (page.length < FINANCE_SNAPSHOT_READ_PAGE_SIZE) break;
      }
      return { data: { state: 'ready', rows }, error: null };
    } catch (error) {
      const err = asError(error);
      this.logger.error({ err, method }, 'Finance snapshot read failed');
      return { data: null, error: err };
    }
  }
}

export const businessOsFinanceSnapshotReadRepository = new BusinessOsFinanceSnapshotReadRepository();
