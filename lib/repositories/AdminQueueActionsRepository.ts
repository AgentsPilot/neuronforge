// lib/repositories/AdminQueueActionsRepository.ts
// The one WRITE an admin can make to a live Business OS queue row: cancel one
// item (ADMIN_BOS_CLEANUP slice 7b; SA C7-2, C7-3, C7-6, C7-9, C7-12; workplan
// §2.3, conditions W7B-1..W7B-14). Slice 7c adds `retryQueueItemAllAccounts`
// beside it, under its own review.
//
// ADMIN-ONLY, CROSS-ACCOUNT BY DESIGN:
//   - SERVICE-ROLE CLIENT, ON PURPOSE. "Close this one queue item, whichever
//     account it belongs to" is an admin, cross-account action, so CLAUDE.md
//     rule 4 is replaced by the caller's `requireAdmin` gate. The ONLY
//     permitted caller is app/api/admin/jobs-queues/items/action/route.ts (a
//     source guard in lib/repositories/__tests__/AdminQueueActionsRepository.test.ts
//     enforces it; the barrel and tests are exempt).
//   - TENANT BOUNDARY (tenant-isolation-guard Steps 2-4). The route reads the
//     row on the server first; `ownerUserId` is ALWAYS that row's own
//     `user_id`, never a request value, and the write names both keys (`id`
//     AND `user_id`). The patch is a frozen per-queue constant, copied, never
//     built from input. No upsert, and no trigger exists on the five tables
//     (workplan §6.2, run live by the user), so none of the scope-defeating
//     three applies.
//   - ONE COMPARE-AND-SET UPDATE (§D.1, C7-3): it matches `id`, `user_id`,
//     the expected `status` and `attempts`, plus `claimed_at IS NULL` when the
//     expected status is the in-progress one (C7-2: an orphaned row only, in
//     the write itself, not only in the route's pre-check). Sent as
//     `.update(patch, { count: 'exact' })` with NO `.select()` and NO `.or()`
//     (the 2026-09-29 UPDATE + .or() + .select() 42703 defect cannot arise).
//     The action wins only when Postgres reports exactly one row.
//   - SINGLE SOURCE (C7-9): the "from" set and the in-progress status are
//     imported from lib/admin/jobs/queueItemEligibility.ts, never copied. The
//     table map is local (importing ADMIN_QUEUE_SPECS would name the read
//     repository and trip its isolation guard); a test pins it equal (OP-8).
//   - NO DOMAIN EVENT (OP-14, W7B-6): an admin cancel emits no payment event,
//     so no owner automation can start from it. The audit row is the record.
//   - "AllAccounts" in the method name; the context is FIRST and REQUIRED;
//     logs carry ids and the outcome only, never the owner id. Methods never
//     throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { CANCEL_FROM_STATUSES, IN_PROGRESS_STATUS } from '@/lib/admin/jobs/queueItemEligibility';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** Who is acting, and the request it belongs to. Same shape as AdminReadContext; named for what it guards. */
export interface AdminActionContext {
  correlationId: string;
  adminId: string;
}

/**
 * The exact patch per queue (C7-6). Frozen at both levels and never built from
 * input. The payment tables have no `skip_reason`; the other three record why.
 * Nothing else is touched: the error text stays for diagnosis, and the claim,
 * attempts, retry time and owner are never written.
 */
export const ADMIN_QUEUE_CANCEL_PATCH: Readonly<Record<BosQueueId, Readonly<Record<string, string>>>> = Object.freeze({
  payment_reminders: Object.freeze({ status: 'cancelled' }),
  payment_automations: Object.freeze({ status: 'cancelled' }),
  daily_briefing_sends: Object.freeze({ status: 'skipped', skip_reason: 'cancelled_by_admin' }),
  lead_responses: Object.freeze({ status: 'skipped', skip_reason: 'cancelled_by_admin' }),
  insight_actions: Object.freeze({ status: 'skipped', skip_reason: 'cancelled_by_admin' }),
});

/** Queue → table. Pinned equal to ADMIN_QUEUE_SPECS[q].table by test (OP-8). */
export const ADMIN_QUEUE_ACTION_TABLES: Readonly<Record<BosQueueId, string>> = Object.freeze({
  payment_reminders: 'payment_reminders',
  payment_automations: 'payment_automation_executions',
  daily_briefing_sends: 'daily_briefing_sends',
  lead_responses: 'lead_responses',
  insight_actions: 'insight_actions',
});

