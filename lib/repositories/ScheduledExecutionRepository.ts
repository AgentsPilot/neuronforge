/**
 * The scheduler's queue: scheduled rows of `agent_executions`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE EXECUTION LAYER'S OWN LEDGER, NOT A NEW ONE
 *
 * `agent_executions` has recorded agent runs since the platform's beginning and
 * already carries every column a queue needs — `scheduled_at` (the tick),
 * `status`, `retry_count`, `next_retry_at`, `cron_expression`, and
 * `execution_type` to tell a scheduled run from a manual one. Migration
 * 20261101 added only the lease: `claimed_by` and `claimed_at`.
 *
 * So there is no scheduler queue table. There is the execution ledger, and the
 * scheduler claims the rows in it that are pending and scheduled. Everything
 * here is scoped to `execution_type = 'scheduled'`, so a manual run — a person
 * pressing Run on /api/run-agent — is never visible to the scheduler and never
 * claimed.
 *
 * `agent_scheduler_state` is deliberately untouched: every column it has
 * duplicates `agents` or this table, and two clocks that can disagree are worse
 * than one that cannot. See 20261101's header.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @see supabase/migrations/20261101_agent_executions_claim.sql
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';

const logger = createLogger({ service: 'ScheduledExecutionRepository' });

/** What the scheduler reads and writes. A superset lives on the table. */
export interface ScheduledExecution {
  id: string;
  agent_id: string;
  user_id: string;
  execution_type: string;
  /** The tick this run is for — the `next_run` the scheduler saw. */
  scheduled_at: string | null;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  retry_count: number | null;
  next_retry_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  cron_expression: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
}

