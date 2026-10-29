// lib/repositories/BusinessOsExportModuleJobRepository.ts
//
// Module export MX-1a (workplan BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md §4.3, D-9,
// D-13; requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md XC-7, XC-8,
// XC-9): the module jobs of export requests,
// public.business_os_export_module_jobs (migration 20261095). The queue the
// MX-3 worker drains, and the history the owner sees.
//
// SERVICE ROLE BY DESIGN. The table has RLS on with no policy and no grant to
// anon or authenticated. So the default client is `supabaseServer`, and the
// user_id filter on every per-account method is the tenant boundary
// (CLAUDE.md rule 4, tenant-isolation-guard):
//
// - There is no insert method: only the database start function inserts jobs,
//   with the request id and user id from one set of arguments (D-4).
// - `listForRequestsOfUser` (MX-1b history) filters on user_id AND takes only
//   request ids the user-scoped request read returned, and its rows carry no
//   Resend id, claim field or error code. The history is limited by REQUEST in
//   the request repository's listRecentForUser, never by job row
//   (SA MX-1a code review comment 1), and parsed one row at a time.
// - `claimDue` and `reapStale` are ⟨unscoped-by-design⟩: the worker claims and
//   reaps rows of every account, the PluginConnectionRepository precedent.
//   Every later effect of the worker is scoped to the claimed row's user_id
//   (tenant-isolation-guard step 6).
//
// The lease (420 s) is a literal in the SQL claim and reap functions, with no
// lease parameter, and both run with the rights of their caller: a ruled
// deviation from durable-queue-drain steps 2 and 3 (SECURITY DEFINER and
// p_lease_seconds), SA MX1A-6 and MX1A-8, the DL-1a O-4 precedent. Two models
// on purpose: a reaper judges a stale build by its parts (XC-9), and the
// notice branch keeps the lease in the claim predicate.
//
// The worker's writes (MX-3a, BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §7; their
// caller is the MX-3b worker) are compare-and-set: each filters on id +
// user_id + claimed_by + the expected status or notice state, and counts rows
// with { count: 'exact' }, never update + .or() + .select() (the PostgREST
// 42703 bug). 1 row is done; 0 rows means the claim was lost (lease expired
// and reaped) and comes back as { updated: false }. Every patch sets
// updated_at itself: the table has no trigger (SA C-2). Each patch is shaped
// to pass the row CHECKs of 20261095 in one update.
//
// WHO MAY IMPORT THIS FILE is pinned by
// lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts.
// It is not exported from the `lib/repositories` barrel on purpose (S-16).
//
// Logs carry ids, statuses, counts and codes only. Every method returns
// { data, error } and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import {
  CODE_SHAPE,
  MODULE_EXPORT_POLICY,
  MODULE_JOB_STATUSES,
  NOTICE_STATES,
  PART_STATES,
  type ModuleJobStatus,
  type NoticeState,
} from '@/lib/business-os/data-export/moduleExportPolicy';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The claim and reap functions of migration 20261095. */
export const MODULE_JOB_CLAIM_FUNCTION = 'business_os_export_module_jobs_claim_due';
export const MODULE_JOB_REAP_FUNCTION = 'business_os_export_module_jobs_reap';

/** The history read (MX-1b §5 step 2): only the columns the history line needs. */
export const MODULE_JOB_HISTORY_COLUMNS = 'id, request_id, module, status, parts, sent_at';

/** The most request ids one history read takes (SA MX1B-9: the request read's ceiling). */
export const HISTORY_REQUEST_IDS_MAX = 50;

const uuid = z.string().uuid();
const timestamp = z.string().min(1).max(64);
const code = z.string().regex(CODE_SHAPE);

/** One emailed part (XC-9). The SQL CHECK proves n and state; this also proves the rest. */
export const modulePartSchema = z.object({
  n: z.number().int().min(1),
  state: z.enum(PART_STATES),
  resend_id: z.string().min(1).max(128).nullable(),
  at: timestamp,
});
export type ModulePart = z.infer<typeof modulePartSchema>;

