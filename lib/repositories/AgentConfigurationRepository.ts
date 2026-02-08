// lib/repositories/AgentConfigurationRepository.ts
// Repository for managing agent configurations (input values, execution status)

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { AgentRepositoryResult } from './types';

export interface AgentConfiguration {
  id: string;
  agent_id: string;
  user_id: string;
  input_values: Record<string, unknown>;
  input_schema: unknown;
  status?: string;
  created_at: string;
  updated_at?: string;
}

export interface AgentConfigurationInputValues {
  input_values: Record<string, unknown>;
  input_schema: unknown;
}

export class AgentConfigurationRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AgentConfigurationRepository' });
  }

  /**
   * Get input values for agent execution (most recent configuration)
   */
  async getInputValues(agentId: string, userId: string): Promise<AgentRepositoryResult<AgentConfigurationInputValues | null>> {
    const methodLogger = this.logger.child({ method: 'getInputValues', agentId, userId });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Fetching input values');

      const { data, error } = await this.supabase
        .from('agent_configurations')
        .select('input_values, input_schema')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      const duration = Date.now() - startTime;
      const inputCount = data?.input_values ? Object.keys(data.input_values).length : 0;
      methodLogger.debug({ inputCount, duration }, 'Fetched input values');

      return {
        data: data ? {
          input_values: data.input_values || {},
          input_schema: data.input_schema
        } : null,
        error: null
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch input values');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update execution status (used in legacy execution path)
   */
  async updateStatus(
    id: string,
    status: string,
    options?: { completedAt?: string; durationMs?: number }
  ): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'updateStatus', id, status });
    const startTime = Date.now();

    try {
      methodLogger.debug({}, 'Updating configuration status');

      const updateData: Record<string, unknown> = {
        status,
        created_at: new Date().toISOString(),
      };

      if (options?.completedAt) {
        updateData.completed_at = options.completedAt;
      }
      if (options?.durationMs !== undefined) {
        updateData.duration_ms = options.durationMs;
      }

      const { error } = await this.supabase
        .from('agent_configurations')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ status, duration }, 'Configuration status updated');

      return { data: true, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to update configuration status');
      return { data: false, error: error as Error };
    }
  }

  /**
   * Find configuration by ID
   */
  async findById(id: string): Promise<AgentRepositoryResult<AgentConfiguration | null>> {
    const methodLogger = this.logger.child({ method: 'findById', id });

    try {
      const { data, error } = await this.supabase
        .from('agent_configurations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      methodLogger.error({ err: error }, 'Failed to fetch configuration');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Save or update input values for an agent (used during calibration)
   * This ensures that input values from calibration runs are persisted
   * and can be reused in subsequent calibration runs.
   */
  async saveInputValues(
    agentId: string,
    userId: string,
    inputValues: Record<string, unknown>,
    inputSchema?: unknown
  ): Promise<AgentRepositoryResult<AgentConfiguration>> {
    const methodLogger = this.logger.child({ method: 'saveInputValues', agentId, userId });
    const startTime = Date.now();

    try {
      methodLogger.debug({ inputCount: Object.keys(inputValues).length }, 'Saving input values');

      // Check if configuration already exists
      const { data: existing } = await this.supabase
        .from('agent_configurations')
        .select('id')
        .eq('agent_id', agentId)
        .eq('user_id', userId)
        .maybeSingle();

      let result;

      if (existing) {
        // Update existing configuration
        result = await this.supabase
          .from('agent_configurations')
          .update({
            input_values: inputValues,
            input_schema: inputSchema,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single();
      } else {
        // Insert new configuration
        // Generate a unique ID for the configuration
        const configId = `config_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

        result = await this.supabase
          .from('agent_configurations')
          .insert({
            id: configId,
            agent_id: agentId,
            user_id: userId,
            input_values: inputValues,
            input_schema: inputSchema,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
      }

      if (result.error) throw result.error;

      const duration = Date.now() - startTime;
      methodLogger.info({
        configId: result.data.id,
        inputCount: Object.keys(inputValues).length,
        duration
      }, 'Input values saved successfully');

      return { data: result.data, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to save input values');
      return { data: null as any, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const agentConfigurationRepository = new AgentConfigurationRepository();
