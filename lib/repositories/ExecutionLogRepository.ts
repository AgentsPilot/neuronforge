// lib/repositories/ExecutionLogRepository.ts
// Repository for managing step-by-step execution logs (agent_execution_logs table)
// Used primarily in the legacy execution path

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult } from './types';

export type ExecutionLogLevel = 'info' | 'warning' | 'error';
export type ExecutionLogPhase = 'documents' | 'prompt' | 'validation' | string;

export interface ExecutionLog {
  id: string;
  execution_id: string;
  agent_id: string;
  user_id: string;
  timestamp: string;
  level: ExecutionLogLevel;
  message: string;
  phase: ExecutionLogPhase;
}

export interface CreateExecutionLogInput {
  execution_id: string;
  agent_id: string;
  user_id: string;
  timestamp?: string;
  level: ExecutionLogLevel;
  message: string;
  phase: ExecutionLogPhase;
}

export class ExecutionLogRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ExecutionLogRepository' });
  }

  /**
   * Create a step-by-step execution log entry
   */
  async create(input: CreateExecutionLogInput): Promise<AgentRepositoryResult<{ id: string } | null>> {
    const methodLogger = this.logger.child({
      method: 'create',
      executionId: input.execution_id,
      phase: input.phase,
      level: input.level
    });

    try {
      const { data, error } = await this.supabase
        .from('agent_execution_logs')
        .insert({
          execution_id: input.execution_id,
          agent_id: input.agent_id,
          user_id: input.user_id,
          timestamp: input.timestamp || new Date().toISOString(),
          level: input.level,
          message: input.message,
          phase: input.phase,
        })
        .select('id')
        .single();

      if (error) throw error;

      methodLogger.debug({ logId: data?.id }, 'Execution log created');

      return { data: data ? { id: data.id } : null, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to create execution log');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find logs by execution ID
   */
  async findByExecutionId(executionId: string): Promise<AgentRepositoryResult<ExecutionLog[]>> {
    const methodLogger = this.logger.child({ method: 'findByExecutionId', executionId });

    try {
      const { data, error } = await this.supabase
        .from('agent_execution_logs')
        .select('*')
        .eq('execution_id', executionId)
        .order('timestamp', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch execution logs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Create multiple log entries at once
   */
  async createMany(inputs: CreateExecutionLogInput[]): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'createMany', count: inputs.length });

    try {
      if (inputs.length === 0) {
        return { data: true, error: null };
      }

      const records = inputs.map(input => ({
        execution_id: input.execution_id,
        agent_id: input.agent_id,
        user_id: input.user_id,
        timestamp: input.timestamp || new Date().toISOString(),
        level: input.level,
        message: input.message,
        phase: input.phase,
      }));

      const { error } = await this.supabase
        .from('agent_execution_logs')
        .insert(records);

      if (error) throw error;

      methodLogger.debug({ count: inputs.length }, 'Execution logs created');

      return { data: true, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to create execution logs');
      return { data: false, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const executionLogRepository = new ExecutionLogRepository();
