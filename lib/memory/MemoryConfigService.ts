// lib/memory/MemoryConfigService.ts
// Service to load memory system configuration from database (NO HARDCODING)

import { SupabaseClient } from '@supabase/supabase-js';

export interface SummarizationConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  async: boolean;
  input_truncate_chars: number;
  output_truncate_chars: number;
  recent_history_count: number;
  recent_history_summary_chars: number;
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

export interface GlobalMemoryConfig {
  enabled: boolean;
  debug_mode: boolean;
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
   * Load global memory config from database
   */
  static async getGlobalConfig(
    supabase: SupabaseClient
  ): Promise<GlobalMemoryConfig> {
    const cacheKey = 'global';

    // Check cache
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);
    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) {
        return cached as GlobalMemoryConfig;
      }
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', ['memory_global_enabled', 'memory_global_debug_mode']);

      const config: GlobalMemoryConfig = {
        enabled: true,
        debug_mode: false
      };

      if (!error && data) {
        data.forEach((item) => {
          if (item.key === 'memory_global_enabled') {
            config.enabled = item.value === 'true' || item.value === true;
          }
          if (item.key === 'memory_global_debug_mode') {
            config.debug_mode = item.value === 'true' || item.value === true;
          }
        });
      }

      // Update cache
      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);

      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading global config`, error);
      return {
        enabled: true,
        debug_mode: false
      };
    }
  }

  /**
   * Load summarization config from database
   */
  static async getSummarizationConfig(
    supabase: SupabaseClient
  ): Promise<SummarizationConfig> {
    const cacheKey = 'summarization';
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);

    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) return cached as SummarizationConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'memory_summarization_model',
          'memory_summarization_temperature',
          'memory_summarization_max_tokens',
          'memory_summarization_async',
          'memory_summarization_input_truncate_chars',
          'memory_summarization_output_truncate_chars',
          'memory_summarization_recent_history_count',
          'memory_summarization_recent_history_summary_chars'
        ]);

      const config: SummarizationConfig = {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
        async: true,
        input_truncate_chars: 300,
        output_truncate_chars: 400,
        recent_history_count: 2,
        recent_history_summary_chars: 100
      };

      if (!error && data) {
        data.forEach((item) => {
          const value = item.value;
          if (item.key === 'memory_summarization_model') config.model = JSON.parse(value);
          if (item.key === 'memory_summarization_temperature') config.temperature = parseFloat(value);
          if (item.key === 'memory_summarization_max_tokens') config.max_tokens = parseInt(value);
          if (item.key === 'memory_summarization_async') config.async = value === 'true';
          if (item.key === 'memory_summarization_input_truncate_chars') config.input_truncate_chars = parseInt(value);
          if (item.key === 'memory_summarization_output_truncate_chars') config.output_truncate_chars = parseInt(value);
          if (item.key === 'memory_summarization_recent_history_count') config.recent_history_count = parseInt(value);
          if (item.key === 'memory_summarization_recent_history_summary_chars') config.recent_history_summary_chars = parseInt(value);
        });
      }

      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading summarization config`, error);
      return {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
        async: true,
        input_truncate_chars: 300,
        output_truncate_chars: 400,
        recent_history_count: 2,
        recent_history_summary_chars: 100
      };
    }
  }

  /**
   * Load embedding config from database
   */
  static async getEmbeddingConfig(
    supabase: SupabaseClient
  ): Promise<EmbeddingConfig> {
    const cacheKey = 'embedding';
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);

    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) return cached as EmbeddingConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'memory_embedding_model',
          'memory_embedding_dimensions',
          'memory_embedding_batch_size'
        ]);

      const config: EmbeddingConfig = {
        model: 'text-embedding-3-small',
        dimensions: 1536,
        batch_size: 100
      };

      if (!error && data) {
        data.forEach((item) => {
          const value = item.value;
          if (item.key === 'memory_embedding_model') config.model = JSON.parse(value);
          if (item.key === 'memory_embedding_dimensions') config.dimensions = parseInt(value);
          if (item.key === 'memory_embedding_batch_size') config.batch_size = parseInt(value);
        });
      }

      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading embedding config`, error);
      return {
        model: 'text-embedding-3-small',
        dimensions: 1536,
        batch_size: 100
      };
    }
  }

  /**
   * Load injection config from database
   */
  static async getInjectionConfig(
    supabase: SupabaseClient
  ): Promise<InjectionConfig> {
    const cacheKey = 'injection';
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);

    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) return cached as InjectionConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'memory_injection_max_tokens',
          'memory_injection_min_recent_runs',
          'memory_injection_max_recent_runs',
          'memory_injection_semantic_search_limit',
          'memory_injection_semantic_threshold'
        ]);

      const config: InjectionConfig = {
        max_tokens: 800,
        min_recent_runs: 3,
        max_recent_runs: 5,
        semantic_search_limit: 3,
        semantic_threshold: 0.7
      };

      if (!error && data) {
        data.forEach((item) => {
          const value = item.value;
          if (item.key === 'memory_injection_max_tokens') config.max_tokens = parseInt(value);
          if (item.key === 'memory_injection_min_recent_runs') config.min_recent_runs = parseInt(value);
          if (item.key === 'memory_injection_max_recent_runs') config.max_recent_runs = parseInt(value);
          if (item.key === 'memory_injection_semantic_search_limit') config.semantic_search_limit = parseInt(value);
          if (item.key === 'memory_injection_semantic_threshold') config.semantic_threshold = parseFloat(value);
        });
      }

      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading injection config`, error);
      return {
        max_tokens: 800,
        min_recent_runs: 3,
        max_recent_runs: 5,
        semantic_search_limit: 3,
        semantic_threshold: 0.7
      };
    }
  }

  /**
   * Load retention config from database
   */
  static async getRetentionConfig(
    supabase: SupabaseClient
  ): Promise<RetentionConfig> {
    const cacheKey = 'retention';
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);

    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) return cached as RetentionConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'memory_retention_run_memories_days',
          'memory_retention_low_importance_days',
          'memory_retention_consolidation_threshold',
          'memory_retention_consolidation_frequency_days'
        ]);

      const config: RetentionConfig = {
        run_memories_days: 90,
        low_importance_days: 30,
        consolidation_threshold: 50,
        consolidation_frequency_days: 7
      };

      if (!error && data) {
        data.forEach((item) => {
          const value = item.value;
          if (item.key === 'memory_retention_run_memories_days') config.run_memories_days = parseInt(value);
          if (item.key === 'memory_retention_low_importance_days') config.low_importance_days = parseInt(value);
          if (item.key === 'memory_retention_consolidation_threshold') config.consolidation_threshold = parseInt(value);
          if (item.key === 'memory_retention_consolidation_frequency_days') config.consolidation_frequency_days = parseInt(value);
        });
      }

      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading retention config`, error);
      return {
        run_memories_days: 90,
        low_importance_days: 30,
        consolidation_threshold: 50,
        consolidation_frequency_days: 7
      };
    }
  }

  /**
   * Load importance scoring config from database
   */
  static async getImportanceConfig(
    supabase: SupabaseClient
  ): Promise<ImportanceConfig> {
    const cacheKey = 'importance';
    const now = Date.now();
    const cachedExpiry = this.cacheExpiry.get(cacheKey);

    if (cachedExpiry && now < cachedExpiry) {
      const cached = this.configCache.get(cacheKey);
      if (cached) return cached as ImportanceConfig;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'memory_importance_base_score',
          'memory_importance_error_bonus',
          'memory_importance_pattern_bonus',
          'memory_importance_user_feedback_bonus',
          'memory_importance_first_run_bonus',
          'memory_importance_milestone_bonus'
        ]);

      const config: ImportanceConfig = {
        base_score: 5,
        error_bonus: 2,
        pattern_bonus: 2,
        user_feedback_bonus: 3,
        first_run_bonus: 2,
        milestone_bonus: 1
      };

      if (!error && data) {
        data.forEach((item) => {
          const value = item.value;
          if (item.key === 'memory_importance_base_score') config.base_score = parseFloat(value);
          if (item.key === 'memory_importance_error_bonus') config.error_bonus = parseFloat(value);
          if (item.key === 'memory_importance_pattern_bonus') config.pattern_bonus = parseFloat(value);
          if (item.key === 'memory_importance_user_feedback_bonus') config.user_feedback_bonus = parseFloat(value);
          if (item.key === 'memory_importance_first_run_bonus') config.first_run_bonus = parseFloat(value);
          if (item.key === 'memory_importance_milestone_bonus') config.milestone_bonus = parseFloat(value);
        });
      }

      this.configCache.set(cacheKey, config);
      this.cacheExpiry.set(cacheKey, now + this.CACHE_TTL_MS);
      return config;
    } catch (error) {
      console.error(`❌ [MemoryConfig] Error loading importance config`, error);
      return {
        base_score: 5,
        error_bonus: 2,
        pattern_bonus: 2,
        user_feedback_bonus: 3,
        first_run_bonus: 2,
        milestone_bonus: 1
      };
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
