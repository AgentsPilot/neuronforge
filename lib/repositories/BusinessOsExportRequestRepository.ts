// lib/repositories/BusinessOsExportRequestRepository.ts
//
// Module export MX-1a (workplan BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md §4.2 with SA
// M-7; requirement BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md §4.4 BQ-29, XC-7,
// XC-20): the export requests of accounts, public.business_os_export_requests
// (migration 20261095).
//
// SERVICE ROLE BY DESIGN. The table has RLS on with no policy and no grant to
// anon or authenticated: no browser path reads it. So the default client is
// `supabaseServer`, and the tenant boundary is this file (CLAUDE.md rule 4,
// tenant-isolation-guard):
//
// - A request is only ever created by the database start function, which
//   holds the limits as literals and inserts the request and its module jobs
//   from ONE set of arguments (D-4). There is no insert method here.
// - `startForOwner` takes the SESSION user id and sends origin 'owner' with no
//   admin id. `startForAdmin` takes the owner id from the admin route path and
//   the `requireAdmin` id (MX-5). Neither ever takes an id from a request body;
//   the callers prove their sources in their own tests (SA MX1A tenant check).
// - Every argument is parsed with Zod before the call. A module id must be one
//   of the MX-0 ids (defence in depth; "switched on" is the route's check).
// - `findByIdForUser` filters on id AND user_id, so a foreign id matches nothing.
//
// WHO MAY IMPORT THIS FILE is pinned by
// lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts.
// It is not exported from the `lib/repositories` barrel on purpose (S-16).
//
// Logs carry ids, outcomes, counts and error codes only, never a module list
// or an email. Every method returns { data, error } and never throws.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { ExportModuleIdSchema } from '@/lib/business-os/data-export/exportModuleSchema';
import {
  CODE_SHAPE,
  EXPORT_REQUEST_ORIGINS,
  MODULE_EXPORT_POLICY,
  type ExportRequestOrigin,
  type StartOutcome,
} from '@/lib/business-os/data-export/moduleExportPolicy';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The start function of migration 20261095. */
export const EXPORT_REQUEST_START_FUNCTION = 'business_os_export_request_start';

/** Explicit columns, never `*`. Same order as the table. */
export const EXPORT_REQUEST_COLUMNS =
  'id, user_id, origin, admin_actor_id, modules, requested_at, requested_email_sent_at, created_at, updated_at';

const uuid = z.string().uuid();
const timestamp = z.string().min(1).max(64);

/** One stored request, as PostgREST returns it. */
export const exportRequestRowSchema = z.object({
  id: uuid,
  user_id: uuid,
  origin: z.enum(EXPORT_REQUEST_ORIGINS),
  admin_actor_id: uuid.nullable(),
  // Shape only (SA MX1A-10): a module renamed later must still read back.
  modules: z.array(z.string().regex(CODE_SHAPE)).min(1).max(MODULE_EXPORT_POLICY.MAX_MODULES_PER_REQUEST),
  requested_at: timestamp,
  requested_email_sent_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type ExportRequest = z.infer<typeof exportRequestRowSchema>;

/** The modules of a new request: MX-0 ids, at least one, no duplicate. */
const modulesSchema = z
  .array(ExportModuleIdSchema)
  .min(1)
  .max(MODULE_EXPORT_POLICY.MAX_MODULES_PER_REQUEST)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'A module is listed twice' });

/** The one row the start function returns. */
const startRowSchema = z.discriminatedUnion('result_outcome', [
  z.object({ result_outcome: z.literal('started'), result_request_id: uuid, result_retry_at: z.null() }),
  z.object({ result_outcome: z.literal('in_progress'), result_request_id: z.null(), result_retry_at: z.null() }),
  z.object({ result_outcome: z.literal('daily_limit'), result_request_id: z.null(), result_retry_at: timestamp }),
]);

/** What a start answers. `retryAt` is when the limit-th newest counted request leaves the rolling window. */
export type ExportRequestStartResult =
  | { outcome: Extract<StartOutcome, 'started'>; requestId: string }
  | { outcome: Extract<StartOutcome, 'in_progress'> }
  | { outcome: Extract<StartOutcome, 'daily_limit'>; retryAt: string };

/** The typed error codes callers branch on (SA M-7). None is retried here. */
export const EXPORT_REQUEST_ERROR = {
  /** Refused by this file before any database call. */
  INVALID_INPUT: 'invalid_input',
  /** The start function refused the arguments (22023). */
  INVALID_ARGUMENTS: 'invalid_arguments',
  /** No such login (23503 on the user_id foreign key). */
  UNKNOWN_ACCOUNT: 'unknown_account',
  /** The start function answered zero rows, several, or a row of another shape. */
  UNEXPECTED_RESULT: 'unexpected_result',
} as const;

