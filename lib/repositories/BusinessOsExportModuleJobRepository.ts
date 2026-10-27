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
// - `listHistoryForUser` filters on user_id and returns a DTO that never
//   carries a Resend id, a claim field or an error code.
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
// The worker's per-part writes (parts total, a part sending or accepted, sent,
// failed, notice sent) come with MX-3, their first caller (D-13). They will be
// compare-and-set on id + claimed_by + expected status and count rows with
// { count: 'exact' }: never update + .or() + .select() (the PostgREST 42703 bug).
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
  EXPORT_REQUEST_ORIGINS,
  MODULE_EXPORT_POLICY,
  MODULE_JOB_STATUSES,
  NOTICE_STATES,
  PART_STATES,
  type ExportRequestOrigin,
  type ModuleJobStatus,
  type NoticeState,
} from '@/lib/business-os/data-export/moduleExportPolicy';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The claim and reap functions of migration 20261095. */
export const MODULE_JOB_CLAIM_FUNCTION = 'business_os_export_module_jobs_claim_due';
export const MODULE_JOB_REAP_FUNCTION = 'business_os_export_module_jobs_reap';

/** The history read: the job columns the DTO needs, and its request through the named foreign key (M-3). */
export const MODULE_JOB_HISTORY_SELECT =
  'id, request_id, module, status, parts, sent_at, created_at, ' +
  'business_os_export_requests!business_os_export_module_jobs_request_id_fkey(requested_at, origin)';

/** The most history rows one read returns. */
export const HISTORY_LIMIT_MAX = 100;

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

const historyRowSchema = z.object({
  id: uuid,
  request_id: uuid,
  module: code,
  status: z.enum(MODULE_JOB_STATUSES),
  parts: z.array(modulePartSchema),
  sent_at: timestamp.nullable(),
  created_at: timestamp,
  business_os_export_requests: z.object({ requested_at: timestamp, origin: z.enum(EXPORT_REQUEST_ORIGINS) }),
});

/** One line of the export history (requirement §3.7). Never a Resend id, a claim field or an error code. */
export interface ModuleJobHistoryItem {
  requestId: string;
  module: string;
  status: ModuleJobStatus;
  requestedAt: string;
  sentAt: string | null;
  /** How many emails of this module were accepted by the mail provider. */
  emailCount: number;
  origin: ExportRequestOrigin;
}

/** What the reaper changed, for the worker log. */
export interface ReapedModuleJob {
  id: string;
  userId: string;
  status: ModuleJobStatus;
  failureCode: string | null;
  noticeState: NoticeState;
}

/** The typed error codes callers branch on. */
export const MODULE_JOB_ERROR = {
  INVALID_INPUT: 'invalid_input',
} as const;

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

  /** The account's export history, newest first. `limit` is clamped to 1..100. */
  async listHistoryForUser(userId: string, options: { limit?: number } = {}): Promise<RepositoryResult<ModuleJobHistoryItem[]>> {
    if (!uuid.safeParse(userId).success) {
      return { data: null, error: coded(MODULE_JOB_ERROR.INVALID_INPUT, 'Invalid input: user id') };
    }
    const requested = Number.isInteger(options.limit) ? (options.limit as number) : HISTORY_LIMIT_MAX;
    const limit = Math.min(Math.max(requested, 1), HISTORY_LIMIT_MAX);
    try {
      const { data, error } = await this.supabase
        .from('business_os_export_module_jobs')
        .select(MODULE_JOB_HISTORY_SELECT)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = z.array(historyRowSchema).parse(data ?? []);
      return {
        data: rows.map((row) => ({
          requestId: row.request_id,
          module: row.module,
          status: row.status,
          requestedAt: row.business_os_export_requests.requested_at,
          sentAt: row.sent_at,
          emailCount: row.parts.filter((part) => part.state === 'accepted').length,
          origin: row.business_os_export_requests.origin,
        })),
        error: null,
      };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'listHistoryForUser', userId }, 'Failed to read the export history');
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
      const rows = this.parseRows(data, 'reapStale').map((row) => ({
        id: row.id,
        userId: row.user_id,
        status: row.status,
        failureCode: row.failure_code,
        noticeState: row.notice_state,
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
}
