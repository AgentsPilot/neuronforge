// lib/repositories/ExecutionRepository.ts
// Repository for managing agent executions and token usage

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import { createLogger, Logger } from '@/lib/logger';
import type {
  Execution,
  TokenUsage,
  AgentRepositoryResult,
} from './types';

export class ExecutionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ExecutionRepository' });
  }

  /**
   * Find all executions for an agent
   */
  async findByAgentId(
    agentId: string,
    options?: { limit?: number; offset?: number; orderBy?: 'started_at' | 'completed_at'; ascending?: boolean }
  ): Promise<AgentRepositoryResult<Execution[]>> {
    const methodLogger = this.logger.child({ method: 'findByAgentId', agentId });
    const startTime = Date.now();

    try {
      let query = this.supabase
        .from('agent_executions')
        .select('*')
        .eq('agent_id', agentId)
        .order(options?.orderBy || 'started_at', { ascending: options?.ascending ?? false });

      if (options?.limit) {
        query = query.limit(options.limit);
      }
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
      }

      const { data, error } = await query;
      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Fetched executions');

      return { data: data || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find a single execution by ID
   */
  async findById(id: string): Promise<AgentRepositoryResult<Execution>> {
    try {
      const { data, error } = await this.supabase
        .from('agent_executions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Count executions for an agent
   */
  async countByAgentId(agentId: string): Promise<AgentRepositoryResult<number>> {
    try {
      const { count, error } = await this.supabase
        .from('agent_executions')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId);

      if (error) throw error;
      return { data: count || 0, error: null };
    } catch (error) {
      return { data: 0, error: error as Error };
    }
  }

  /**
   * Batch fetch token usage for multiple executions
   */
  async getTokenUsageByExecutionIds(executionIds: string[]): Promise<AgentRepositoryResult<TokenUsage[]>> {
    const methodLogger = this.logger.child({ method: 'getTokenUsageByExecutionIds' });
    const startTime = Date.now();

    try {
      if (executionIds.length === 0) {
        return { data: [], error: null };
      }

      methodLogger.debug({ executionCount: executionIds.length }, 'Fetching token usage');

      const { data, error } = await this.supabase
        .from('token_usage')
        .select('id, execution_id, input_tokens, output_tokens, activity_type')
        .in('execution_id', executionIds);

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ recordCount: data?.length || 0, executionCount: executionIds.length, duration }, 'Token usage fetched');

      return { data: data || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, executionCount: executionIds.length, duration }, 'Failed to fetch token usage');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get token usage grouped by execution ID
   * Returns a Map for easy lookup
   */
  async getTokenUsageMapByExecutionIds(executionIds: string[]): Promise<AgentRepositoryResult<Map<string, TokenUsage[]>>> {
    const { data, error } = await this.getTokenUsageByExecutionIds(executionIds);

    if (error || !data) {
      return { data: null, error };
    }

    const tokenMap = new Map<string, TokenUsage[]>();
    data.forEach(record => {
      if (!tokenMap.has(record.execution_id)) {
        tokenMap.set(record.execution_id, []);
      }
      tokenMap.get(record.execution_id)!.push(record);
    });

    return { data: tokenMap, error: null };
  }

  /**
   * Get recent executions for an agent with status filter
   */
  async findRecentByAgentId(
    agentId: string,
    options?: { limit?: number; status?: Execution['status'] }
  ): Promise<AgentRepositoryResult<Execution[]>> {
    try {
      let query = this.supabase
        .from('agent_executions')
        .select('*')
        .eq('agent_id', agentId)
        .order('started_at', { ascending: false });

      if (options?.status) {
        query = query.eq('status', options.status);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
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
export const executionRepository = new ExecutionRepository();
