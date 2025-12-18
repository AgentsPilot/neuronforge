// lib/repositories/AgentLogsRepository.ts
// Repository for managing agent execution logs (agent_logs table)

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult } from './types';

export interface AgentLog {
  id: string;
  agent_id: string;
  user_id: string;
  run_output: string | null;
  full_output: Record<string, unknown> | null;
  status: 'completed' | 'failed';
  status_message?: string | null;
  execution_type?: string | null;
  created_at: string;
}

export interface CreateAgentLogInput {
  agent_id: string;
  user_id: string;
  run_output?: string | null;
  full_output?: Record<string, unknown> | null;
  status: 'completed' | 'failed';
  status_message?: string | null;
  execution_type?: string | null;
  created_at?: string;
}

export class AgentLogsRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AgentLogsRepository' });
  }

  /**
   * Create a new agent log entry
   */
  async create(input: CreateAgentLogInput): Promise<AgentRepositoryResult<{ id: string }>> {
    const methodLogger = this.logger.child({
      method: 'create',
      agentId: input.agent_id,
      userId: input.user_id,
      status: input.status
    });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Creating agent log');

      const { data, error } = await this.supabase
        .from('agent_logs')
        .insert({
          agent_id: input.agent_id,
          user_id: input.user_id,
          run_output: input.run_output ?? null,
          full_output: input.full_output ?? null,
          status: input.status,
          status_message: input.status_message ?? null,
          execution_type: input.execution_type ?? null,
          created_at: input.created_at || new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ logId: data.id, duration }, 'Agent log created');

      return { data: { id: data.id }, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to create agent log');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find logs by agent ID
   */
  async findByAgentId(
    agentId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AgentRepositoryResult<AgentLog[]>> {
    const methodLogger = this.logger.child({ method: 'findByAgentId', agentId });

    try {
      let query = this.supabase
        .from('agent_logs')
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
      methodLogger.error({ err: error }, 'Failed to fetch agent logs');
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const agentLogsRepository = new AgentLogsRepository();
