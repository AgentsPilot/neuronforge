// lib/repositories/ConfigRepository.ts
// Repository for managing system configuration

import { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import { createLogger, Logger } from '@/lib/logger';
import type {
  SystemConfig,
  RewardConfig,
  AgentRepositoryResult,
} from './types';

export class ConfigRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'ConfigRepository' });
  }

  /**
   * Get a system config value by key
   */
  async getSystemConfig(configKey: string): Promise<AgentRepositoryResult<string>> {
    try {
      const { data, error } = await this.supabase
        .from('ais_system_config')
        .select('config_value')
        .eq('config_key', configKey)
        .single();

      if (error) throw error;
      return { data: data?.config_value || null, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get a system config as number
   */
  async getSystemConfigAsNumber(configKey: string, defaultValue: number = 0): Promise<number> {
    const { data } = await this.getSystemConfig(configKey);
    if (data) {
      const parsed = parseInt(data, 10);
      if (!isNaN(parsed)) return parsed;
    }
    return defaultValue;
  }

  /**
   * Get an active reward config by key
   */
  async getRewardConfig(rewardKey: string): Promise<AgentRepositoryResult<RewardConfig>> {
    try {
      const { data, error } = await this.supabase
        .from('reward_config')
        .select('reward_key, credits_amount, is_active')
        .eq('reward_key', rewardKey)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get reward credits amount for a specific reward type
   */
  async getRewardAmount(rewardKey: string, defaultAmount: number = 0): Promise<number> {
    const { data } = await this.getRewardConfig(rewardKey);
    return data?.credits_amount ?? defaultAmount;
  }

  /**
   * Get all active reward configs
   */
  async getAllActiveRewards(): Promise<AgentRepositoryResult<RewardConfig[]>> {
    try {
      const { data, error } = await this.supabase
        .from('reward_config')
        .select('reward_key, credits_amount, is_active')
        .eq('is_active', true);

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}

// Export singleton instance for convenience
export const configRepository = new ConfigRepository();
