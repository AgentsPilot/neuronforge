// lib/repositories/SharedAgentRepository.ts
// Repository for managing shared/community agents

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
   * Returns both existence status and the shared agent ID if found
   */
  async existsByOriginalAgent(originalAgentId: string, userId: string): Promise<AgentRepositoryResult<{ exists: boolean; sharedAgentId: string | null }>> {
    const methodLogger = this.logger.child({ method: 'existsByOriginalAgent', originalAgentId, userId });

    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('id')
        .eq('original_agent_id', originalAgentId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      methodLogger.debug({ exists: !!data }, 'Checked shared agent existence');

      return {
        data: { exists: !!data, sharedAgentId: data?.id || null },
        error: null
      };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to check shared agent existence');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find shared agent by original agent ID and user
   */
  async findByOriginalAgent(originalAgentId: string, userId: string): Promise<AgentRepositoryResult<SharedAgent>> {
    const methodLogger = this.logger.child({ method: 'findByOriginalAgent', originalAgentId, userId });

    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('original_agent_id', originalAgentId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      methodLogger.debug({ found: !!data }, 'Found shared agent by original agent');

      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to find shared agent');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create a new shared agent
   */
  async create(input: CreateSharedAgentInput): Promise<AgentRepositoryResult<SharedAgent>> {
    const methodLogger = this.logger.child({ method: 'create', userId: input.user_id, originalAgentId: input.original_agent_id });

    try {
      const now = new Date().toISOString();

      methodLogger.debug({ agentName: input.agent_name }, 'Creating shared agent');

      const { data, error } = await this.supabase
        .from('shared_agents')
        .insert({
          ...input,
          shared_at: now,
          score_calculated_at: now,
        })
        .select()
        .single();

      if (error) throw error;

      methodLogger.info({ sharedAgentId: data.id, agentName: input.agent_name }, 'Shared agent created');

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
    const methodLogger = this.logger.child({ method: 'findByUserId', userId });

    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('user_id', userId)
        .order('shared_at', { ascending: false });

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0 }, 'Found shared agents by user');

      return { data: data || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to find shared agents by user');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a shared agent by ID
   */
  async findById(id: string): Promise<AgentRepositoryResult<SharedAgent>> {
    const methodLogger = this.logger.child({ method: 'findById', sharedAgentId: id });

    try {
      const { data, error } = await this.supabase
        .from('shared_agents')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      methodLogger.debug({ found: !!data }, 'Found shared agent by ID');

      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to find shared agent by ID');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Increment the import count for a shared agent
   */
  async incrementImportCount(id: string): Promise<AgentRepositoryResult<SharedAgent>> {
    const methodLogger = this.logger.child({ method: 'incrementImportCount', sharedAgentId: id });

    try {
      const { data: current } = await this.supabase
        .from('shared_agents')
        .select('import_count')
        .eq('id', id)
        .single();

      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await this.supabase
        .from('shared_agents')
        .update({
          import_count: (current?.import_count || 0) + 1,
          last_imported_at: now,
          updated_at: now
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      methodLogger.info({ newCount: updated.import_count }, 'Import count incremented');
      return { data: updated, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to increment import count');
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const sharedAgentRepository = new SharedAgentRepository();
