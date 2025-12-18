// lib/repositories/AgentStatsRepository.ts
// Repository for managing agent statistics

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult } from './types';

export interface AgentStats {
  agent_id: string;
  user_id: string;
  run_count: number;
  success_count: number;
  last_run_at: string | null;
  last_run_cost: number | null;
}

export class AgentStatsRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AgentStatsRepository' });
  }

  /**
   * Get the last run cost for an agent (used for balance checks)
   */
  async getLastRunCost(agentId: string, userId: string): Promise<AgentRepositoryResult<number | null>> {
    const methodLogger = this.logger.child({ method: 'getLastRunCost', agentId, userId });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Fetching last run cost');

      const { data, error } = await this.supabase
        .from('agent_stats')
        .select('last_run_cost')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .order('last_run_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ lastRunCost: data?.last_run_cost, duration }, 'Fetched last run cost');

      return { data: data?.last_run_cost ?? null, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch last run cost');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Increment agent stats via RPC (wraps increment_agent_stats function)
   */
  async incrementStats(agentId: string, userId: string, success: boolean): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'incrementStats', agentId, userId, success });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Incrementing agent stats');

      const { error } = await this.supabase.rpc('increment_agent_stats', {
        agent_id_input: agentId,
        user_id_input: userId,
        success: success,
      });

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'Agent stats incremented');

      return { data: true, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to increment agent stats');
      return { data: false, error: error as Error };
    }
  }

  /**
   * Get stats for an agent
   */
  async findByAgentId(agentId: string, userId: string): Promise<AgentRepositoryResult<AgentStats | null>> {
    const methodLogger = this.logger.child({ method: 'findByAgentId', agentId, userId });

    try {
      const { data, error } = await this.supabase
        .from('agent_stats')
        .select('*')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch agent stats');
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const agentStatsRepository = new AgentStatsRepository();