/** A fresh Error carrying only code and message, so `details` never reaches a log. */
function toError(error: unknown): Error & { code?: string } {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const out = new Error(typeof record.message === 'string' ? record.message : 'Unknown database error') as Error & { code?: string };
  if (typeof record.code === 'string') out.code = record.code;
  return out;
}

function coded(code: string, message: string): Error & { code: string } {
  const out = new Error(message) as Error & { code: string };
  out.code = code;
  return out;
}

export class BusinessOsExportRequestRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role on purpose: the table is service-role only (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsExportRequestRepository' });
  }

  // ============ Start (the database holds the limits) ============

  /** An owner starts an export of their own account. `sessionUserId` must be the signed-in user (MX-1b). */
  async startForOwner(sessionUserId: string, modules: ReadonlyArray<string>): Promise<RepositoryResult<ExportRequestStartResult>> {
    return this.start('owner', sessionUserId, null, modules);
  }

  /**
   * An admin sends an owner their export (XC-20, MX-5). `ownerUserId` comes
   * from the admin route path, `adminUserId` from requireAdmin. Counted apart
   * from the owner's own requests.
   */
  async startForAdmin(
    ownerUserId: string,
    adminUserId: string,
    modules: ReadonlyArray<string>
  ): Promise<RepositoryResult<ExportRequestStartResult>> {
    return this.start('admin', ownerUserId, adminUserId, modules);
  }

  private async start(
    origin: ExportRequestOrigin,
    userId: string,
    adminUserId: string | null,
    modules: ReadonlyArray<string>
  ): Promise<RepositoryResult<ExportRequestStartResult>> {
    const parsedModules = modulesSchema.safeParse(modules);
    if (
      !uuid.safeParse(userId).success ||
      (origin === 'admin' && !uuid.safeParse(adminUserId).success) ||
      !parsedModules.success
    ) {
      return { data: null, error: coded(EXPORT_REQUEST_ERROR.INVALID_INPUT, 'Invalid input: export request') };
    }
    const method = origin === 'owner' ? 'startForOwner' : 'startForAdmin';
    const startTime = Date.now();
    try {
      const { data, error } = await this.supabase.rpc(EXPORT_REQUEST_START_FUNCTION, {
        p_user_id: userId,
        p_origin: origin,
        p_admin_actor_id: origin === 'admin' ? adminUserId : null,
        p_modules: parsedModules.data,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const row = rows.length === 1 ? startRowSchema.safeParse(rows[0]) : null;
      if (!row || !row.success) {
        this.logger.error(
          { method, userId, adminUserId, rowCount: rows.length, duration: Date.now() - startTime },
          'Export request start answered an unexpected result'
        );
        return { data: null, error: coded(EXPORT_REQUEST_ERROR.UNEXPECTED_RESULT, 'The export request start answered an unexpected result') };
      }
      const value = row.data;
      const result: ExportRequestStartResult =
        value.result_outcome === 'started'
          ? { outcome: 'started', requestId: value.result_request_id }
          : value.result_outcome === 'daily_limit'
            ? { outcome: 'daily_limit', retryAt: value.result_retry_at }
            : { outcome: 'in_progress' };
      this.logger.info(
        {
          method,
          userId,
          adminUserId,
          outcome: result.outcome,
          requestId: result.outcome === 'started' ? result.requestId : null,
          moduleCount: parsedModules.data.length,
          duration: Date.now() - startTime,
        },
        'Export request start'
      );
      return { data: result, error: null };
    } catch (err) {
      const safe = toError(err);
      if (safe.code === '22023') {
        this.logger.warn({ method, userId, adminUserId }, 'Export request start refused the arguments');
        return { data: null, error: coded(EXPORT_REQUEST_ERROR.INVALID_ARGUMENTS, 'The export request arguments were refused') };
      }
      if (safe.code === '23503') {
        this.logger.warn({ method, userId, adminUserId }, 'Export request start: no such account');
        return { data: null, error: coded(EXPORT_REQUEST_ERROR.UNKNOWN_ACCOUNT, 'No such account') };
      }
      this.logger.error({ err: safe, method, userId, adminUserId, duration: Date.now() - startTime }, 'Failed to start the export request');
      return { data: null, error: safe };
    }
  }

  // ============ Per-account reads ============

  /** One request of the account, or null. A foreign id matches nothing. */
  async findByIdForUser(requestId: string, userId: string): Promise<RepositoryResult<ExportRequest>> {
    if (!uuid.safeParse(requestId).success || !uuid.safeParse(userId).success) {
      return { data: null, error: coded(EXPORT_REQUEST_ERROR.INVALID_INPUT, 'Invalid input: id') };
    }
    try {
      const { data, error } = await this.supabase
        .from('business_os_export_requests')
        .select(EXPORT_REQUEST_COLUMNS)
        .eq('id', requestId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return { data: data ? exportRequestRowSchema.parse(data) : null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findByIdForUser', requestId, userId }, 'Failed to read the export request');
      return { data: null, error: safe };
    }
  }
}
