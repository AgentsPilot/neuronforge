// lib/memory/MemoryConfigService.ts
// Service to load memory system configuration from database (NO HARDCODING)

import { SupabaseClient } from '@supabase/supabase-js';

export interface SummarizationConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  async: boolean;
}

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  batch_size: number;
}

export interface InjectionConfig {
  max_tokens: number;
  min_recent_runs: number;
  max_recent_runs: number;
  semantic_search_limit: number;
  semantic_threshold: number;
}

export interface RetentionConfig {
  run_memories_days: number;
  low_importance_days: number;
  consolidation_threshold: number;
  consolidation_frequency_days: number;
}

export interface ImportanceConfig {
  base_score: number;
  error_bonus: number;
  pattern_bonus: number;
  user_feedback_bonus: number;
  first_run_bonus: number;
  milestone_bonus: number;
}

/**
 * Memory Configuration Service
 *
 * Loads ALL memory system parameters from database (memory_config table)
 * No hardcoded values - everything is configurable via admin UI
 */
export class MemoryConfigService {
  private static configCache: Map<string, any> = new Map();
  private static cacheExpiry: Map<string, number> = new Map();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Load summarization config from database
   */
  static async getSummarizationConfig(
    supabase: SupabaseClient
  ): Promise<SummarizationConfig> {
    return this.getConfig<SummarizationConfig>(supabase, 'summarization', {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 500,
      async: true,
      input_truncate_chars: 300,
      output_truncate_chars: 400,
      recent_history_count: 2,
      recent_history_summary_chars: 100
    });
  }

  /**
   * Load embedding config from database
   */
  static async getEmbeddingConfig(
    supabase: SupabaseClient
  ): Promise<EmbeddingConfig> {
    return this.getConfig<EmbeddingConfig>(supabase, 'embedding', {
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batch_size: 100
    });
  }

  /**
   * Load injection config from database
   */
  static async getInjectionConfig(
    supabase: SupabaseClient
  ): Promise<InjectionConfig> {
    return this.getConfig<InjectionConfig>(supabase, 'injection', {
      max_tokens: 800,
      min_recent_runs: 3,
      max_recent_runs: 5,
      semantic_search_limit: 3,
      semantic_threshold: 0.7
    });
  }

  /**
   * Load retention config from database
   */
  static async getRetentionConfig(
    supabase: SupabaseClient
  ): Promise<RetentionConfig> {
    return this.getConfig<RetentionConfig>(supabase, 'retention', {
      run_memories_days: 90,
      low_importance_days: 30,
      consolidation_threshold: 50,
      consolidation_frequency_days: 7
    });
  }

  /**
   * Load importance scoring config from database
   */
  static async getImportanceConfig(
    supabase: SupabaseClient
  ): Promise<ImportanceConfig> {
    return this.getConfig<ImportanceConfig>(supabase, 'importance', {
      base_score: 5,
      error_bonus: 2,
      pattern_bonus: 2,
      user_feedback_bonus: 3,
      first_run_bonus: 2,
      milestone_bonus: 1
    });
  }

  /**
   * Generic config loader with caching
   *
   * @private
   */
  private static async getConfig<T>(
    supabase: SupabaseClient,
    configKey: string,
    defaultValue: T
  ): Promise<T> {
    // Check cache
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(configKey);
    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(configKey);
      if (cached) {
        console.log(`💾 [MemoryConfig] Using cached config: ${configKey}`);
        return cached as T;
      }
    }

    try {
      console.log(`🔍 [MemoryConfig] Loading config from database: ${configKey}`);

      const { data, error } = await supabase
        .from('memory_config')
        .select('config_value')
        .eq('config_key', configKey)
        .eq('is_active', true)
        .single();

      if (error || !data) {
        console.warn(`⚠️ [MemoryConfig] Config not found: ${configKey}, using default`);
        return defaultValue;
      }

      const config = data.config_value as T;

      // Update cache
      this.configCache.set(configKey, config);
      this.cacheExpiry.set(configKey, now + this.CACHE_TTL_MS);

      console.log(`✅ [MemoryConfig] Loaded config: ${configKey}`, config);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading config: ${configKey}`, error);
      return defaultValue;
    }
  }

  /**
   * Clear config cache (useful after admin updates)
   */
  static clearCache() {
    this.configCache.clear();
    this.cacheExpiry.clear();
    console.log('🗑️ [MemoryConfig] Cache cleared');
  }

  /**
   * Update config in database
   *
   * Used by admin UI to modify memory parameters
   */
  static async updateConfig(
    supabase: SupabaseClient,
    configKey: string,
    configValue: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('memory_config')
        .update({
          config_value: configValue,
          updated_at: new Date().toISOString()
        })
        .eq('config_key', configKey);

      if (error) {
        return { success: false, error: error.message };
      }

      // Clear cache to force reload
      this.configCache.delete(configKey);
      this.cacheExpiry.delete(configKey);

      console.log(`✅ [MemoryConfig] Updated config: ${configKey}`);
      return { success: true };
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error updating config: ${configKey}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
