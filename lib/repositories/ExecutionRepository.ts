// lib/repositories/ExecutionRepository.ts
// Repository for managing agent executions and token usage

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  Execution,
  ExecutionLogs,
  ExecutionStatus,
  ExecutionStatusRecord,
  TokenUsage,
  AgentRepositoryResult,
} from './types';

export interface CreateExecutionInput {
  agent_id: string;
  user_id: string;
  execution_type: 'manual' | 'scheduled';
  status: ExecutionStatus;
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_ms?: number;
  error_message?: string | null;
  logs?: ExecutionLogs;
  cron_expression?: string | null;
  progress?: number;
}

export class ExecutionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ExecutionRepository' });
  }

  /**
   * Find all executions for an agent
   * Only returns production executions (filters out calibration runs)
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
        .neq('run_mode', 'calibration')  // Filter out calibration runs, show production and null (backward compat)
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

  /**
   * Create a new execution record
   */
  async create(input: CreateExecutionInput): Promise<AgentRepositoryResult<Execution>> {
    const methodLogger = this.logger.child({
      method: 'create',
      agentId: input.agent_id,
      userId: input.user_id,
      executionType: input.execution_type
    });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Creating execution record');

      const { data, error } = await this.supabase
        .from('agent_executions')
        .insert({
          agent_id: input.agent_id,
          user_id: input.user_id,
          execution_type: input.execution_type,
          status: input.status,
          scheduled_at: input.scheduled_at,
          started_at: input.started_at,
          completed_at: input.completed_at,
          execution_duration_ms: input.execution_duration_ms,
          error_message: input.error_message ?? null,
          logs: input.logs ?? null,
          cron_expression: input.cron_expression ?? null,
          progress: input.progress ?? 0,
        })
        .select('*')
        .single();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ executionId: data.id, duration }, 'Execution record created');

      return { data, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to create execution record');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update execution logs (for adjusted tokens, etc.)
   */
  async updateLogs(id: string, logs: ExecutionLogs): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'updateLogs', executionId: id });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Updating execution logs');

      const { error } = await this.supabase
        .from('agent_executions')
        .update({ logs })
        .eq('id', id);

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'Execution logs updated');

      return { data: true, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to update execution logs');
      return { data: false, error: error as Error };
    }
  }

  /**
   * Find running executions for an agent (pending or running status)
   */
  async findRunningByAgentId(agentId: string): Promise<AgentRepositoryResult<Execution[]>> {
    const methodLogger = this.logger.child({ method: 'findRunningByAgentId', agentId });

    try {
      const { data, error } = await this.supabase
        .from('agent_executions')
        .select('*')
        .eq('agent_id', agentId)
        .in('status', ['pending', 'running'])
        .limit(5);

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0 }, 'Found running executions');

      return { data: data || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to find running executions');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find executions for status query (GET handler)
   * Returns limited fields for status polling
   */
  async findForStatusQuery(
    options: { executionId?: string; agentId?: string; limit?: number }
  ): Promise<AgentRepositoryResult<ExecutionStatusRecord[]>> {
    const methodLogger = this.logger.child({ method: 'findForStatusQuery', ...options });

    try {
      let query = this.supabase
        .from('agent_executions')
        .select('id, agent_id, execution_type, status, progress, scheduled_at, started_at, completed_at, error_message, execution_duration_ms, retry_count')
        .order('created_at', { ascending: false });

      if (options.executionId) {
        query = query.eq('id', options.executionId);
      } else if (options.agentId) {
        query = query.eq('agent_id', options.agentId).limit(options.limit || 5);
      }

      const { data, error } = await query;

      if (error) throw error;

      methodLogger.debug({ count: data?.length || 0 }, 'Fetched execution status');

      return { data: data || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch execution status');
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const executionRepository = new ExecutionRepository();
