// lib/repositories/AgentMetricsRepository.ts
// Repository for managing agent intensity metrics

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentMetrics,
  AgentRepositoryResult,
} from './types';

export class AgentMetricsRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AgentMetricsRepository' });
  }

  /**
   * Find metrics for an agent
   */
  async findByAgentId(agentId: string): Promise<AgentRepositoryResult<AgentMetrics>> {
    try {
      const { data, error } = await this.supabase
        .from('agent_intensity_metrics')
        .select('agent_id, user_id, success_rate, total_executions, avg_execution_time_ms, last_execution_at')
        .eq('agent_id', agentId)
        .maybeSingle();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get success rate and total executions for an agent
   * Convenience method for sharing feature
   */
  async getBasicMetrics(agentId: string): Promise<AgentRepositoryResult<{ success_rate: number; total_executions: number }>> {
    try {
      const { data, error } = await this.supabase
        .from('agent_intensity_metrics')
        .select('success_rate, total_executions')
        .eq('agent_id', agentId)
        .maybeSingle();

      if (error) throw error;
      return {
        data: data || { success_rate: 0, total_executions: 0 },
        error: null
      };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const agentMetricsRepository = new AgentMetricsRepository();
