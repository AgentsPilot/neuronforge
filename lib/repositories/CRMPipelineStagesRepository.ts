/**
 * CRM Pipeline Stages Repository
 * Handles dynamic pipeline stages per user based on their business vertical
 *
 * Following the repository pattern defined in REPOSITORY_STRATEGY.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { StageType } from '@/lib/crm/StageTypeUtils';

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

      // Update each stage with its new position
      const updates = stageIds.map((id, index) =>
        this.supabase
          .from('crm_pipeline_stages')
          .update({ position: index })
          .eq('id', id)
          .eq('user_id', userId)
      );

      await Promise.all(updates);

      // Return updated list
      return this.list(userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to reorder pipeline stages');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find the "active client" stage for a user's pipeline
   * Looks for common stage keys: 'active_client', 'active', 'client', 'closed_won'
   * Falls back to the stage at position 2+ (typically active/client stages)
   *
   * @deprecated Use findClientStage() from '@/lib/crm/StageTypeUtils' instead.
   * This method uses heuristics; the new utility uses the semantic stage_type column.
   */
  async findActiveClientStage(userId: string): Promise<CRMPipelineStagesRepositoryResult<CRMPipelineStage | null>> {
    try {
      const stagesResult = await this.list(userId);
      if (stagesResult.error || !stagesResult.data || stagesResult.data.length === 0) {
        return { data: null, error: stagesResult.error };
      }

      const stages = stagesResult.data;

      // Priority order for finding "active client" stage
      const activeStageKeys = ['active_client', 'active', 'client', 'closed_won'];

      for (const key of activeStageKeys) {
        const found = stages.find(s => s.stage_key === key);
        if (found) {
          return { data: found, error: null };
        }
      }

      // Fallback: find a stage with "active" or "client" in the label (case insensitive)
      const byLabel = stages.find(s =>
        s.stage_label.toLowerCase().includes('active') ||
        s.stage_label.toLowerCase().includes('client')
      );
      if (byLabel) {
        return { data: byLabel, error: null };
      }

      // Last resort: use the second-to-last stage (often the "active" stage before completed)
      if (stages.length >= 3) {
        return { data: stages[stages.length - 2], error: null };
      }

      // If only 2 stages, use the last one
      if (stages.length >= 2) {
        return { data: stages[1], error: null };
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