export interface QueueScheduledRun {
  agent_id: string;
  user_id: string;
  /** The tick. NOT `now()`: two attempts at one tick must be one row. */
  scheduled_at: string;
  cron_expression: string | null;
}

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export class ScheduledExecutionRepository {
  constructor(private supabase: SupabaseClient = supabaseServer) {}

  /**
   * Queue one scheduled run.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A DUPLICATE IS A SUCCESS, NOT A FAULT.
   *
   * `agent_executions_one_scheduled_run_per_tick` is a partial UNIQUE on
   * (agent_id, scheduled_at) for scheduled rows, so two overlapping scheduler
   * passes that both see the same due agent produce one row. The loser hits
   * 23505, and that is the correct outcome: the tick is queued, which is all
   * the caller wanted.
   *
   * `{ data: null, error: null }` means "already queued". A caller that reads
   * null as failure will miscount, not misbehave.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async queueRun(run: QueueScheduledRun): Promise<RepositoryResult<ScheduledExecution | null>> {
    try {
      const { data, error } = await this.supabase
        .from('agent_executions')
        .insert({
          agent_id: run.agent_id,
          user_id: run.user_id,
          execution_type: 'scheduled',
          scheduled_at: run.scheduled_at,
          cron_expression: run.cron_expression,
          status: 'pending',
          progress: 0,
        })
        .select()
        .single();

      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return { data: null, error: null };
        }
        throw error;
      }

      return { data: data as ScheduledExecution, error: null };
    } catch (error) {
      logger.error(
        { err: error, agentId: run.agent_id, userId: run.user_id },
        'Could not queue a scheduled run'
      );
      return { data: null, error: error as Error };
    }
  }

  /**
   * Claim a batch of due scheduled runs.
   *
   * ⟨unscoped-by-design⟩ — crosses every tenant, because a scheduler has to.
   * What follows is scoped to `row.user_id`, which is copied from the agent row
   * and is the only thing the plugin channel accepts as a tenant. Same
   * precedent as InsightActionRepository and PluginConnectionRepository.
   */
  async claimDue(runnerId: string, batch: number): Promise<ScheduledExecution[]> {
    const { data, error } = await this.supabase.rpc('claim_due_scheduled_executions', {
      p_runner: runnerId,
      p_batch: batch,
    });

    if (error) {
      logger.error({ err: error }, 'Could not claim scheduled executions');
      return [];
    }

    return (data ?? []) as ScheduledExecution[];
  }

  /**
   * Return runs whose function was killed mid-execution; dead-letter the spent.
   *
   * ⟨unscoped-by-design⟩ — crosses every tenant, as above.
   */
  async reapStale(leaseSeconds: number, maxAttempts: number): Promise<ScheduledExecution[]> {
    const { data, error } = await this.supabase.rpc('reap_stale_scheduled_executions', {
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts,
    });

    if (error) {
      logger.error({ err: error }, 'Could not reap stale scheduled executions');
      return [];
    }

    const reaped = (data ?? []) as ScheduledExecution[];
    if (reaped.length > 0) {
      logger.warn({ count: reaped.length }, 'Recovered scheduled executions from a dead runner');
    }
    return reaped;
  }

  /**
   * Close a claimed run as done.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id, which the runner only has
   * because it claimed it.
   */
  async markCompleted(id: string, result: Record<string, unknown>): Promise<void> {
    await this.close(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: 100,
      result,
      claimed_by: null,
      claimed_at: null,
    });
  }

  /**
   * Close a claimed run without executing, and say why.
   *
   * Skipping is ordinary, not a failure: the agent was paused between queueing
   * and claiming, or its plan is empty. Terminal, so it is never claimed again.
   *
   * `status = 'completed'` with the reason in `result`, because
   * `agent_executions` has no `skipped` status and inventing one would break
   * every reader that enumerates them.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id.
   */
  async markSkipped(id: string, reason: string): Promise<void> {
    await this.close(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: { skipped: true, reason },
      claimed_by: null,
      claimed_at: null,
    });
  }

  /**
   * Close a claimed run as failed — or release it for another attempt.
   *
   * Back to `pending` with backoff while attempts remain; terminal `failed`
   * once they do not, so a permanently broken agent stops and the row stays as
   * the evidence. The curve matches the reaper's, so a crash and a caught error
   * are not retried on two different schedules.
   *
   * ⟨unscoped-by-design⟩ — addressed by row id.
   */
  async markFailed(id: string, message: string, retry: boolean): Promise<void> {
    if (!retry) {
      await this.close(id, {
        status: 'failed',
        error_message: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
        claimed_by: null,
        claimed_at: null,
      });
      return;
    }

    const { data } = await this.supabase
      .from('agent_executions')
      .select('retry_count')
      .eq('id', id)
      .maybeSingle();

    const attempts = (data as { retry_count?: number } | null)?.retry_count ?? 1;
    const delaySeconds = Math.min(3600, 60 * 2 ** attempts);

    await this.close(id, {
      status: 'pending',
      error_message: message.slice(0, 2000),
      claimed_by: null,
      claimed_at: null,
      next_retry_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
    });
  }

  /**
   * This agent's recent scheduled runs, newest first. Scoped to the owner.
   *
   * Read this rather than `agents.last_run` to answer "has it run": that column
   * is written only by the scheduler paths, so a run from /api/run-agent leaves
   * it null and a surface reading it says "never run" for ever.
   */
  async findRecentByAgent(
    agentId: string,
    userId: string,
    limit = 5
  ): Promise<ScheduledExecution[]> {
    const { data, error } = await this.supabase
      .from('agent_executions')
      .select('*')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .eq('execution_type', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error({ err: error, agentId, userId }, 'Could not list scheduled runs');
      return [];
    }
    return (data ?? []) as ScheduledExecution[];
  }

  private async close(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase
      .from('agent_executions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      /*
       * Loud, because this is the one failure the pattern cannot absorb. A run
       * that executed and was never closed stays `running`, and the reaper
       * hands it to another pass once the lease expires — which means running
       * the agent again, and writing to the same clients again.
       */
      logger.error(
        { err: error, id, updates },
        'Could not close a scheduled execution; it may be run again'
      );
    }
  }
}

export const scheduledExecutionRepository = new ScheduledExecutionRepository();