/** One stored job, as the claim and reap functions return it (`RETURNING job.*`). */
export const moduleJobRowSchema = z.object({
  id: uuid,
  request_id: uuid,
  user_id: uuid,
  // Shape, not the enum (SA MX1A-10): a module renamed later still reaches the
  // worker, which fails it with a code, instead of being dropped on every claim.
  module: code,
  status: z.enum(MODULE_JOB_STATUSES),
  parts_total: z.number().int().min(1).nullable(),
  parts: z.array(modulePartSchema),
  row_count: z.number().int().nonnegative().nullable(),
  failure_code: code.nullable(),
  notice_state: z.enum(NOTICE_STATES),
  notice_attempts: z.number().int().nonnegative(),
  notice_sent_at: timestamp.nullable(),
  notice_resend_id: z.string().max(128).nullable(),
  claimed_by: uuid.nullable(),
  claimed_at: timestamp.nullable(),
  attempts: z.number().int().nonnegative(),
  next_attempt_at: timestamp.nullable(),
  last_error_code: code.nullable(),
  started_at: timestamp.nullable(),
  sent_at: timestamp.nullable(),
  finished_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ModuleJob = z.infer<typeof moduleJobRowSchema>;

/**
 * A part as the HISTORY reads it: the state only (QA MX-1a finding 1). The SQL
 * CHECK proves only `n` and `state`, so a part written without `resend_id` or
 * `at` must still count, and never blank the owner's history.
 */
const historyPartSchema = z.object({ state: z.enum(PART_STATES) }).passthrough();

const historyRowSchema = z.object({
  id: uuid,
  request_id: uuid,
  module: code,
  status: z.enum(MODULE_JOB_STATUSES),
  parts: z.array(historyPartSchema),
  sent_at: timestamp.nullable(),
});

/** One module job as the history shows it. Never a Resend id, a claim field or an error code. */
export interface ModuleJobHistoryRow {
  id: string;
  requestId: string;
  module: string;
  status: ModuleJobStatus;
  sentAt: string | null;
  /** How many emails of this module the mail provider accepted. */
  emailCount: number;
}

/** What the reaper changed, for the worker log and (MX-3b) the reaped-job audit. */
export interface ReapedModuleJob {
  id: string;
  userId: string;
  status: ModuleJobStatus;
  failureCode: string | null;
  noticeState: NoticeState;
  /** MX-3a, additive (§7): what the MX-3b audit of a reaped terminal job needs. */
  requestId: string;
  module: string;
  rowCount: number | null;
  partsTotal: number | null;
  partsAccepted: number;
}

/** The typed error codes callers branch on. */
export const MODULE_JOB_ERROR = {
  INVALID_INPUT: 'invalid_input',
} as const;

/** The most parts a job may carry (BQ-28); the SQL CHECK only bounds them by parts_total. */
const PARTS_MAX = 10;

/**
 * The parts array a write stores (XC-9; MX-1a QA edge case 1): all four keys
 * on every part, integer n running 1..k with no gap or duplicate.
 */
const partsWriteSchema = z
  .array(
    z
      .object({
        n: z.number().int().min(1).max(PARTS_MAX),
        state: z.enum(PART_STATES),
        resend_id: z.string().min(1).max(128).nullable(),
        at: timestamp,
      })
      .strict()
  )
  .min(1)
  .max(PARTS_MAX)
  .refine((parts) => parts.every((part, index) => part.n === index + 1), { message: 'parts must be numbered 1..k in order' });

const allAcceptedSchema = partsWriteSchema.refine((parts) => parts.every((part) => part.state === 'accepted'), {
  message: 'every part must be accepted',
});

const claimKeySchema = z.object({ jobId: uuid, userId: uuid, runnerId: uuid });

/** A failed job's code. `interrupted` belongs to markInterrupted only (row CHECK failure_shape). */
const failureCodeSchema = code.refine((value) => value !== 'interrupted', { message: 'use markInterrupted' });

const resendIdSchema = z.string().min(1).max(128).nullable();

/** The result of one compare-and-set write. */
export interface ModuleJobWriteResult {
  /** false: 0 rows matched, so the claim was lost (or the row was not in the expected state). */
  updated: boolean;
}

/** What a write expects of the row, beside id, user_id and claimed_by. */
interface WriteGuard {
  column: 'status' | 'notice_state';
  value: string;
  /** setPartsTotal only: parts_total must still be NULL. */
  partsTotalIsNull?: true;
}

const WORKING: WriteGuard = { column: 'status', value: 'working' };
const NOTICE_DUE: WriteGuard = { column: 'notice_state', value: 'due' };

/** A fresh Error carrying only code and message, so `details` never reaches a log. */
function toError(error: unknown): Error & { code?: string } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown database error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function coded(errorCode: string, message: string): Error & { code: string } {
  const out = new Error(message) as Error & { code: string };
  out.code = errorCode;
  return out;
}

/** The id of a row that failed its parse, when it has a readable one. */
function idOf(row: unknown): string | null {
  const id = row && typeof row === 'object' ? (row as Record<string, unknown>).id : null;
  return typeof id === 'string' && uuid.safeParse(id).success ? id : null;
}

export class BusinessOsExportModuleJobRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role on purpose: the table is service-role only (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsExportModuleJobRepository' });
  }

  /** Parse each row on its own: a bad row is logged by id and dropped, never processed (§4.3). */
  private parseRows(rows: unknown, method: string): ModuleJob[] {
    const list = Array.isArray(rows) ? rows : [];
    const out: ModuleJob[] = [];
    for (const row of list) {
      const parsed = moduleJobRowSchema.safeParse(row);
      if (parsed.success) out.push(parsed.data);
      else this.logger.error({ method, jobId: idOf(row) }, 'Dropped a module job row that failed its parse');
    }
    return out;
  }

  // ============ Per-account reads ============

  /**
   * The module jobs of the given requests of this account (MX-1b §5 step 2).
   * `requestIds` come from `listRecentForUser`, which already counted the limit
   * in requests, so there is no row limit here and no request is cut in half.
   * Rows are parsed one at a time: a bad row is logged by id and dropped.
   */
  async listForRequestsOfUser(userId: string, requestIds: ReadonlyArray<string>): Promise<RepositoryResult<ModuleJobHistoryRow[]>> {
    const ids = Array.from(new Set(requestIds));
    if (
      !uuid.safeParse(userId).success ||
      ids.length > HISTORY_REQUEST_IDS_MAX ||
      !ids.every((id) => uuid.safeParse(id).success)
    ) {
      return { data: null, error: coded(MODULE_JOB_ERROR.INVALID_INPUT, 'Invalid input: history') };
    }
    if (ids.length === 0) return { data: [], error: null };
    try {
      const { data, error } = await this.supabase
        .from('business_os_export_module_jobs')
        .select(MODULE_JOB_HISTORY_COLUMNS)
        .eq('user_id', userId)
        .in('request_id', ids);
      if (error) throw error;
      const out: ModuleJobHistoryRow[] = [];
      for (const row of Array.isArray(data) ? data : []) {
        const parsed = historyRowSchema.safeParse(row);
        if (!parsed.success) {
          this.logger.error({ method: 'listForRequestsOfUser', userId, jobId: idOf(row) }, 'Dropped a module job history row that failed its parse');
          continue;
        }
        out.push({
          id: parsed.data.id,
          requestId: parsed.data.request_id,
          module: parsed.data.module,
          status: parsed.data.status,
          sentAt: parsed.data.sent_at,
          emailCount: parsed.data.parts.filter((part) => part.state === 'accepted').length,
        });
      }
      return { data: out, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listForRequestsOfUser', userId, requestCount: ids.length }, 'Failed to read the export history');
      return { data: null, error: safe };
    }
  }

  // ============ The worker (⟨unscoped-by-design⟩) ============

  /**
   * ⟨unscoped-by-design⟩ Claim up to `batch` jobs of ANY account for
   * `runnerId` (MX-3): waiting jobs past their backoff become working, and due
   * failure notices under 5 attempts whose claim is free or older than the
   * lease. `FOR UPDATE SKIP LOCKED`, so two runners get disjoint batches.
   * Every later effect must be scoped to the claimed row's user_id.
   */
  async claimDue(runnerId: string, batch: number): Promise<RepositoryResult<ModuleJob[]>> {
    if (!uuid.safeParse(runnerId).success || !z.number().int().min(1).max(MODULE_EXPORT_POLICY.CLAIM_BATCH_MAX).safeParse(batch).success) {
      return { data: null, error: coded(MODULE_JOB_ERROR.INVALID_INPUT, 'Invalid input: claim') };
    }
    const startTime = Date.now();
    try {
      const { data, error } = await this.supabase.rpc(MODULE_JOB_CLAIM_FUNCTION, { p_runner: runnerId, p_batch: batch });
      if (error) throw error;
      const rows = this.parseRows(data, 'claimDue');
      this.logger.info(
        { method: 'claimDue', runnerId, claimed: rows.length, jobIds: rows.map((row) => row.id), duration: Date.now() - startTime },
        'Module export jobs claimed'
      );
      return { data: rows, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'claimDue', runnerId, duration: Date.now() - startTime }, 'Failed to claim module export jobs');
      return { data: null, error: safe };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ End every stale job of ANY account (XC-9): all parts
   * accepted is sent, any part is interrupted (never sent again), no part is a
   * retry or, after 3 attempts, failed; a notice claimed 5 times is given up.
   * The worker runs this first in every run (durable-queue-drain step 5).
   */
  async reapStale(): Promise<RepositoryResult<ReapedModuleJob[]>> {
    const startTime = Date.now();
    try {
      const { data, error } = await this.supabase.rpc(MODULE_JOB_REAP_FUNCTION);
      if (error) throw error;
      const rows: ReapedModuleJob[] = this.parseRows(data, 'reapStale').map((row) => ({
        id: row.id,
        userId: row.user_id,
        status: row.status,
        failureCode: row.failure_code,
        noticeState: row.notice_state,
        requestId: row.request_id,
        module: row.module,
        rowCount: row.row_count,
        partsTotal: row.parts_total,
        partsAccepted: row.parts.filter((part) => part.state === 'accepted').length,
      }));
      if (rows.length > 0) {
        this.logger.warn(
          { method: 'reapStale', reaped: rows.map((row) => ({ jobId: row.id, status: row.status, failureCode: row.failureCode })), duration: Date.now() - startTime },
          'Stale module export jobs reaped'
        );
      }
      return { data: rows, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'reapStale', duration: Date.now() - startTime }, 'Failed to reap module export jobs');
      return { data: null, error: safe };
    }
  }

  // ============ The worker's compare-and-set writes (MX-3a, §7) ============
  //
  // ⟨unscoped-by-design⟩ in the claim sense (the worker acts across accounts),
  // and each one ALSO filters on the claimed row's user_id, so a write is
  // pinned to the tenant whose data the effects were scoped to
  // (tenant-isolation-guard step 6; SA T-R12). None of these values comes from
  // a caller's request: the worker passes the claimed row's own id, user_id
  // and its own runner id.

  /** The current time for a patch. One per write, so updated_at and the write's own time agree. */
  private now(): string {
    return new Date().toISOString();
  }

  /**
   * One compare-and-set update. `count === 1` is done, `count === 0` is
   * `{ updated: false }` (claim lost), an error is `{ error }`. Never throws,
   * never `.select()`, and a DB error's `details` never reach a log.
   */
  private async compareAndSet(
    method: string,
    key: { jobId: string; userId: string; runnerId: string },
    guard: WriteGuard,
    patch: Record<string, unknown>
  ): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const startTime = Date.now();
    try {
      let query = this.supabase
        .from('business_os_export_module_jobs')
        .update(patch, { count: 'exact' })
        .eq('id', key.jobId)
        .eq('user_id', key.userId)
        .eq('claimed_by', key.runnerId)
        .eq(guard.column, guard.value);
      if (guard.partsTotalIsNull) query = query.is('parts_total', null);
      const { error, count } = await query;
      if (error) throw error;
      const updated = count === 1;
      if (!updated) {
        this.logger.warn(
          { method, jobId: key.jobId, userId: key.userId, runnerId: key.runnerId, count: count ?? null, duration: Date.now() - startTime },
          'Module export job write matched no row (claim lost or state moved)'
        );
      }
      return { data: { updated }, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method, jobId: key.jobId, userId: key.userId, duration: Date.now() - startTime }, 'Failed to write a module export job');
      return { data: null, error: safe };
    }
  }

  private invalid(method: string): RepositoryResult<ModuleJobWriteResult> {
    return { data: null, error: coded(MODULE_JOB_ERROR.INVALID_INPUT, `Invalid input: ${method}`) };
  }

  /** Fix `parts_total` and `row_count` before the first send (XC-9). Only while parts_total is still NULL. */
  async setPartsTotal(
    jobId: string,
    userId: string,
    runnerId: string,
    input: { partsTotal: number; rowCount: number }
  ): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    const ok =
      claimKeySchema.safeParse(key).success &&
      z.number().int().min(1).max(PARTS_MAX).safeParse(input?.partsTotal).success &&
      z.number().int().nonnegative().safeParse(input?.rowCount).success;
    if (!ok) return this.invalid('setPartsTotal');
    return this.compareAndSet('setPartsTotal', key, { ...WORKING, partsTotalIsNull: true }, {
      parts_total: input.partsTotal,
      row_count: input.rowCount,
      updated_at: this.now(),
    });
  }

  /** Part n is about to be handed to Resend: `parts` gains it as `sending` (written BEFORE the call). */
  async markPartSending(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<ModulePart>): Promise<RepositoryResult<ModuleJobWriteResult>> {
    return this.writeParts('markPartSending', { jobId, userId, runnerId }, parts);
  }

  /** Part n (not the last) was accepted: `parts` with that part `accepted` and its Resend id. */
  async markPartAccepted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<ModulePart>): Promise<RepositoryResult<ModuleJobWriteResult>> {
    return this.writeParts('markPartAccepted', { jobId, userId, runnerId }, parts);
  }

  private async writeParts(
    method: string,
    key: { jobId: string; userId: string; runnerId: string },
    parts: ReadonlyArray<ModulePart>
  ): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const parsed = partsWriteSchema.safeParse(parts);
    if (!claimKeySchema.safeParse(key).success || !parsed.success) return this.invalid(method);
    return this.compareAndSet(method, key, WORKING, { parts: parsed.data, updated_at: this.now() });
  }

  /** The last part was accepted: the job is `sent`, the claim cleared. The row CHECK proves every part accepted. */
  async markSent(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<ModulePart>): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    const parsed = allAcceptedSchema.safeParse(parts);
    if (!claimKeySchema.safeParse(key).success || !parsed.success) return this.invalid('markSent');
    const at = this.now();
    return this.compareAndSet('markSent', key, WORKING, {
      parts: parsed.data,
      status: 'sent',
      sent_at: at,
      finished_at: at,
      claimed_by: null,
      claimed_at: null,
      updated_at: at,
    });
  }

  /**
   * No part reached `sending` and a retry may help: back to `waiting` with a
   * backoff, parts emptied, claim cleared. The row CHECK refuses it if a part
   * exists (XC-9: once a part is `sending`, never a retry).
   */
  async releaseForRetry(
    jobId: string,
    userId: string,
    runnerId: string,
    input: { errorCode: string; nextAttemptAt: string }
  ): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    const ok =
      claimKeySchema.safeParse(key).success &&
      code.safeParse(input?.errorCode).success &&
      z.string().datetime({ offset: true }).safeParse(input?.nextAttemptAt).success;
    if (!ok) return this.invalid('releaseForRetry');
    return this.compareAndSet('releaseForRetry', key, WORKING, {
      status: 'waiting',
      parts: [],
      parts_total: null,
      last_error_code: input.errorCode,
      next_attempt_at: input.nextAttemptAt,
      claimed_by: null,
      claimed_at: null,
      updated_at: this.now(),
    });
  }

  /**
   * The job failed for good: `failed` with its code, the notice due (or
   * `given_up` when no notice can reach the owner), finished, and the claim
   * CLEARED in the same patch so this run or the next can claim the notice at
   * once (MX-1a SA code review 3).
   */
  async markFailed(
    jobId: string,
    userId: string,
    runnerId: string,
    input: { failureCode: string; noticeState: 'due' | 'given_up' }
  ): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    const ok =
      claimKeySchema.safeParse(key).success &&
      failureCodeSchema.safeParse(input?.failureCode).success &&
      z.enum(['due', 'given_up']).safeParse(input?.noticeState).success;
    if (!ok) return this.invalid('markFailed');
    const at = this.now();
    return this.compareAndSet('markFailed', key, WORKING, {
      status: 'failed',
      failure_code: input.failureCode,
      notice_state: input.noticeState,
      finished_at: at,
      claimed_by: null,
      claimed_at: null,
      updated_at: at,
    });
  }

  /** A part reached `sending` and the job cannot finish: `interrupted`, the parts as they stand, notice due, claim cleared. */
  async markInterrupted(jobId: string, userId: string, runnerId: string, parts: ReadonlyArray<ModulePart>): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    const parsed = partsWriteSchema.safeParse(parts);
    if (!claimKeySchema.safeParse(key).success || !parsed.success) return this.invalid('markInterrupted');
    const at = this.now();
    return this.compareAndSet('markInterrupted', key, WORKING, {
      parts: parsed.data,
      status: 'interrupted',
      failure_code: 'interrupted',
      notice_state: 'due',
      finished_at: at,
      claimed_by: null,
      claimed_at: null,
      updated_at: at,
    });
  }

  /** The job's one notice was accepted (key `export-notice:{job}`): `sent`, with its time and Resend id, claim cleared. */
  async markNoticeSent(jobId: string, userId: string, runnerId: string, resendId: string | null): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    if (!claimKeySchema.safeParse(key).success || !resendIdSchema.safeParse(resendId).success) return this.invalid('markNoticeSent');
    const at = this.now();
    return this.compareAndSet('markNoticeSent', key, NOTICE_DUE, {
      notice_state: 'sent',
      notice_sent_at: at,
      notice_resend_id: resendId,
      claimed_by: null,
      claimed_at: null,
      updated_at: at,
    });
  }

  /** The notice failed in a way a retry may fix: the claim is cleared and the next run claims it again. */
  async releaseNotice(jobId: string, userId: string, runnerId: string): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    if (!claimKeySchema.safeParse(key).success) return this.invalid('releaseNotice');
    return this.compareAndSet('releaseNotice', key, NOTICE_DUE, { claimed_by: null, claimed_at: null, updated_at: this.now() });
  }

  /** The notice can never reach the owner (`.invalid` recipient, no login email): `given_up`, claim cleared. */
  async markNoticeGivenUp(jobId: string, userId: string, runnerId: string): Promise<RepositoryResult<ModuleJobWriteResult>> {
    const key = { jobId, userId, runnerId };
    if (!claimKeySchema.safeParse(key).success) return this.invalid('markNoticeGivenUp');
    return this.compareAndSet('markNoticeGivenUp', key, NOTICE_DUE, {
      notice_state: 'given_up',
      claimed_by: null,
      claimed_at: null,
      updated_at: this.now(),
    });
  }
}