export interface CancelQueueItemInput {
  queue: BosQueueId;
  /** The queue row's own id. */
  itemId: string;
  /** The row's own user_id, as the route read it. NEVER from a request. */
  ownerUserId: string;
  /** The row's status and attempts, as the route read them (equal to what the admin saw). */
  expected: { status: string; attempts: number };
}

export type CancelQueueItemOutcome = 'cancelled' | 'not_matched';

// Supabase's builder types differ per chain; this is the subset used here.
interface UpdateQuery extends PromiseLike<{ error: unknown; count?: number | null }> {
  eq(column: string, value: unknown): UpdateQuery;
  is(column: string, value: null): UpdateQuery;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const e = (error ?? {}) as { message?: string; code?: string };
  const wrapped = new Error(e.message ?? 'Supabase error') as Error & { code?: string };
  if (e.code) wrapped.code = e.code;
  return wrapped;
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

const isOwnQueue = (queue: unknown): queue is BosQueueId =>
  typeof queue === 'string' && Object.prototype.hasOwnProperty.call(ADMIN_QUEUE_ACTION_TABLES, queue);

export class AdminQueueActionsRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Intentionally bypasses RLS: admin-only, cross-account (see header).
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AdminQueueActionsRepository' });
  }

  /**
   * Close one queue item for good, whichever account it belongs to, if and
   * only if it is still exactly what the caller read. `cancelled` = Postgres
   * reported one row changed; `not_matched` = zero rows (a claim, the owner or
   * another admin moved it first, or it is gone). Any other count, or an
   * error, is returned as an error: the caller cannot say what happened.
   */
  async cancelQueueItemAllAccounts(
    context: AdminActionContext,
    input: CancelQueueItemInput
  ): Promise<RepositoryResult<{ outcome: CancelQueueItemOutcome }>> {
    if (!context || !context.correlationId || !context.adminId) {
      return { data: null, error: new Error('An admin action context is required') };
    }
    if (!input || !isOwnQueue(input.queue)) return { data: null, error: new Error('Unknown queue') };
    const { queue, itemId, ownerUserId, expected } = input;
    if (typeof itemId !== 'string' || itemId.length === 0 || typeof ownerUserId !== 'string' || ownerUserId.length === 0) {
      return { data: null, error: new Error('An item id and its owner are required') };
    }
    // A second line of defence after the route's own "from" check.
    if (!expected || typeof expected.status !== 'string' || !CANCEL_FROM_STATUSES[queue].includes(expected.status)) {
      return { data: null, error: new Error('Not a cancellable status') };
    }
    if (!Number.isInteger(expected.attempts) || expected.attempts < 0) {
      return { data: null, error: new Error('Attempts must be a non-negative integer') };
    }

    const logContext = {
      correlationId: context.correlationId,
      adminUserId: context.adminId,
      queue,
      itemId,
      from: expected.status,
    };

    try {
      let query = this.supabase
        .from(ADMIN_QUEUE_ACTION_TABLES[queue])
        // A copy of a frozen constant: nothing from input reaches the patch.
        .update({ ...ADMIN_QUEUE_CANCEL_PATCH[queue] }, { count: 'exact' })
        .eq('id', itemId)
        .eq('user_id', ownerUserId)
        .eq('status', expected.status)
        .eq('attempts', expected.attempts) as unknown as UpdateQuery;
      if (expected.status === IN_PROGRESS_STATUS[queue]) {
        // C7-2: an in-progress row is closed only while no run has claimed it.
        query = query.is('claimed_at', null);
      }

      const { error, count } = await query;
      if (error) {
        this.logger.error({ ...logContext, code: (error as { code?: string }).code }, 'Queue item cancel failed');
        return { data: null, error: asError(error) };
      }
      if (count === 1) {
        this.logger.info({ ...logContext, outcome: 'cancelled' }, 'Queue item cancel applied');
        return { data: { outcome: 'cancelled' }, error: null };
      }
      if (count === 0) {
        this.logger.info({ ...logContext, outcome: 'not_matched' }, 'Queue item cancel matched no row');
        return { data: { outcome: 'not_matched' }, error: null };
      }
      // `null` (the count was not returned) or anything else: unknowable.
      this.logger.error({ ...logContext, code: 'count_unconfirmed' }, 'Queue item cancel failed');
      return { data: null, error: codedError('The update count could not be confirmed', 'count_unconfirmed') };
    } catch (error) {
      this.logger.error({ ...logContext, code: (error as { code?: string }).code ?? 'thrown' }, 'Queue item cancel failed');
      return { data: null, error: asError(error) };
    }
  }
}

export const adminQueueActionsRepository = new AdminQueueActionsRepository();
