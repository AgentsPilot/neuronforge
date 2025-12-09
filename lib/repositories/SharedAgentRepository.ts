// lib/repositories/SharedAgentRepository.ts
// Repository for managing shared/template agents

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  SharedAgent,
  CreateSharedAgentInput,
  AgentRepositoryResult,
} from './types';

export class SharedAgentRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'SharedAgentRepository' });
  }

  /**
   * Check if an agent has already been shared by a user
   */
  async existsByOriginalAgent(originalAgentId: string, userId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('shared_agents')
      .select('id')
      .eq('original_agent_id', originalAgentId)
      .eq('user_id', userId)
      .maybeSingle();

    return !!data;
  }

  /**
   * Find shared agent by original agent ID and user
   */
  async findByOriginalAgent(originalAgentId: string, userId: string): Promise<AgentRepositoryResult<SharedAgent>> {
    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('original_agent_id', originalAgentId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new shared agent
   */
  async create(input: CreateSharedAgentInput): Promise<AgentRepositoryResult<SharedAgent>> {
    const methodLogger = this.logger.child({ method: 'create', userId: input.user_id, originalAgentId: input.original_agent_id });

    try {
      methodLogger.debug({ agentName: input.agent_name }, 'Creating shared agent');

      const { data, error } = await this.supabase
        .from('shared_agents')
        .insert({
          ...input,
          shared_at: new Date().toISOString(),
          score_calculated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      methodLogger.info({ sharedAgentId: data.id, qualityScore: input.quality_score }, 'Shared agent created');

      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to create shared agent');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find all shared agents by a user
   */
  async findByUserId(userId: string): Promise<AgentRepositoryResult<SharedAgent[]>> {
    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('user_id', userId)
        .order('shared_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a shared agent by ID
   */
  async findById(id: string): Promise<AgentRepositoryResult<SharedAgent>> {
    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const sharedAgentRepository = new SharedAgentRepository();
