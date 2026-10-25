// lib/repositories/AccountClosureRepository.ts
//
// Account deletion lifecycle DL-1a (workplan BUSINESS_OS_DELETION_DL1A_WORKPLAN.md
// §5.2 with SA W-5; requirement BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md
// XC-1, XC-1a, XC-2, XC-4): the deletion requests of accounts,
// public.business_os_account_closures (migration 20261093).
//
// SERVICE ROLE BY DESIGN. The table has RLS on with no policy and no grant to
// anon or authenticated: no browser path reads it. So the default client is
// `supabaseServer`, and the user_id filter on every per-account method is the
// tenant boundary (CLAUDE.md rule 4, tenant-isolation-guard):
//
// - A closure id is not a capability. Every per-account method takes
//   (id, userId) and filters both, so a foreign id matches nothing.
// - `user_id` of a new row is the caller's SESSION user (DL-1b). Input is
//   parsed with Zod field by field: an `id`, `status`, `user_id` or timestamp
//   in the input is dropped, never written.
// - Status changes are compare-and-set on the old status, and a pair outside
//   ALLOWED_TRANSITIONS is refused before any database call. Each transition
//   writes only its own allow-listed columns.
// - `claimDue` and `updateClaimed` are ⟨unscoped-by-design⟩: the lifecycle job
//   (DL-3) claims rows of every account, the PluginConnectionRepository
//   precedent. Every later effect is scoped to the claimed row's user_id
//   (tenant-isolation-guard step 6), and `updateClaimed` is compare-and-set on
//   the runner id that holds the claim.
//
// The claim lease is a literal in the SQL claim function, not a parameter (SA
// W-2): a ruled deviation from durable-queue-drain steps 2 and 3, SA Workplan
// Review 2026-10-25 O-4 (INVOKER, lease in the predicate, no separate reaper).
//
// WHO MAY IMPORT THIS FILE is pinned by
// lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts.
// It is not exported from the `lib/repositories` barrel on purpose.
//
// Logs carry ids, statuses and error codes only, never a reason text or an
// email. Every method returns { data, error } and never throws. No update
// combines .or() with .select() (the PostgREST 42703 bug): updates count rows.

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { STATEMENT_LANGUAGES } from '@/lib/business-os/account-deletion/acknowledgement';
import {
  CLOSURE_CLAIM_BATCH_MAX,
  CLOSURE_STATUSES,
  KEPT_SOURCES,
  OPEN_CLOSURE_STATUSES,
  isAllowedTransition,
  type ClosureStatus,
} from '@/lib/business-os/account-deletion/closureLifecycle';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The claim function of migration 20261093. */
export const CLOSURE_CLAIM_FUNCTION = 'business_os_account_closures_claim_due';

/** Explicit columns, never `*`. Same order as the table. */
export const ACCOUNT_CLOSURE_COLUMNS =
  'id, user_id, status, requested_at, statement_language, reason_code, renewal_was_on, plan_ends_at, ' +
  'grace_starts_at, lock_at, lock_timezone, locked_at, blocked_at, blocked_codes, kept_at, kept_source, ' +
  'requested_email_sent_at, grace_email_sent_at, reminder_email_sent_at, blocked_email_sent_at, ' +
  'closed_email_sent_at, kept_email_sent_at, closed_email_attempts, closed_email_first_attempt_at, ' +
  'claimed_by, claimed_at, attempts, next_check_at, last_error_code, created_at, updated_at';

const uuid = z.string().uuid();
const timestamp = z.string().min(1).max(64);
const nullableTimestamp = timestamp.nullable();

