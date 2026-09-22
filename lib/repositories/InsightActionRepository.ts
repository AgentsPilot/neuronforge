/**
 * The queue of actions the platform takes on a business's behalf.
 *
 * Every action an insight can trigger passes through here: enqueued when an
 * automation decides something should happen, claimed by the drain runner,
 * and closed exactly once. Nothing outside this file touches `insight_actions`.
 *
 * Shaped after LeadResponseRepository deliberately. It is the same claim, the
 * same lease and the same reaper, and four near-identical queues are only
 * tolerable if reading one teaches you the rest.
 *
 * @see supabase/migrations/20260917_insight_actions.sql
 * @see docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger({ service: 'InsightActionRepository' });

/** The effects the drain runner knows how to perform. */
export type InsightActionKind = 'chase_invoice' | 'followup_nudge' | 'booking_reminder';

export type InsightActionStatus = 'pending' | 'processing' | 'sent' | 'skipped' | 'failed';

export interface InsightAction {
  id: string;
  user_id: string;
  insight_id: string | null;
  automation_id: string | null;
  detector_id: string | null;
  process_id: string;
  kind: InsightActionKind;
  contact_id: string | null;
  invoice_id: string | null;
  booking_id: string | null;
  status: InsightActionStatus;
  payload: Record<string, unknown>;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  skip_reason: string | null;
  error_message: string | null;
  sent_at: string | null;
  dedupe_key: string;
  created_at: string;
}

