// lib/repositories/SystemConfigRepository.ts
// Repository for managing system_settings_config table

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { SystemSettingsConfig, AgentRepositoryResult } from './types';

export class SystemConfigRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'SystemConfigRepository' });
  }

  /**
   * Get a single config value by key
   */
  async getByKey(key: string): Promise<AgentRepositoryResult<SystemSettingsConfig>> {
    const methodLogger = this.logger.child({ method: 'getByKey', key });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('*')
        .eq('key', key)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - not found
          methodLogger.debug({ duration: Date.now() - startTime }, 'Config not found');
          return { data: null, error: null };
        }
        throw error;
      }

      methodLogger.debug({ duration: Date.now() - startTime }, 'Config fetched');
      return { data, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch config');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all configs for a category
   */
  async getByCategory(category: string): Promise<AgentRepositoryResult<SystemSettingsConfig[]>> {
    const methodLogger = this.logger.child({ method: 'getByCategory', category });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('*')
        .eq('category', category)
        .order('key');

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Configs fetched by category');
      return { data: data || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch configs by category');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get multiple configs by keys
   */
  async getByKeys(keys: string[]): Promise<AgentRepositoryResult<SystemSettingsConfig[]>> {
    const methodLogger = this.logger.child({ method: 'getByKeys', keyCount: keys.length });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('*')
        .in('key', keys);

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'Configs fetched by keys');
      return { data: data || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch configs by keys');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get configs and return as a key-value map
   * Useful for client consumption
   */
  async getByCategoryAsMap(category: string): Promise<AgentRepositoryResult<Record<string, any>>> {
    const { data, error } = await this.getByCategory(category);

    if (error || !data) {
      return { data: null, error };
    }

    const configMap: Record<string, any> = {};
    for (const row of data) {
      configMap[row.key] = row.value;
    }

    return { data: configMap, error: null };
  }

  /**
   * Get a string config value with fallback
   */
  async getString(key: string, fallback: string = ''): Promise<string> {
    const { data } = await this.getByKey(key);
    if (data?.value !== undefined && data?.value !== null) {
      return String(data.value);
    }
    return fallback;
  }

  /**
   * Get a number config value with fallback
   */
  async getNumber(key: string, fallback: number = 0): Promise<number> {
    const { data } = await this.getByKey(key);
    if (data?.value !== undefined && data?.value !== null) {
      const num = Number(data.value);
      if (!isNaN(num)) return num;
    }
    return fallback;
  }

  /**
   * Get a boolean config value with fallback
   */
  async getBoolean(key: string, fallback: boolean = false): Promise<boolean> {
    const { data } = await this.getByKey(key);
    if (data?.value !== undefined && data?.value !== null) {
      if (typeof data.value === 'boolean') return data.value;
      if (typeof data.value === 'string') return data.value.toLowerCase() === 'true';
    }
    return fallback;
  }

  /**
   * Upsert a config value
   */
  async set(
    key: string,
    value: any,
    category?: string,
    description?: string
  ): Promise<AgentRepositoryResult<SystemSettingsConfig>> {
    const methodLogger = this.logger.child({ method: 'set', key });
    const startTime = Date.now();

    try {
      // First check if exists
      const { data: existing } = await this.getByKey(key);

      if (existing) {
        // Update existing
        const { data, error } = await this.supabase
          .from('system_settings_config')
          .update({ value, updated_at: new Date().toISOString() })
          .eq('key', key)
          .select()
          .single();

        if (error) throw error;

        const duration = Date.now() - startTime;
        methodLogger.info({ duration }, 'Config updated');
        return { data, error: null };
      } else {
        // Insert new - infer category if not provided
        const inferredCategory = category || this.inferCategory(key);

        const { data, error } = await this.supabase
          .from('system_settings_config')
          .insert({
            key,
            value,
            category: inferredCategory,
            description: description || `Configuration for ${key}`
          })
          .select()
          .single();

        if (error) throw error;

        const duration = Date.now() - startTime;
        methodLogger.info({ category: inferredCategory, duration }, 'Config created');
        return { data, error: null };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to set config');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all configuration values
   */
  async getAll(): Promise<AgentRepositoryResult<SystemSettingsConfig[]>> {
    const methodLogger = this.logger.child({ method: 'getAll' });
    const startTime = Date.now();

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('*')
        .order('category')
        .order('key');

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.debug({ count: data?.length || 0, duration }, 'All configs fetched');
      return { data: data || [], error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to fetch all configs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set multiple configuration values
   */
  async setMultiple(
    updates: Record<string, any>,
    category?: string
  ): Promise<AgentRepositoryResult<SystemSettingsConfig[]>> {
    const methodLogger = this.logger.child({ method: 'setMultiple', keyCount: Object.keys(updates).length });
    const startTime = Date.now();

    try {
      const results: SystemSettingsConfig[] = [];

      for (const [key, value] of Object.entries(updates)) {
        const { data, error } = await this.set(key, value, category);
        if (error) throw error;
        if (data) results.push(data);
      }

      const duration = Date.now() - startTime;
      methodLogger.info({ count: results.length, duration }, 'Multiple configs set');
      return { data: results, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to set multiple configs');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Delete a configuration entry
   */
  async delete(key: string): Promise<AgentRepositoryResult<boolean>> {
    const methodLogger = this.logger.child({ method: 'delete', key });
    const startTime = Date.now();

    try {
      const { error } = await this.supabase
        .from('system_settings_config')
        .delete()
        .eq('key', key);

      if (error) throw error;

      const duration = Date.now() - startTime;
      methodLogger.info({ duration }, 'Config deleted');
      return { data: true, error: null };
    } catch (error) {
      const duration = Date.now() - startTime;
      methodLogger.error({ err: error, duration }, 'Failed to delete config');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get routing configuration (convenience method)
   * Fetches all routing-related settings in parallel
   */
  async getRoutingConfig(): Promise<{
    enabled: boolean;
    lowThreshold: number;
    mediumThreshold: number;
    minExecutions: number;
    minSuccessRate: number;
    anthropicEnabled: boolean;
  }> {
    const [
      enabled,
      lowThreshold,
      mediumThreshold,
      minExecutions,
      minSuccessRate,
      anthropicEnabled
    ] = await Promise.all([
      this.getBoolean('intelligent_routing_enabled', false),
      this.getNumber('routing_low_threshold', 3.9),
      this.getNumber('routing_medium_threshold', 6.9),
      this.getNumber('routing_min_executions', 3),
      this.getNumber('routing_min_success_rate', 85),
      this.getBoolean('anthropic_provider_enabled', true)
    ]);

    return {
      enabled,
      lowThreshold,
      mediumThreshold,
      minExecutions,
      minSuccessRate,
      anthropicEnabled
    };
  }

  /**
   * Get agent creation configuration (convenience method)
   * Fetches AI provider and model settings
   */
  async getAgentCreationConfig(): Promise<{
    provider: string;
    model: string;
  }> {
    const [provider, model] = await Promise.all([
      this.getString('agent_creation_ai_provider', 'openai'),
      this.getString('agent_creation_ai_model', 'gpt-4o')
    ]);

    return { provider, model };
  }

  /**
   * Get agent generation configuration (V5 generator)
   * Fetches AI provider and model settings for technical workflow LLM review
   */
  async getAgentGenerationConfig(): Promise<{
    provider: string;
    model: string;
  }> {
    const [provider, model] = await Promise.all([
      this.getString('agent_generation_ai_provider', 'openai'),
      this.getString('agent_generation_ai_model', 'gpt-5.2')
    ]);

    return { provider, model };
  }

  /**
   * Infer category from key prefix
   */
  private inferCategory(key: string): string {
    if (key.startsWith('pilot_') || key.startsWith('workflow_orchestrator_')) return 'pilot';
    if (key.startsWith('routing_') || key.startsWith('intelligent_routing_')) return 'routing';
    if (key.startsWith('helpbot_')) return 'helpbot';
    if (key.startsWith('memory_')) return 'memory';
    if (key.startsWith('agent_creation_')) return 'agent_creation';
    return 'general';
  }
}

// Export singleton instance for convenience
export const systemConfigRepository = new SystemConfigRepository();