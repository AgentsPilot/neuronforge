// lib/repositories/BusinessOsDataExportJobRepository.ts
//
// Data export DE-8a (BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md §5; requirement
// BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.4.1 A): the "Download my data"
// jobs table, public.business_os_data_exports (migration 20261074).
//
// SERVICE ROLE BY DESIGN. The table has RLS on with no policy and no grant to
// anon or authenticated (SA Q-4): no browser path reads it. The owner reaches
// it through the DE-8b / DE-9 routes, an admin through DE-10a. So the default
// client is `supabaseServer`, and the user_id filter on every per-account
// method is the tenant boundary (CLAUDE.md rule 4, tenant-isolation-guard):
//
// - A job id from a URL is not a capability. Every per-account method takes
//   (jobId, userId) and filters both, so a foreign id returns null / false,
//   never another tenant's row.
// - Write payloads are built field by field here; nothing from the caller is
//   spread into an update.
// - The start function takes no job id. Its user id comes from the session
//   (startForOwner) or from the admin route's path after requireAdmin
//   (startForAdmin, SA-3), never from a body or a header (SA C-10).
// - The three sweep reads (listDueForExpiry, findJobsByIds and, since DE-8b,
//   listStaleRunning) are cross-account by design and are for the DE-8b cron
//   only.
//
// Not a soft-delete table and no delete method: rows are never deleted by the
// app (D-7). ready turns expired when the file goes; the row stays as the
// record until Purge or account deletion.
//
// Logs carry ids, counts, bytes and durations only (§0.3.2), never content.
// Every method returns { data, error } and never throws. Invalid input is an
// error WITHOUT a database call. No update combines .or() with .select() (the
// PostgREST 42703 bug).

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { EXPORT_JOB_POLICY } from '@/lib/business-os/data-export/jobPolicy';
import type {
  AgentRepositoryResult as RepositoryResult,
  DataExportFailureReason,
  DataExportJob,
  DataExportJobCounts,
  DataExportJobState,
  DataExportRequesterKind,
  DataExportSweepRef,
  DataExportStartOutcome,
} from './types';

const TABLE = 'business_os_data_exports';
const START_FUNCTION = 'business_os_data_export_start';

/** Explicit columns, never `*`. */
export const DATA_EXPORT_JOB_COLUMNS =
  'id, user_id, requested_by, requested_by_kind, status, failure_reason, bytes, file_count, row_count, ' +
  'created_at, finished_at, ready_at, expires_at, expired_at, owner_downloaded_at, updated_at';

/** The two sweep reads (DE-10a: the kind decides where the audit row goes, SA-2). */
const SWEEP_REF_COLUMNS = 'id, user_id, requested_by_kind';

export const DATA_EXPORT_JOB_LIMITS = {
  LIST_DEFAULT: 10,
  LIST_MAX: 20,
  DUE_FOR_EXPIRY_MAX: 500,
  IDS_CHUNK: 100,
  IDS_MAX: 1_000,
} as const;

const uuid = z.string().uuid();
const requesterKind = z.enum(['owner', 'admin']);
const failureReason = z.enum(['over_ceiling', 'timeout', 'error']);
const count = z.number().int().nonnegative().safe();
const counts = z.object({ bytes: count, fileCount: count, rowCount: count }).strict();

const startRow = z.object({
  result_outcome: z.enum(['started', 'in_progress', 'daily_limit']),
  result_job_id: z.string().uuid().nullable(),
  result_retry_at: z.string().nullable(),
});