export interface InsightActionInsert {
  user_id: string;
  process_id: string;
  kind: InsightActionKind;
  dedupe_key: string;
  insight_id?: string | null;
  automation_id?: string | null;
  detector_id?: string | null;
  contact_id?: string | null;
  invoice_id?: string | null;
  booking_id?: string | null;
  payload?: Record<string, unknown>;
  /** Not before this instant. The claim already filters on it. */
  next_attempt_at?: string | null;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class InsightActionRepository {
  constructor(private supabase: SupabaseClient = supabaseServer) {}

  /**
   * Queue an action, unless the same one is already queued.
   *
   * A duplicate is a SUCCESS, not an error. Two enqueuers racing on the same
   * overdue invoice is the expected case rather than a fault — the detector
   * runs on a cron and the owner can also press the button — and the unique
   * index on `dedupe_key` is what makes the second one harmless. Returning null
   * without an error says "already handled", which is exactly what happened.
   */
  async enqueue(action: InsightActionInsert): Promise<RepositoryResult<InsightAction | null>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_actions')
        .insert({ ...action, payload: action.payload ?? {} })
        .select()
        .single();

      if (error) {
        // 23505: the dedupe key is already present.
        if (error.code === '23505') {
          logger.debug({ dedupeKey: action.dedupe_key }, 'Action already queued; nothing to do');
          return { data: null, error: null };
        }
        throw error;
      }

      logger.info(
        { userId: action.user_id, kind: action.kind, actionId: data.id },
        'Queued insight action'
      );
      return { data: data as InsightAction, error: null };
    } catch (error) {
      logger.error({ err: error, userId: action.user_id, kind: action.kind }, 'Could not queue action');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Claim a batch of due rows.
   *
   * ⟨unscoped-by-design⟩ — this crosses every tenant, because a queue runner
   * has to. Every read the dispatcher then makes is scoped to `row.user_id`.
   * Same precedent as LeadResponseRepository and PluginConnectionRepository.
   */
  async claimDue(runnerId: string, batch: number): Promise<InsightAction[]> {
    const { data, error } = await this.supabase.rpc('claim_due_insight_actions', {
      p_runner: runnerId,
      p_batch: batch,
    });

    if (error) {
      logger.error({ err: error }, 'Could not claim insight actions');
      return [];
    }

    return (data ?? []) as InsightAction[];
  }

  /**
   * Return rows whose runner died mid-send, and dead-letter the exhausted ones.
   *
   * ⟨unscoped-by-design⟩ — crosses every tenant, as above.
   */
  async reapStale(leaseSeconds: number, maxAttempts: number): Promise<InsightAction[]> {
    const { data, error } = await this.supabase.rpc('reap_stale_insight_actions', {
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts,
    });

    if (error) {
      logger.error({ err: error }, 'Could not reap stale insight actions');
      return [];
    }

    const reaped = (data ?? []) as InsightAction[];
    if (reaped.length > 0) {
      logger.warn({ count: reaped.length }, 'Recovered insight actions from a dead runner');
    }
    return reaped;
  }

  /**
   * Close a claimed row as sent.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id, which the runner only has
   * because it claimed it.
   */
  async markSent(id: string): Promise<void> {
    await this.close(id, { status: 'sent', sent_at: new Date().toISOString() });
  }

  /**
   * Close a claimed row without sending, and say why.
   *
   * Skipping is a normal outcome, not a failure: the invoice was paid between
   * queueing and sending, the client unsubscribed, the guardrail refused. It is
   * terminal so the row is never claimed again.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id.
   */
  async markSkipped(id: string, reason: string): Promise<void> {
    await this.close(id, { status: 'skipped', skip_reason: reason });
  }

  /**
   * Fail a claimed row.
   *
   * Left `pending` rather than terminal when attempts remain, so the reaper's
   * backoff picks it up: a transient provider error should be retried, and only
   * the dead-letter path in the reaper decides when to stop.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id.
   */
  async markFailed(id: string, message: string, retryable: boolean): Promise<void> {
    await this.close(id, {
      status: retryable ? 'pending' : 'failed',
      error_message: message.slice(0, 500),
      claimed_by: null,
      claimed_at: null,
      // Let the reaper's exponential backoff own the timing; a retryable row
      // simply becomes eligible again on the next drain.
      next_attempt_at: retryable ? new Date(Date.now() + 5 * 60_000).toISOString() : null,
    });
  }

  /**
   * How many of a kind this business has had SENT in a window.
   *
   * Excludes the row being considered, which is the whole subtlety: the caller
   * asks at claim time, when its own row is already `processing`, and a count
   * that included it would let an action block itself.
   */
  async countSentSince(
    userId: string,
    kind: InsightActionKind,
    since: string,
    excludeId: string
  ): Promise<number> {
    const { count, error } = await this.supabase
      .from('insight_actions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('kind', kind)
      .eq('status', 'sent')
      .neq('id', excludeId)
      .gte('created_at', since);

    if (error) {
      /*
       * A guardrail that cannot read its own history must not wave the send
       * through. Reporting a very high count makes the cap refuse, which fails
       * towards not writing to somebody's client.
       */
      logger.error({ err: error, userId, kind }, 'Could not count sent actions; treating the cap as reached');
      return Number.MAX_SAFE_INTEGER;
    }

    return count ?? 0;
  }

  /** What is queued for this business, for the dashboard. */
  async listForUser(userId: string, limit = 50): Promise<InsightAction[]> {
    const { data, error } = await this.supabase
      .from('insight_actions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ err: error, userId }, 'Could not list insight actions');
      return [];
    }
    return (data ?? []) as InsightAction[];
  }

  /** Cancel something queued but not yet claimed. Scoped to the owner. */
  async cancel(id: string, userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('insight_actions')
      .update({ status: 'skipped', skip_reason: 'cancelled by owner' })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) {
      logger.error({ err: error, id, userId }, 'Could not cancel insight action');
      return false;
    }
    return true;
  }

  private async close(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase
      .from('insight_actions')
      .update(updates)
      .eq('id', id);

    if (error) {
      /*
       * Loud, because this is the one failure the pattern cannot absorb. A row
       * that was acted on and never closed stays claimable, and the reaper will
       * hand it to another runner once the lease expires — which means sending
       * the same email to the same client again.
       */
      logger.error({ err: error, id, updates }, 'Could not close insight action; it may be re-sent');
    }
  }
}

export const insightActionRepository = new InsightActionRepository();
