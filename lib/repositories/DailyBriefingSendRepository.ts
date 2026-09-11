/**
 * The morning-briefing send ledger.
 *
 * One row per business per local date, claimed before dispatch so that two
 * overlapping cron runs cannot both send. Mirrors PaymentReminderRepository —
 * the pattern is documented in BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md §8.1
 * and this is a second application of it, not a new design.
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'DailyBriefingSendRepository' });

export interface DailyBriefingSendRow {
  id: string;
  user_id: string;
  briefing_date: string;
  timezone: string;
  status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed';
  attempts: number;
  error_message: string | null;
  skip_reason: string | null;
  sent_at: string | null;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class DailyBriefingSendRepository {
  constructor(private supabase = supabaseServer) {}

  /**
   * Put this business on today's queue, once.
   *
   * The UNIQUE(user_id, briefing_date) constraint is what makes the hourly cron
   * safe: the run that first sees a business inside its morning window creates
   * the row, and the other twenty-three do nothing. `ignoreDuplicates` turns
   * that collision into a no-op rather than an error the caller has to read.
   */
  async enqueue(
    userId: string,
    briefingDate: string,
    timezone: string
  ): Promise<RepositoryResult<boolean>> {
    try {
      const { error } = await this.supabase
        .from('daily_briefing_sends')
        .upsert(
          { user_id: userId, briefing_date: briefingDate, timezone, status: 'pending' },
          { onConflict: 'user_id,briefing_date', ignoreDuplicates: true }
        );

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, userId, briefingDate }, 'Failed to enqueue briefing send');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Take a batch of due rows.
   *
   * ⟨unscoped-by-design⟩ — a cross-user drain through a SECURITY DEFINER RPC
   * that does the FOR UPDATE SKIP LOCKED claim atomically.
   */
  async claimDue(runnerId: string, batch: number): Promise<RepositoryResult<DailyBriefingSendRow[]>> {
    try {
      const { data, error } = await this.supabase.rpc('claim_due_daily_briefings', {
        p_runner: runnerId,
        p_batch: batch,
      });

      if (error) throw error;
      return { data: (data as DailyBriefingSendRow[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error, runnerId }, 'Failed to claim due briefing sends');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Recover rows whose runner died mid-send.
   *
   * ⟨unscoped-by-design⟩ — cross-user safety-net sweep via SECURITY DEFINER RPC.
   */
  async reapStale(
    leaseSeconds: number,
    maxAttempts: number
  ): Promise<RepositoryResult<DailyBriefingSendRow[]>> {
    try {
      const { data, error } = await this.supabase.rpc('reap_stale_daily_briefings', {
        p_lease_seconds: leaseSeconds,
        p_max_attempts: maxAttempts,
      });

      if (error) throw error;
      return { data: (data as DailyBriefingSendRow[]) || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to reap stale briefing sends');
      return { data: null, error: error as Error };
    }
  }

  /** Terminal: delivered. */
  async markSent(id: string): Promise<RepositoryResult<true>> {
    return this.markTerminal(id, { status: 'sent', sent_at: new Date().toISOString() });
  }

  /**
   * Terminal: deliberately not sent.
   *
   * A quiet day is a success, not a failure — the reaper must leave these
   * alone, and nobody should be paged because a business had no appointments.
   */
  async markSkipped(id: string, reason: string): Promise<RepositoryResult<true>> {
    return this.markTerminal(id, { status: 'skipped', skip_reason: reason });
  }

  /** Terminal: gave up. The reaper handles retries before this point. */
  async markFailed(id: string, message: string): Promise<RepositoryResult<true>> {
    return this.markTerminal(id, { status: 'failed', error_message: message.slice(0, 500) });
  }

  private async markTerminal(
    id: string,
    patch: Record<string, unknown>
  ): Promise<RepositoryResult<true>> {
    try {
      const { error } = await this.supabase
        .from('daily_briefing_sends')
        .update({ ...patch, claimed_by: null, claimed_at: null, next_attempt_at: null })
        .eq('id', id);

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      logger.error({ err: error, id, patch }, 'Failed to write terminal state');
      return { data: null, error: error as Error };
    }
  }
}

export const dailyBriefingSendRepository = new DailyBriefingSendRepository();