/** One stored row, as PostgREST returns it. The claim result is parsed with this (W-5, §5.2). */
export const accountClosureRowSchema = z.object({
  id: uuid,
  user_id: uuid,
  status: z.enum(CLOSURE_STATUSES),
  requested_at: timestamp,
  statement_language: z.enum(STATEMENT_LANGUAGES),
  reason_code: z.string(),
  renewal_was_on: z.boolean(),
  plan_ends_at: nullableTimestamp,
  grace_starts_at: nullableTimestamp,
  lock_at: nullableTimestamp,
  lock_timezone: z.string().nullable(),
  locked_at: nullableTimestamp,
  blocked_at: nullableTimestamp,
  blocked_codes: z.array(z.string()),
  kept_at: nullableTimestamp,
  kept_source: z.enum(KEPT_SOURCES).nullable(),
  requested_email_sent_at: nullableTimestamp,
  grace_email_sent_at: nullableTimestamp,
  reminder_email_sent_at: nullableTimestamp,
  blocked_email_sent_at: nullableTimestamp,
  closed_email_sent_at: nullableTimestamp,
  kept_email_sent_at: nullableTimestamp,
  closed_email_attempts: z.number().int().nonnegative(),
  closed_email_first_attempt_at: nullableTimestamp,
  claimed_by: uuid.nullable(),
  claimed_at: nullableTimestamp,
  attempts: z.number().int().nonnegative(),
  next_check_at: nullableTimestamp,
  last_error_code: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

export type AccountClosure = z.infer<typeof accountClosureRowSchema>;

/** What a new request carries (DL-1b). Nothing else reaches the insert. */
const insertRequestingSchema = z.object({
  userId: uuid,
  statementLanguage: z.enum(STATEMENT_LANGUAGES),
  // The shape CHECK of the table (D-10); the value list is DL-1b's Zod list (BQ-7).
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  renewalWasOn: z.boolean(),
  planEndsAt: nullableTimestamp,
});
export type InsertRequestingInput = z.input<typeof insertRequestingSchema>;

/** Every column a status change or a claimed update may write, with its value shape. */
const patchValueSchemas = {
  grace_starts_at: timestamp,
  lock_at: timestamp,
  lock_timezone: z.string().min(1).max(64),
  locked_at: timestamp,
  blocked_at: nullableTimestamp,
  blocked_codes: z.array(z.string().regex(/^([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})$/)).max(20),
  kept_at: timestamp,
  kept_source: z.enum(KEPT_SOURCES),
  requested_email_sent_at: timestamp,
  grace_email_sent_at: timestamp,
  reminder_email_sent_at: timestamp,
  blocked_email_sent_at: timestamp,
  closed_email_sent_at: timestamp,
  kept_email_sent_at: timestamp,
  closed_email_attempts: z.number().int().nonnegative().safe(),
  closed_email_first_attempt_at: timestamp,
  next_check_at: nullableTimestamp,
  last_error_code: z.string().min(1).max(64).nullable(),
} as const;

export type ClosurePatchColumn = keyof typeof patchValueSchemas;
export type ClosurePatch = Partial<{ [K in ClosurePatchColumn]: z.infer<(typeof patchValueSchemas)[K]> }>;

/**
 * The columns each owner- or admin-driven transition may write (W-5). A key
 * outside the list refuses the call before any database call.
 */
const TRANSITION_COLUMNS: Readonly<Record<string, ReadonlyArray<ClosurePatchColumn>>> = {
  'requesting>pending': ['requested_email_sent_at', 'next_check_at'],
  'requesting>grace': ['grace_starts_at', 'lock_at', 'lock_timezone', 'requested_email_sent_at', 'next_check_at'],
  'pending>grace': ['grace_starts_at', 'lock_at', 'lock_timezone', 'next_check_at'],
  'pending>kept': ['kept_at', 'kept_source'],
  'grace>locked': ['locked_at'],
  'grace>kept': ['kept_at', 'kept_source'],
  'locked>kept': ['kept_at', 'kept_source'],
};

/** What the lifecycle job may write on a row it holds, besides a status change. */
const CLAIMED_COLUMNS: ReadonlyArray<ClosurePatchColumn> = [
  'blocked_at',
  'blocked_codes',
  'requested_email_sent_at',
  'grace_email_sent_at',
  'reminder_email_sent_at',
  'blocked_email_sent_at',
  'closed_email_sent_at',
  'kept_email_sent_at',
  'closed_email_attempts',
  'closed_email_first_attempt_at',
  'next_check_at',
  'last_error_code',
];

/** The typed error codes callers branch on. */
export const CLOSURE_ERROR = {
  INVALID: 'invalid_input',
  TRANSITION: 'transition_not_allowed',
  ALREADY_OPEN: 'already_open',
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

/**
 * Build the write payload field by field from an allow-list. Returns null when
 * the patch names a column outside it or carries a value of the wrong shape.
 */
function buildPatch(patch: ClosurePatch, allowed: ReadonlyArray<ClosurePatchColumn>): Record<string, unknown> | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (!(allowed as ReadonlyArray<string>).includes(key)) return null;
    const column = key as ClosurePatchColumn;
    const parsed = patchValueSchemas[column].safeParse((patch as Record<string, unknown>)[column]);
    if (!parsed.success) return null;
    out[column] = parsed.data;
  }
  return out;
}

export class AccountClosureRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role on purpose: the table is service-role only (header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AccountClosureRepository' });
  }

  // ============ Per-account reads ============

  /** The account's open request (requesting, pending, grace or locked), or null. At most one exists. */
  async findOpenForUser(userId: string): Promise<RepositoryResult<AccountClosure>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: user id') };
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_closures')
        .select(ACCOUNT_CLOSURE_COLUMNS)
        .eq('user_id', userId)
        .in('status', [...OPEN_CLOSURE_STATUSES])
        .maybeSingle();
      if (error) throw error;
      return { data: data ? accountClosureRowSchema.parse(data) : null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findOpenForUser', userId }, 'Failed to read the open account closure');
      return { data: null, error: safe };
    }
  }

  /** The account's newest request in any state, or null (the unlock check, SA W-4). */
  async findLatestForUser(userId: string): Promise<RepositoryResult<AccountClosure>> {
    if (!uuid.safeParse(userId).success) return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: user id') };
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_closures')
        .select(ACCOUNT_CLOSURE_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const rows = (data as unknown[] | null) ?? [];
      return { data: rows[0] ? accountClosureRowSchema.parse(rows[0]) : null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findLatestForUser', userId }, 'Failed to read the latest account closure');
      return { data: null, error: safe };
    }
  }

  async findById(id: string, userId: string): Promise<RepositoryResult<AccountClosure>> {
    if (!uuid.safeParse(id).success || !uuid.safeParse(userId).success) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: id') };
    }
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_closures')
        .select(ACCOUNT_CLOSURE_COLUMNS)
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return { data: data ? accountClosureRowSchema.parse(data) : null, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'findById', closureId: id, userId }, 'Failed to read the account closure');
      return { data: null, error: safe };
    }
  }

  // ============ Owner and admin writes ============

  /**
   * Stage A: a new `requesting` row (XC-2). `userId` must be the session user.
   * A second open request is refused by the partial unique index and comes
   * back as `already_open`.
   */
  async insertRequesting(input: InsertRequestingInput): Promise<RepositoryResult<AccountClosure>> {
    const parsed = insertRequestingSchema.safeParse(input);
    if (!parsed.success) return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: closure request') };
    const value = parsed.data;
    try {
      const { data, error } = await this.supabase
        .from('business_os_account_closures')
        .insert({
          user_id: value.userId,
          statement_language: value.statementLanguage,
          reason_code: value.reasonCode,
          renewal_was_on: value.renewalWasOn,
          plan_ends_at: value.planEndsAt,
        })
        .select(ACCOUNT_CLOSURE_COLUMNS)
        .single();
      if (error) throw error;
      const row = accountClosureRowSchema.parse(data);
      this.logger.info({ method: 'insertRequesting', closureId: row.id, userId: value.userId }, 'Account closure requested');
      return { data: row, error: null };
    } catch (err) {
      const safe = toError(err);
      if (safe.code === '23505') {
        this.logger.warn({ method: 'insertRequesting', userId: value.userId }, 'Account closure already open');
        return { data: null, error: coded(CLOSURE_ERROR.ALREADY_OPEN, 'An account closure is already open') };
      }
      this.logger.error({ err: safe, method: 'insertRequesting', userId: value.userId }, 'Failed to insert the account closure');
      return { data: null, error: safe };
    }
  }

  /**
   * Move a row from `from` to `to`, compare-and-set on the old status (W-5).
   * `data` is true when the row moved, false when it was no longer in `from`
   * (someone else moved it first).
   */
  async transition(
    id: string,
    userId: string,
    from: ClosureStatus,
    to: ClosureStatus,
    patch: ClosurePatch = {}
  ): Promise<RepositoryResult<boolean>> {
    if (!uuid.safeParse(id).success || !uuid.safeParse(userId).success) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: id') };
    }
    if (!isAllowedTransition(from, to)) {
      return { data: null, error: coded(CLOSURE_ERROR.TRANSITION, 'Closure transition not allowed') };
    }
    const payload = buildPatch(patch, TRANSITION_COLUMNS[`${from}>${to}`] ?? []);
    if (payload === null) return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: closure patch') };
    try {
      const { error, count } = await this.supabase
        .from('business_os_account_closures')
        .update({ ...payload, status: to, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', from);
      if (error) throw error;
      const moved = (count ?? 0) === 1;
      this.logger.info({ method: 'transition', closureId: id, userId, from, to, moved }, 'Account closure transition');
      return { data: moved, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'transition', closureId: id, userId, from, to }, 'Failed to move the account closure');
      return { data: null, error: safe };
    }
  }

  /**
   * Remove a `requesting` row (XC-2: Stripe refused to stop the renewal).
   * Only a row still in `requesting` can go. `data` is true when one went.
   */
  async deleteRequesting(id: string, userId: string): Promise<RepositoryResult<boolean>> {
    if (!uuid.safeParse(id).success || !uuid.safeParse(userId).success) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: id') };
    }
    try {
      const { error, count } = await this.supabase
        .from('business_os_account_closures')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('status', 'requesting');
      if (error) throw error;
      const removed = (count ?? 0) === 1;
      this.logger.info({ method: 'deleteRequesting', closureId: id, userId, removed }, 'Account closure request withdrawn');
      return { data: removed, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'deleteRequesting', closureId: id, userId }, 'Failed to remove the account closure request');
      return { data: null, error: safe };
    }
  }

  // ============ The lifecycle job (⟨unscoped-by-design⟩) ============

  /**
   * ⟨unscoped-by-design⟩ Claim up to `batch` due rows of ANY account for
   * `runnerId` (DL-3). The lease (90 s) and the 15 minute settle time of a
   * `requesting` row are SQL literals in the function. Every row is parsed.
   */
  async claimDue(runnerId: string, batch: number): Promise<RepositoryResult<AccountClosure[]>> {
    if (!uuid.safeParse(runnerId).success || !z.number().int().min(1).max(CLOSURE_CLAIM_BATCH_MAX).safeParse(batch).success) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: claim') };
    }
    const startTime = Date.now();
    try {
      const { data, error } = await this.supabase.rpc(CLOSURE_CLAIM_FUNCTION, { p_runner: runnerId, p_batch: batch });
      if (error) throw error;
      const rows = z.array(accountClosureRowSchema).parse(data ?? []);
      this.logger.info(
        { method: 'claimDue', runnerId, claimed: rows.length, closureIds: rows.map((row) => row.id), duration: Date.now() - startTime },
        'Account closures claimed'
      );
      return { data: rows, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'claimDue', runnerId, duration: Date.now() - startTime }, 'Failed to claim account closures');
      return { data: null, error: safe };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ Write the job's result on a row it holds and release
   * the claim. Compare-and-set on `claimed_by = runnerId` and on `from`, the
   * status the claimed row had (W-5). With `to`, the status changes too, and
   * the pair is checked against ALLOWED_TRANSITIONS before any database call.
   * `data` is false when the claim was lost (the lease ran out and another run
   * took the row) or the status had moved.
   */
  async updateClaimed(
    id: string,
    runnerId: string,
    change: { from: ClosureStatus; to?: ClosureStatus; patch?: ClosurePatch }
  ): Promise<RepositoryResult<boolean>> {
    if (!uuid.safeParse(id).success || !uuid.safeParse(runnerId).success) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: id') };
    }
    const from = change?.from;
    if (!(CLOSURE_STATUSES as ReadonlyArray<string>).includes(from)) {
      return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: from status') };
    }
    const to = change.to;
    if (to !== undefined && !isAllowedTransition(from, to)) {
      return { data: null, error: coded(CLOSURE_ERROR.TRANSITION, 'Closure transition not allowed') };
    }
    const allowed = to === undefined ? CLAIMED_COLUMNS : [...CLAIMED_COLUMNS, ...(TRANSITION_COLUMNS[`${from}>${to}`] ?? [])];
    const payload = buildPatch(change.patch ?? {}, allowed);
    if (payload === null) return { data: null, error: coded(CLOSURE_ERROR.INVALID, 'Invalid input: closure patch') };
    try {
      const { error, count } = await this.supabase
        .from('business_os_account_closures')
        .update(
          {
            ...payload,
            ...(to === undefined ? {} : { status: to }),
            claimed_by: null,
            claimed_at: null,
            updated_at: new Date().toISOString(),
          },
          { count: 'exact' }
        )
        .eq('id', id)
        .eq('claimed_by', runnerId)
        .eq('status', from);
      if (error) throw error;
      const written = (count ?? 0) === 1;
      this.logger.info({ method: 'updateClaimed', closureId: id, runnerId, from, to: to ?? null, written }, 'Claimed account closure updated');
      return { data: written, error: null };
    } catch (err) {
      const safe = toError(err);
      this.logger.error({ err: safe, method: 'updateClaimed', closureId: id, runnerId, from }, 'Failed to update the claimed account closure');
      return { data: null, error: safe };
    }
  }
}