/** A fresh Error carrying only code and message, so `details` never reaches a log. */
function toError(error: unknown): Error {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown database error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function invalid(what: string): Error {
  return new Error(`Invalid input: ${what}`);
}

export class BusinessOsDataExportJobRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role on purpose: the table is service-role only (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsDataExportJobRepository' });
  }

  // ============ Start (the rate limit lives in the database) ============

  /**
   * The owner starts their own export. The one id is both the account and the
   * requester, so an owner route cannot build a mismatched call (SA C-10).
   * `sessionUserId` must come from `supabase.auth.getUser()`.
   */
  async startForOwner(sessionUserId: string): Promise<RepositoryResult<DataExportStartOutcome>> {
    if (!uuid.safeParse(sessionUserId).success) return { data: null, error: invalid('user id') };
    return this.start(sessionUserId, sessionUserId, 'owner');
  }

  /**
   * An admin starts an export of a customer's account. `targetUserId` is the
   * route path id after requireAdmin; `adminUserId` is the admin's own auth
   * user id from the session, never admin_users.id (SA Q-2).
   */
  async startForAdmin(targetUserId: string, adminUserId: string): Promise<RepositoryResult<DataExportStartOutcome>> {
    if (!uuid.safeParse(targetUserId).success || !uuid.safeParse(adminUserId).success) {
      return { data: null, error: invalid('user id') };
    }
    return this.start(targetUserId, adminUserId, 'admin');
  }

  private async start(
    userId: string,
    requestedBy: string,
    kind: 'owner' | 'admin',
  ): Promise<RepositoryResult<DataExportStartOutcome>> {
    const methodLogger = this.logger.child({ method: 'start', userId, kind });
    const startTime = Date.now();
    try {
      const { data, error } = await this.supabase.rpc(START_FUNCTION, {
        p_user_id: userId,
        p_requested_by: requestedBy,
        p_requested_by_kind: kind,
      });
      if (error) throw error;

      const first = Array.isArray(data) ? data[0] : data;
      const parsed = startRow.safeParse(first);
      if (!parsed.success) throw new Error('data export start: unexpected answer from the start function');
      const row = parsed.data;

      let outcome: DataExportStartOutcome;
      if (row.result_outcome === 'started') {
        if (!row.result_job_id) throw new Error('data export start: started without a job id');
        outcome = { outcome: 'started', jobId: row.result_job_id };
      } else {
        if (!row.result_retry_at) throw new Error('data export start: a refusal without a retry time');
        outcome = { outcome: row.result_outcome, retryAt: row.result_retry_at };
      }

      methodLogger.info(
        { outcome: outcome.outcome, jobId: outcome.outcome === 'started' ? outcome.jobId : undefined, duration: Date.now() - startTime },
        'Data export start answered',
      );
      return { data: outcome, error: null };
    } catch (err) {
      const safe = toError(err);
      methodLogger.error({ err: safe, duration: Date.now() - startTime }, 'Data export start failed');
      return { data: null, error: safe };
    }
  }

  // ============ Per-account reads ============

  async findById(jobId: string, userId: string): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(DATA_EXPORT_JOB_COLUMNS)
        .eq('id', jobId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return { data: (data as DataExportJob | null) ?? null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findById', jobId, userId }, 'Failed to read data export job');
      return { data: null, error: safe };
    }
  }

  /**
   * DE-10a (SA-5, DE-9 C-4 note 1): the owner's OWN export by id, for the
   * owner "download again" route. An admin-prepared job of the same account is
   * exactly a missing one (null), so an owner who learns its id gets a 404,
   * never a link, a 410 hint or an audit row (BQ-SA-2).
   */
  async findOwnerJobById(jobId: string, userId: string): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(DATA_EXPORT_JOB_COLUMNS)
        .eq('id', jobId)
        .eq('user_id', userId)
        .eq('requested_by_kind', 'owner')
        .maybeSingle();
      if (error) throw error;
      return { data: (data as DataExportJob | null) ?? null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findOwnerJobById', jobId, userId }, 'Failed to read the owner data export job');
      return { data: null, error: safe };
    }
  }

  async findLatestForUser(userId: string): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(DATA_EXPORT_JOB_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const rows = (data as unknown as DataExportJob[] | null) ?? [];
      return { data: rows[0] ?? null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findLatestForUser', userId }, 'Failed to read the latest data export job');
      return { data: null, error: safe };
    }
  }

  /**
   * DE-9: the owner's newest export that was DELIVERED, for "Last export …"
   * (GET /api/business-os/data-exports). `ready` or `expired` only: a failed
   * or running job was not handed over and never counts as the last export.
   *
   * SA DE-9 C-4: owner-requested jobs only. DE-10a writes admin-prepared jobs
   * onto the customer's own user_id, and BQ-SA-2 rules out telling the owner
   * about an export an admin made, so an admin-kind row is never returned.
   */
  async findLatestCompletedForUser(userId: string): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(DATA_EXPORT_JOB_COLUMNS)
        .eq('user_id', userId)
        .eq('requested_by_kind', 'owner')
        .in('status', ['ready', 'expired'])
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const rows = (data as unknown as DataExportJob[] | null) ?? [];
      return { data: rows[0] ?? null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findLatestCompletedForUser', userId }, 'Failed to read the last completed data export');
      return { data: null, error: safe };
    }
  }

  async listForUser(userId: string, options?: { limit?: number }): Promise<RepositoryResult<DataExportJob[]>> {
    const limit = options?.limit ?? DATA_EXPORT_JOB_LIMITS.LIST_DEFAULT;
    if (!uuid.safeParse(userId).success) return { data: null, error: invalid('user id') };
    if (!z.number().int().min(1).max(DATA_EXPORT_JOB_LIMITS.LIST_MAX).safeParse(limit).success) {
      return { data: null, error: invalid('limit') };
    }
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(DATA_EXPORT_JOB_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { data: (data as unknown as DataExportJob[] | null) ?? [], error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listForUser', userId }, 'Failed to list data export jobs');
      return { data: null, error: safe };
    }
  }

  // ============ Per-account writes ============

  /**
   * running -> ready. One clock reading gives finished_at, ready_at and
   * expires_at (ready_at + 72 hours), so the table's expiry CHECK holds.
   * Returns null when the row is no longer running (the stale rule took it):
   * DE-8b then removes the object it uploaded.
   */
  async markReady(jobId: string, userId: string, sizes: DataExportJobCounts): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    const parsedCounts = counts.safeParse(sizes);
    if (!parsedCounts.success) return { data: null, error: invalid('counts') };
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + EXPORT_JOB_POLICY.RETENTION_HOURS * 3_600_000).toISOString();
    const payload = {
      status: 'ready' as const,
      bytes: parsedCounts.data.bytes,
      file_count: parsedCounts.data.fileCount,
      row_count: parsedCounts.data.rowCount,
      finished_at: nowIso,
      ready_at: nowIso,
      expires_at: expiresIso,
      updated_at: nowIso,
    };
    return this.finishRunning('markReady', jobId, userId, payload, { bytes: payload.bytes });
  }

  /** running -> failed, with a reason and, when known, the sizes reached. */
  async markFailed(
    jobId: string,
    userId: string,
    reason: DataExportFailureReason,
    sizes?: Partial<DataExportJobCounts>,
  ): Promise<RepositoryResult<DataExportJob>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    if (!failureReason.safeParse(reason).success) return { data: null, error: invalid('failure reason') };
    const parsedCounts = counts.partial().safeParse(sizes ?? {});
    if (!parsedCounts.success) return { data: null, error: invalid('counts') };
    const nowIso = new Date().toISOString();
    const payload: Record<string, string | number> = {
      status: 'failed',
      failure_reason: reason,
      finished_at: nowIso,
      updated_at: nowIso,
    };
    if (parsedCounts.data.bytes !== undefined) payload.bytes = parsedCounts.data.bytes;
    if (parsedCounts.data.fileCount !== undefined) payload.file_count = parsedCounts.data.fileCount;
    if (parsedCounts.data.rowCount !== undefined) payload.row_count = parsedCounts.data.rowCount;
    return this.finishRunning('markFailed', jobId, userId, payload, { reason });
  }

  private async finishRunning(
    method: 'markReady' | 'markFailed',
    jobId: string,
    userId: string,
    payload: Record<string, string | number>,
    logFacts: Record<string, string | number>,
  ): Promise<RepositoryResult<DataExportJob>> {
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update(payload)
        .eq('id', jobId)
        .eq('user_id', userId)
        .eq('status', 'running')
        .select(DATA_EXPORT_JOB_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      const job = (data as DataExportJob | null) ?? null;
      this.logger.info({ method, jobId, userId, updated: job !== null, ...logFacts }, 'Data export job finished');
      return { data: job, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method, jobId, userId }, 'Failed to finish data export job');
      return { data: null, error: safe };
    }
  }

  /**
   * Records the owner's FIRST download only. true if this call recorded it.
   * DE-10a (SA-5): owner-requested jobs only, so nothing (an admin download
   * included) can stamp an admin-prepared job as downloaded by the owner.
   */
  async markOwnerDownloaded(jobId: string, userId: string): Promise<RepositoryResult<boolean>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update({ owner_downloaded_at: nowIso, updated_at: nowIso })
        .eq('id', jobId)
        .eq('user_id', userId)
        .eq('status', 'ready')
        .eq('requested_by_kind', 'owner')
        .is('owner_downloaded_at', null)
        .select('id');
      if (error) throw error;
      return { data: ((data as unknown[] | null) ?? []).length > 0, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'markOwnerDownloaded', jobId, userId }, 'Failed to record the export download');
      return { data: null, error: safe };
    }
  }

  /**
   * "A newer export replaces the old one" (§0.4.1 A): every other ready job of
   * this account AND OF THE SAME KIND turns expired. Returns their ids; DE-8b
   * removes their objects.
   *
   * DE-10a (SA-4, TL default BC-3): an owner export never expires an
   * admin-prepared one and an admin export never expires the owner's, so
   * neither side silently deletes the other's file. `kind` is the ready job's
   * own (runZipExport reads it from markReady's row, never from a caller).
   */
  async expireOtherReady(userId: string, keepJobId: string, kind: DataExportRequesterKind): Promise<RepositoryResult<string[]>> {
    if (!uuid.safeParse(userId).success || !uuid.safeParse(keepJobId).success) return { data: null, error: invalid('id') };
    if (!requesterKind.safeParse(kind).success) return { data: null, error: invalid('kind') };
    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update({ status: 'expired', expired_at: nowIso, updated_at: nowIso })
        .eq('user_id', userId)
        .eq('status', 'ready')
        .eq('requested_by_kind', kind)
        .neq('id', keepJobId)
        .select('id');
      if (error) throw error;
      const ids = ((data as Array<{ id: string }> | null) ?? []).map((row) => row.id);
      this.logger.info({ method: 'expireOtherReady', userId, keepJobId, kind, expired: ids.length }, 'Older data exports expired');
      return { data: ids, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'expireOtherReady', userId }, 'Failed to expire older data exports');
      return { data: null, error: safe };
    }
  }

  /** ready -> expired for one job. Idempotent: false when it was not ready (any more). */
  async markExpired(jobId: string, userId: string): Promise<RepositoryResult<boolean>> {
    if (!uuid.safeParse(jobId).success || !uuid.safeParse(userId).success) return { data: null, error: invalid('id') };
    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await this.supabase
        .from(TABLE)
        .update({ status: 'expired', expired_at: nowIso, updated_at: nowIso })
        .eq('id', jobId)
        .eq('user_id', userId)
        .eq('status', 'ready')
        .select('id');
      if (error) throw error;
      return { data: ((data as unknown[] | null) ?? []).length > 0, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'markExpired', jobId, userId }, 'Failed to expire data export job');
      return { data: null, error: safe };
    }
  }

  // ============ Cross-account sweep reads (DE-8b cron only) ============

  /**
   * Ready jobs whose 72 hours are over, oldest first. DE-10a (SA-2): with the
   * requester kind, so the sweep places the audit row of an admin job off the
   * owner's account.
   */
  async listDueForExpiry(now: Date, limit: number = DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX): Promise<RepositoryResult<DataExportSweepRef[]>> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { data: null, error: invalid('now') };
    if (!z.number().int().min(1).max(DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX).safeParse(limit).success) {
      return { data: null, error: invalid('limit') };
    }
    try {
      // Cross-account by design: the daily sweep has no user context; every effect it takes is scoped by the row's own user_id (tenant-isolation-guard Step 6).
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(SWEEP_REF_COLUMNS)
        .eq('status', 'ready')
        .lte('expires_at', now.toISOString())
        .order('expires_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return { data: (data as unknown as DataExportSweepRef[] | null) ?? [], error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listDueForExpiry' }, 'Failed to list data exports due for expiry');
      return { data: null, error: safe };
    }
  }

  /**
   * DE-8b (SA DE-8a Q-12): `running` jobs created before `before`, oldest
   * first. The cron passes `now - STALE_RUNNING_SECONDS`, the same predicate
   * the start function applies for one account, so a killed run of an owner
   * who never exports again is still turned failed / timeout. With the
   * requester kind since DE-10a (SA-2), as listDueForExpiry.
   */
  async listStaleRunning(before: Date, limit: number = DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX): Promise<RepositoryResult<DataExportSweepRef[]>> {
    if (!(before instanceof Date) || Number.isNaN(before.getTime())) return { data: null, error: invalid('before') };
    if (!z.number().int().min(1).max(DATA_EXPORT_JOB_LIMITS.DUE_FOR_EXPIRY_MAX).safeParse(limit).success) {
      return { data: null, error: invalid('limit') };
    }
    try {
      // Cross-account by design: the daily sweep has no user context; every effect it takes is scoped by the row's own user_id (tenant-isolation-guard Step 6).
      const { data, error } = await this.supabase
        .from(TABLE)
        .select(SWEEP_REF_COLUMNS)
        .eq('status', 'running')
        .lt('created_at', before.toISOString())
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return { data: (data as unknown as DataExportSweepRef[] | null) ?? [], error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listStaleRunning' }, 'Failed to list stale data export runs');
      return { data: null, error: safe };
    }
  }

  /**
   * The jobs behind objects found in the bucket. The orphan sweep treats an
   * object as orphaned unless a row exists with the SAME user_id as the
   * object's folder and status running or ready. Too many ids is refused, not
   * truncated.
   */
  async findJobsByIds(jobIds: string[]): Promise<RepositoryResult<DataExportJobState[]>> {
    const unique = [...new Set(jobIds)];
    if (unique.length > DATA_EXPORT_JOB_LIMITS.IDS_MAX) return { data: null, error: invalid('too many ids') };
    if (!unique.every((id) => uuid.safeParse(id).success)) return { data: null, error: invalid('id') };
    if (unique.length === 0) return { data: [], error: null };
    try {
      const rows: DataExportJobState[] = [];
      for (let i = 0; i < unique.length; i += DATA_EXPORT_JOB_LIMITS.IDS_CHUNK) {
        const chunk = unique.slice(i, i + DATA_EXPORT_JOB_LIMITS.IDS_CHUNK);
        // Cross-account by design: the daily sweep has no user context; every effect it takes is scoped by the row's own user_id (tenant-isolation-guard Step 6).
        const { data, error } = await this.supabase
          .from(TABLE)
          .select('id, user_id, status')
          .in('id', chunk);
        if (error) throw error;
        rows.push(...((data as DataExportJobState[] | null) ?? []));
      }
      return { data: rows, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findJobsByIds', ids: unique.length }, 'Failed to read data export jobs by id');
      return { data: null, error: safe };
    }
  }
}

export const businessOsDataExportJobRepository = new BusinessOsDataExportJobRepository();
