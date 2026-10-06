/**
 * CRM Pipeline Stages Repository
 * Handles dynamic pipeline stages per user based on their business vertical
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { TERMINAL_STAGE_TYPES, type StageType } from '@/lib/crm/StageTypeUtils';

const logger = createLogger({ service: 'CRMPipelineStagesRepository' });

export interface CRMPipelineStage {
  id: string;
  user_id: string;
  vertical: string;
  stage_key: string;
  stage_label: string;
  position: number;
  color: string | null;
  stage_type: StageType;
  is_primary_client_stage: boolean;
  created_at: string;
}

export interface CRMPipelineStageInsert {
  user_id: string;
  vertical: string;
  stage_key: string;
  stage_label: string;
  position: number;
  color?: string | null;
  stage_type?: StageType;
  is_primary_client_stage?: boolean;
}

export interface CRMPipelineStageUpdate {
  stage_label?: string;
  position?: number;
  color?: string | null;
  stage_type?: StageType;
  is_primary_client_stage?: boolean;
}

export interface CRMPipelineStagesRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// Default pipeline stages for different verticals
// Each stage includes stage_type for semantic classification and is_primary_client_stage for auto-promotion
export const DEFAULT_PIPELINE_STAGES: Record<string, Omit<CRMPipelineStageInsert, 'user_id'>[]> = {
  therapist: [
    { vertical: 'therapist', stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94A3B8', stage_type: 'lead' },
    { vertical: 'therapist', stage_key: 'intake', stage_label: 'Intake', position: 1, color: '#60A5FA', stage_type: 'prospect' },
    { vertical: 'therapist', stage_key: 'active_client', stage_label: 'Active Client', position: 2, color: '#34D399', stage_type: 'client', is_primary_client_stage: true },
    { vertical: 'therapist', stage_key: 'completed', stage_label: 'Completed', position: 3, color: '#A78BFA', stage_type: 'past_client' },
    { vertical: 'therapist', stage_key: 'inactive', stage_label: 'Inactive', position: 4, color: '#F87171', stage_type: 'past_client' }
  ],
  coach: [
    { vertical: 'coach', stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94A3B8', stage_type: 'lead' },
    { vertical: 'coach', stage_key: 'discovery', stage_label: 'Discovery Call', position: 1, color: '#60A5FA', stage_type: 'prospect' },
    { vertical: 'coach', stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#FBBF24', stage_type: 'prospect' },
    { vertical: 'coach', stage_key: 'active', stage_label: 'Active Client', position: 3, color: '#34D399', stage_type: 'client', is_primary_client_stage: true },
    { vertical: 'coach', stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#A78BFA', stage_type: 'past_client' }
  ],
  consultant: [
    { vertical: 'consultant', stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94A3B8', stage_type: 'lead' },
    { vertical: 'consultant', stage_key: 'qualified', stage_label: 'Qualified', position: 1, color: '#60A5FA', stage_type: 'prospect' },
    { vertical: 'consultant', stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#FBBF24', stage_type: 'prospect' },
    { vertical: 'consultant', stage_key: 'negotiation', stage_label: 'Negotiation', position: 3, color: '#F97316', stage_type: 'prospect' },
    { vertical: 'consultant', stage_key: 'active', stage_label: 'Active Project', position: 4, color: '#34D399', stage_type: 'client', is_primary_client_stage: true },
    { vertical: 'consultant', stage_key: 'completed', stage_label: 'Completed', position: 5, color: '#A78BFA', stage_type: 'past_client' }
  ],
  sales: [
    { vertical: 'sales', stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94A3B8', stage_type: 'lead' },
    { vertical: 'sales', stage_key: 'contacted', stage_label: 'Contacted', position: 1, color: '#60A5FA', stage_type: 'lead' },
    { vertical: 'sales', stage_key: 'meeting', stage_label: 'Meeting', position: 2, color: '#FBBF24', stage_type: 'prospect' },
    { vertical: 'sales', stage_key: 'proposal', stage_label: 'Proposal', position: 3, color: '#F97316', stage_type: 'prospect' },
    { vertical: 'sales', stage_key: 'negotiation', stage_label: 'Negotiation', position: 4, color: '#A78BFA', stage_type: 'prospect' },
    { vertical: 'sales', stage_key: 'closed_won', stage_label: 'Closed Won', position: 5, color: '#34D399', stage_type: 'client', is_primary_client_stage: true },
    { vertical: 'sales', stage_key: 'closed_lost', stage_label: 'Closed Lost', position: 6, color: '#F87171', stage_type: 'lost' }
  ],
  // Generic fallback
  default: [
    { vertical: 'default', stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#60A5FA', stage_type: 'lead' },
    { vertical: 'default', stage_key: 'client', stage_label: 'Client', position: 1, color: '#34D399', stage_type: 'client', is_primary_client_stage: true },
    { vertical: 'default', stage_key: 'past_client', stage_label: 'Past Client', position: 2, color: '#94A3B8', stage_type: 'past_client' }
  ]
};

export class CRMPipelineStagesRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Get all pipeline stages for a user, ordered by position
   */
  async list(userId: string): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage[]>> {
    try {
      const { data, error } = await this.supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('user_id', userId)
        .order('position', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to list pipeline stages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new pipeline stage
   */
  async create(
    stage: CRMPipelineStageInsert
  ): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage>> {
    try {
      logger.info({ userId: stage.user_id, stageKey: stage.stage_key }, 'Creating pipeline stage');

      const { data, error } = await this.supabase
        .from('crm_pipeline_stages')
        .insert(stage)
        .select()
        .single();

      if (error) throw error;

      logger.info({ stageId: data.id, userId: stage.user_id }, 'Pipeline stage created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: stage.user_id }, 'Failed to create pipeline stage');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create multiple stages at once (for seeding defaults)
   */
  async createMany(
    stages: CRMPipelineStageInsert[]
  ): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage[]>> {
    try {
      if (stages.length === 0) {
        return { data: [], error: null };
      }

      const userId = stages[0].user_id;
      logger.info({ userId, count: stages.length }, 'Creating multiple pipeline stages');

      const { data, error } = await this.supabase
        .from('crm_pipeline_stages')
        .insert(stages)
        .select();

      if (error) throw error;

      logger.info({ userId, count: data?.length }, 'Pipeline stages created');
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create pipeline stages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a pipeline stage
   */
  async update(
    id: string,
    userId: string,
    updates: CRMPipelineStageUpdate
  ): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage>> {
    try {
      logger.info({ stageId: id, userId }, 'Updating pipeline stage');

      const { data, error } = await this.supabase
        .from('crm_pipeline_stages')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      logger.info({ stageId: id, userId }, 'Pipeline stage updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, stageId: id, userId }, 'Failed to update pipeline stage');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a pipeline stage
   */
  async delete(
    id: string,
    userId: string
  ): Promise<CRMPipelineStagesRepositoryResult<void>> {
    try {
      logger.info({ stageId: id, userId }, 'Deleting pipeline stage');

      const { error } = await this.supabase
        .from('crm_pipeline_stages')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      logger.info({ stageId: id, userId }, 'Pipeline stage deleted');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, stageId: id, userId }, 'Failed to delete pipeline stage');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Seed default pipeline stages for a user based on their vertical
   */
  async seedDefaults(
    userId: string,
    vertical: string
  ): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage[]>> {
    try {
      // Check if user already has stages
      const existing = await this.list(userId);
      if (existing.data && existing.data.length > 0) {
        logger.info({ userId, count: existing.data.length }, 'User already has pipeline stages');
        return existing;
      }

      // Get defaults for the vertical, fall back to 'default' if not found
      const defaults = DEFAULT_PIPELINE_STAGES[vertical] || DEFAULT_PIPELINE_STAGES.default;

      const stagesToCreate: CRMPipelineStageInsert[] = defaults.map(stage => ({
        ...stage,
        user_id: userId
      }));

      logger.info({ userId, vertical, count: stagesToCreate.length }, 'Seeding default pipeline stages');
      return this.createMany(stagesToCreate);
    } catch (error) {
      logger.error({ err: error, userId, vertical }, 'Failed to seed default pipeline stages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Reorder stages (update positions)
   */
  async reorder(
    userId: string,
    stageIds: string[]
  ): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage[]>> {
    try {
      logger.info({ userId, stageIds }, 'Reordering pipeline stages');

      // Update each stage with its new position. Supabase update() resolves to a
      // { data, error } result rather than throwing, so inspect each result and surface the
      // first error instead of silently swallowing a failed reorder.
      const updates = stageIds.map((id, index) =>
        this.supabase
          .from('crm_pipeline_stages')
          .update({ position: index })
          .eq('id', id)
          .eq('user_id', userId)
      );

      const results = await Promise.all(updates);
      const firstError = results.find(r => r.error)?.error;
      if (firstError) throw firstError;

      // Return updated list
      return this.list(userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to reorder pipeline stages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The stage that means "this person is a client of ours, now".
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS WAS MOVING PEOPLE TO *INACTIVE*
   *
   * This asked the question by NAME. It matched a stage whose label contained
   * "active" — and `'Inactive'.includes('active')` is true, because "inactive"
   * ends with the word it negates. So a stage meaning *the relationship is
   * over* answered the question *who is an active client*, and creating a paid
   * booking moved the contact straight into it.
   *
   * Not hypothetical: the therapist pipeline ships `inactive` / "Inactive" /
   * `stage_type: 'past_client'` at position 4, and any pipeline reaching the
   * label test with such a stage hits it every time. It read as intermittent
   * because pipelines whose keys match at step 1 never get that far.
   *
   * The failure was never the typo alone. It was asking by name at all, which
   * `components/crm/contactStatus.ts` already warns about: pipelines are
   * generated per business, so one calls the stage `inactive`, the next
   * `הושלם`, the next `closed_lost`. The semantic columns exist precisely so
   * nobody has to guess — `is_primary_client_stage`, then `stage_type`.
   *
   * THE NAME HEURISTICS SURVIVE, BEHIND THE SEMANTIC ONES AND FENCED.
   * Rows written before `stage_type` existed may carry no usable type, and a
   * business with such a pipeline still needs an answer. But no heuristic may
   * now return a TERMINAL stage, whatever it is called: a stage meaning the
   * relationship ended cannot be the stage meaning it began.
   *
   * Returns null when the pipeline genuinely has no client stage. The caller
   * leaves the contact where they are, which is the right outcome — better than
   * inventing a stage the business never defined.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async findActiveClientStage(userId: string): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage | null>> {
    try {
      const stagesResult = await this.list(userId);
      if (stagesResult.error || !stagesResult.data || stagesResult.data.length === 0) {
        return { data: null, error: stagesResult.error };
      }

      // `list` orders by position, so "first" below means first in the pipeline.
      const stages = stagesResult.data;

      /*
       * A stage the business marked as where its clients live. The flag is the
       * owner's own answer and outranks everything else.
       */
      const primary = stages.find(stage => stage.is_primary_client_stage);
      if (primary) return { data: primary, error: null };

      /* Otherwise the first stage classified as a client stage. */
      const byType = stages.find(stage => stage.stage_type === 'client');
      if (byType) return { data: byType, error: null };

      /*
       * No semantic answer. Everything below is a guess at a name, so none of
       * it may land on a stage that means the relationship is over.
       */
      const candidates = stages.filter(
        stage => !TERMINAL_STAGE_TYPES.includes(stage.stage_type)
      );
      if (candidates.length === 0) return { data: null, error: null };

      const activeStageKeys = ['active_client', 'active', 'client', 'closed_won'];
      for (const key of activeStageKeys) {
        const found = candidates.find(stage => stage.stage_key === key);
        if (found) return { data: found, error: null };
      }

      /*
       * By label, as a last resort before counting positions.
       *
       * `includes('active')` is gone: it is the bug above, and a filter that
       * needs an exclusion list to be safe is the wrong test. These match the
       * WORD, so "Active Client" and "Client" qualify and "Inactive" does not.
       */
      const byLabel = candidates.find(stage => /\b(active|client)\b/i.test(stage.stage_label));
      if (byLabel) return { data: byLabel, error: null };

      /*
       * Position, which says nothing about meaning and is why this is last.
       * The second-to-last stage is usually the one before "completed" — taken
       * from the non-terminal stages, so a pipeline ending in two terminal
       * stages does not hand back one of them.
       */
      if (candidates.length >= 3) {
        return { data: candidates[candidates.length - 2], error: null };
      }

      if (candidates.length >= 2) {
        return { data: candidates[1], error: null };
      }

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find active client stage');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export with server-side Supabase client
import { supabaseServer } from '@/lib/supabaseServer';
export const crmPipelineStagesRepository = new CRMPipelineStagesRepository(supabaseServer);
