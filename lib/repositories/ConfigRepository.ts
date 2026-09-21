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
   * Several system config values in ONE round trip, as a key → value map.
   *
   * `getSystemConfig` reads one key with `.single()`; this is `.in()`, for a
   * caller that needs more than one key per request (the owner usage card
   * reads two on every dashboard load). A key with no row is simply absent
   * from the map. Never throws.
   *
   * Server callers must construct this repository with `supabaseServer`: the
   * default client is the browser one.
   */
  async getSystemConfigs(configKeys: string[]): Promise<AgentRepositoryResult<Record<string, string>>> {
    try {
      const { data, error } = await this.supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', configKeys);

      if (error) throw error;

      const byKey: Record<string, string> = {};
      for (const row of (data ?? []) as Array<{ config_key: string; config_value: string }>) {
        byKey[row.config_key] = row.config_value;
      }
      return { data: byKey, error: null };
    } catch (error) {
      this.logger.warn({ err: error, keyCount: configKeys.length }, 'System config read failed');
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
   * Is a reward currently active? Returns the boolean and NOTHING else.
   *
   * Deliberately narrower than `getRewardConfig`, which also returns
   * `credits_amount`. This backs the customer-facing read at
   * `GET /api/rewards/agent-sharing`, and the point is that the eligibility
   * ruleset — amounts, thresholds, anti-abuse caps — never enters the route's
   * memory at all, rather than entering it and being trimmed on the way out.
   * A projection you have to remember to apply is one you can forget.
   *
   * Fails CLOSED: any error is `false`, so a database problem hides the reward
   * rather than advertising one that may not exist.
   */
  async isRewardActive(rewardKey: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('reward_config')
        .select('is_active')
        .eq('reward_key', rewardKey)
        .maybeSingle();

      if (error) throw error;
      return data?.is_active === true;
    } catch (error) {
      this.logger.error({ err: error, rewardKey }, 'Reward active-check failed; treating as inactive');
      return false;
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
