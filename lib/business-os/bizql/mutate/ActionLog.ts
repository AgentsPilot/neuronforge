/**
 * Durable record of every write the chat performed.
 *
 * The important method here is `claim()`. Before anything irreversible happens,
 * the caller must win an INSERT on a UNIQUE idempotency key. If it loses that
 * race — because a retry, a double-clicked confirmation, or a second serverless
 * invocation got there first — it is told to skip rather than send.
 *
 * The guarantee lives in the database, not in this file. Application-level
 * "have we done this?" checks lose to concurrency; a unique index does not.
 *
 * @module lib/business-os/bizql/mutate
 */

import { createHash } from 'crypto';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { SystemConfigService } from '@/lib/services/SystemConfigService';

const logger = createLogger({ module: 'BizQLActionLog' });

const TABLE = 'business_chat_action_log';

/** Latch, so a missing table warns once rather than on every item. */
let logUnavailable = false;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '');
}

export interface ClaimArgs {
  userId: string;
  planId: string;
  stepId: string;
  itemId?: string;
  entity: string;
  action: string;
  target?: string;
}

export type ClaimResult =
  | { proceed: true; entryId: string | null }
  /** Already done — or being done right now by someone else. */
  | { proceed: false; reason: 'already_done' };

export function idempotencyKey(planId: string, stepId: string, itemId?: string): string {
  return createHash('sha256')
    .update(`${planId}|${stepId}|${itemId ?? '-'}`)
    .digest('hex');
}

export class ActionLog {
  /**
   * Reserve the right to perform one action.
   *
   * Returns `proceed: false` when this exact action has already been claimed.
   *
   * If the log itself is unavailable (migration not applied), this returns
   * `proceed: true` with a null id — the alternative would be blocking all
   * writes on a missing audit table. That trade-off is deliberate but it does
   * mean the double-send guarantee is only as good as the migration, which is
   * why `isAvailable()` exists for callers that want to refuse instead.
   */
  async claim(args: ClaimArgs): Promise<ClaimResult> {
    if (logUnavailable) return { proceed: true, entryId: null };

    const key = idempotencyKey(args.planId, args.stepId, args.itemId);

    const { data, error } = await supabaseServer
      .from(TABLE)
      .insert({
        user_id: args.userId,
        plan_id: args.planId,
        step_id: args.stepId,
        item_id: args.itemId ?? null,
        idempotency_key: key,
        entity: args.entity,
        action: args.action,
        target: args.target ?? null,
        status: 'pending',
      })
      .select('id')
      .single();

    if (isMissingTable(error)) {
      logUnavailable = true;
      logger.warn(
        { table: TABLE },
        'Action log table not found — writes will proceed WITHOUT double-send protection. ' +
          'Apply supabase/migrations/20260826_business_chat_action_log.sql.'
      );
      return { proceed: true, entryId: null };
    }

    if (error) {
      // 23505 = unique violation: someone already claimed this exact action.
      if (error.code === '23505') {
        logger.info(
          { planId: args.planId, stepId: args.stepId, itemId: args.itemId },
          'Action already claimed; skipping to avoid a duplicate'
        );
        return { proceed: false, reason: 'already_done' };
      }

      logger.error({ err: error }, 'Could not claim action; proceeding without a log entry');
      return { proceed: true, entryId: null };
    }

    return { proceed: true, entryId: (data as { id: string }).id };
  }

  /** Record how a claimed action turned out. */
  async complete(
    entryId: string | null,
    outcome: { status: 'succeeded' | 'failed'; provider?: string; error?: string }
  ): Promise<void> {
    if (!entryId || logUnavailable) return;

    const { error } = await supabaseServer
      .from(TABLE)
      .update({
        status: outcome.status,
        provider: outcome.provider ?? null,
        error: outcome.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', entryId);

    if (error) logger.warn({ err: error }, 'Could not record action outcome');
  }

  /**
   * How many of an action a user has performed today.
   *
   * Backs the daily send quota. A compromised or confused planner should not be
   * able to email an entire contact list repeatedly, and the cap has to be
   * counted from durable storage or a restart resets it.
   */
  async countToday(userId: string, action: string): Promise<number> {
    if (logUnavailable) return 0;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const { count, error } = await supabaseServer
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', action)
      .eq('status', 'succeeded')
      .gte('created_at', since.toISOString());

    if (isMissingTable(error)) {
      logUnavailable = true;
      return 0;
    }
    if (error) {
      logger.warn({ err: error }, 'Could not count today\'s actions; assuming zero');
      return 0;
    }

    return count ?? 0;
  }

  /** Daily ceiling for an action, per user. */
  async dailyLimit(action: string): Promise<number> {
    return SystemConfigService.getNumber(
      supabaseServer,
      `bizchat_daily_limit_${action.replace('.', '_')}`,
      200
    );
  }

  /** False when the migration has not been applied. */
  isAvailable(): boolean {
    return !logUnavailable;
  }
}

let singleton: ActionLog | null = null;

export function getActionLog(): ActionLog {
  if (!singleton) singleton = new ActionLog();
  return singleton;
}

/** Test seam. */
export function resetActionLog(): void {
  singleton = null;
  logUnavailable = false;
}
