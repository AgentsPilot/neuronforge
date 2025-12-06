// lib/repositories/MemoryRepository.ts
// Repository for managing agent run memories

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult } from './types';

export interface RunMemory {
  id: string;
  agent_id: string;
  content: string;
  created_at: string;
}

export class MemoryRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'MemoryRepository' });
  }

  /**
   * Count memories for an agent
   */
  async countByAgentId(agentId: string): Promise<AgentRepositoryResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      if (error) throw error;
      return { data: count || 0, error: null };
    } catch (error) {
      return { data: 0, error: error as Error };
    }
  }

  /**
   * Find memories for an agent
   */
  async findByAgentId(
    agentId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AgentRepositoryResult<RunMemory[]>> {
    try {
      let query = this.supabase
        .from('run_memories')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const memoryRepository = new MemoryRepository();
