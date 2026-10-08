/**
 * Model-proposed findings: written by the weekly run, read by a person.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `insight_hypotheses` has RLS enabled and NO POLICY (migration 20261006e), so
 * every method here runs under the service role. That is the design rather than
 * a shortcut: a row is a claim a model wrote about somebody's business that
 * nobody has checked yet, and no owner session should be able to read one.
 *
 * Which makes the `.eq('user_id', userId)` rule (CLAUDE.md rule 1) read oddly
 * here, so each method says which it is. The write path IS user-scoped -- it
 * records whose business a claim is about. The review path is deliberately
 * cross-user, because the reviewer is an operator looking at every account at
 * once, and is marked ⟨unscoped-by-design⟩ in the same way the queue runners
 * in `LeadResponseRepository` and `DailyBriefingSendRepository` are.
 *
 * `claim` is model output. It is stored and returned to a review screen, and
 * never logged -- these methods log ids, counts and statuses only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'InsightHypothesisRepository' });

export interface RepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

export type HypothesisStatus = 'unconfirmed' | 'pending' | 'published' | 'dismissed';

export interface HypothesisRow {
  id: string;
  user_id: string;
  run_group_id: string;
  claim: string;
  query: Record<string, unknown>;
  confirm_when: Record<string, unknown>;
  verdict: Record<string, unknown> | null;
  status: HypothesisStatus;
  reject_reason: string | null;
  model_used: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
}

/** One row to write, as the generator produces it. */
export interface HypothesisInsert {
  userId: string;
  runGroupId: string;
  claim: string;
  query: Record<string, unknown>;
  confirmWhen: Record<string, unknown>;
  verdict: Record<string, unknown> | null;
  status: Extract<HypothesisStatus, 'unconfirmed' | 'pending'>;
  rejectReason?: string | null;
  modelUsed?: string | null;
}

export class InsightHypothesisRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient = supabaseServer) {
    this.supabase = supabaseClient;
  }

  /**
   * Record one weekly run's output: what was confirmed and what was not.
   *
   * Both halves in one insert. The unconfirmed rows are the point early on --
   * they are the record of what the generator gets wrong, and dropping them
   * would leave only the flattering half of the evidence.
   *
   * One statement rather than a loop: a partial write would leave a run looking
   * better than it was, which is the one direction this data must not fail in.
   */
  async recordRun(rows: HypothesisInsert[]): Promise<RepositoryResult<number>> {
    if (rows.length === 0) return { data: 0, error: null };

    try {
      const { data, error } = await this.supabase
        .from('insight_hypotheses')
        .insert(
          rows.map(r => ({
            user_id: r.userId,
            run_group_id: r.runGroupId,
            claim: r.claim,
            query: r.query,
            confirm_when: r.confirmWhen,
            verdict: r.verdict,
            status: r.status,
            reject_reason: r.rejectReason ?? null,
            model_used: r.modelUsed ?? null,
          }))
        )
        .select('id');

      if (error) throw error;

      // Counts and statuses only: `claim` is model output about a business.
      logger.info(
        {
          written: data?.length ?? 0,
          pending: rows.filter(r => r.status === 'pending').length,
          unconfirmed: rows.filter(r => r.status === 'unconfirmed').length,
        },
        'Hypothesis run recorded'
      );

      return { data: data?.length ?? 0, error: null };
    } catch (error) {
      logger.error({ err: error, rowCount: rows.length }, 'Failed to record a hypothesis run');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ — the review queue, across every account.
   *
   * The reviewer is an operator deciding which findings are worth an owner's
   * attention, so scoping this to one account would defeat its purpose. The
   * table has no owner policy, so there is no session that can reach this
   * without the service role; the caller is an admin-gated route.
   */
  async listForReview(
    status: HypothesisStatus = 'pending',
    limit = 50
  ): Promise<RepositoryResult<HypothesisRow[]>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_hypotheses')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { data: (data ?? []) as HypothesisRow[], error: null };
    } catch (error) {
      logger.error({ err: error, status }, 'Failed to list hypotheses for review');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ — one row by id, for the reviewer.
   *
   * Not user-scoped for the same reason as `listForReview`: the reviewer is an
   * operator, and the id came from their own listing. Returned rather than
   * acted on, so the caller can re-verify before publishing.
   */
  async findById(id: string): Promise<RepositoryResult<HypothesisRow | null>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_hypotheses')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as HypothesisRow) ?? null, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Failed to read a hypothesis');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ — a reviewer's decision.
   *
   * Conditional on the row still being `pending`, so two reviewers cannot both
   * decide it and a replayed request is a no-op. A returned row IS the
   * decision, the same atomic-claim shape `ProposalRepository.send` uses and
   * that `SchedulingRepository.update` was fixed to use after one booking
   * recorded five cancellations.
   */
  async decide(
    id: string,
    decision: Extract<HypothesisStatus, 'published' | 'dismissed'>,
    decidedBy: string
  ): Promise<RepositoryResult<HypothesisRow | null>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_hypotheses')
        .update({
          status: decision,
          decided_at: new Date().toISOString(),
          decided_by: decidedBy,
        })
        .eq('id', id)
        // The whole guarantee: only a row nobody has decided yet.
        .eq('status', 'pending')
        .select('*')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        logger.info({ id, decision }, 'Hypothesis was already decided; nothing changed');
        return { data: null, error: null };
      }

      logger.info({ id, decision, decidedBy }, 'Hypothesis decided');
      return { data: data as HypothesisRow, error: null };
    } catch (error) {
      logger.error({ err: error, id, decision }, 'Failed to decide a hypothesis');
      return { data: null, error: error as Error };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ — why proposals are being turned away, across accounts.
   *
   * The reject pile is how this feature is judged: if most rejections are the
   * Monday shape (`no_groups_returned`), the generator is proposing questions
   * its own data cannot answer and the prompt needs work rather than the
   * thresholds. Grouped in the database would need an RPC for one aggregate
   * over a small table, so it is counted here.
   */
  async rejectionReasons(sinceIso: string): Promise<RepositoryResult<Record<string, number>>> {
    try {
      const { data, error } = await this.supabase
        .from('insight_hypotheses')
        .select('reject_reason')
        .eq('status', 'unconfirmed')
        .gte('created_at', sinceIso);

      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        const reason = (row as { reject_reason: string | null }).reject_reason ?? 'unknown';
        counts[reason] = (counts[reason] ?? 0) + 1;
      }

      return { data: counts, error: null };
    } catch (error) {
      logger.error({ err: error, sinceIso }, 'Failed to count rejection reasons');
      return { data: null, error: error as Error };
    }
  }
}

export const insightHypothesisRepository = new InsightHypothesisRepository();
