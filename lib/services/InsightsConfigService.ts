/**
 * InsightsConfigService
 *
 * Manages configuration for the insights/learning system including:
 * - Baseline & anomaly detection thresholds
 * - Error learning settings
 * - Plugin performance monitoring
 * - Pattern learning parameters
 * - V6 intent examples
 *
 * Part of Admin UI Controls for Memory System Enhancement
 *
 * @module lib/services/InsightsConfigService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'InsightsConfigService' });

// ============ Types ============

export interface BaselineConfig {
  enabled: boolean;
  min_samples: number;
  zscore_threshold: number;
  zscore_warning: number;
  zscore_critical: number;
  step_deviation_threshold: number;
  retry_deviation_threshold: number;
  duration_spike_factor: number;
}

export interface ErrorLearningConfig {
  enabled: boolean;
  min_occurrences: number;
  min_success_rate: number;
  min_attempts_for_evaluation: number;
}

export interface PluginPerformanceConfig {
  enabled: boolean;
  min_executions_agent: number;
  min_executions_userwide: number;
  success_drop_factor: number;
  duration_spike_factor: number;
  duration_critical_factor: number;
  error_rate_threshold: number;
}

export interface PatternLearningConfig {
  enabled: boolean;
  min_executions: number;
  min_success_rate: number;
}

export interface IntentExamplesConfig {
  enabled: boolean;
  default_limit: number;
  max_limit: number;
}

export interface UserExtractionConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  confidence_threshold: number;
}

export interface InsightsConfig {
  baseline: BaselineConfig;
  error_learning: ErrorLearningConfig;
  plugin_performance: PluginPerformanceConfig;
  pattern_learning: PatternLearningConfig;
  intent_examples: IntentExamplesConfig;
  user_extraction: UserExtractionConfig;
}

// ============ Default Configurations ============

const DEFAULT_BASELINE_CONFIG: BaselineConfig = {
  enabled: true,
  min_samples: 5,
  zscore_threshold: 2.0,
  zscore_warning: 2.5,
  zscore_critical: 4.0,
  step_deviation_threshold: 50, // percent
  retry_deviation_threshold: 100, // percent
  duration_spike_factor: 2.0,
};

const DEFAULT_ERROR_LEARNING_CONFIG: ErrorLearningConfig = {
  enabled: true,
  min_occurrences: 3,
  min_success_rate: 0.5,
  min_attempts_for_evaluation: 5,
};

const DEFAULT_PLUGIN_PERFORMANCE_CONFIG: PluginPerformanceConfig = {
  enabled: true,
  min_executions_agent: 10,
  min_executions_userwide: 20,
  success_drop_factor: 0.7,
  duration_spike_factor: 2.0,
  duration_critical_factor: 3.0,
  error_rate_threshold: 0.1,
};

const DEFAULT_PATTERN_LEARNING_CONFIG: PatternLearningConfig = {
  enabled: true,
  min_executions: 10,
  min_success_rate: 0.7,
};

const DEFAULT_INTENT_EXAMPLES_CONFIG: IntentExamplesConfig = {
  enabled: true,
  default_limit: 3,
  max_limit: 10,
};

const DEFAULT_USER_EXTRACTION_CONFIG: UserExtractionConfig = {
  model: 'gpt-4o-mini',
  temperature: 0.3,
  max_tokens: 1000,
  confidence_threshold: 0.7,
};

// ============ Service ============

export class InsightsConfigService {
  private cache: Map<string, { value: unknown; expires: number }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private supabase: SupabaseClient) {}

  /**
   * Get baseline configuration
   */
  async getBaselineConfig(): Promise<BaselineConfig> {
    return this.getConfigSection<BaselineConfig>('baseline', DEFAULT_BASELINE_CONFIG, [
      'insights_baseline_enabled',
      'insights_baseline_min_samples',
      'insights_baseline_zscore_threshold',
      'insights_baseline_zscore_warning',
      'insights_baseline_zscore_critical',
      'insights_baseline_step_deviation_threshold',
      'insights_baseline_retry_deviation_threshold',
      'insights_baseline_duration_spike_factor',
    ]);
  }

  /**
   * Get error learning configuration
   */
  async getErrorLearningConfig(): Promise<ErrorLearningConfig> {
    return this.getConfigSection<ErrorLearningConfig>(
      'error_learning',
      DEFAULT_ERROR_LEARNING_CONFIG,
      [
        'insights_error_learning_enabled',
        'insights_error_learning_min_occurrences',
        'insights_error_learning_min_success_rate',
        'insights_error_learning_min_attempts_for_evaluation',
      ]
    );
  }

  /**
   * Get plugin performance configuration
   */
  async getPluginPerformanceConfig(): Promise<PluginPerformanceConfig> {
    return this.getConfigSection<PluginPerformanceConfig>(
      'plugin_performance',
      DEFAULT_PLUGIN_PERFORMANCE_CONFIG,
      [
        'insights_plugin_performance_enabled',
        'insights_plugin_performance_min_executions_agent',
        'insights_plugin_performance_min_executions_userwide',
        'insights_plugin_performance_success_drop_factor',
        'insights_plugin_performance_duration_spike_factor',
        'insights_plugin_performance_duration_critical_factor',
        'insights_plugin_performance_error_rate_threshold',
      ]
    );
  }

  /**
   * Get pattern learning configuration
   */
  async getPatternLearningConfig(): Promise<PatternLearningConfig> {
    return this.getConfigSection<PatternLearningConfig>(
      'pattern_learning',
      DEFAULT_PATTERN_LEARNING_CONFIG,
      [
        'insights_pattern_learning_enabled',
        'insights_pattern_learning_min_executions',
        'insights_pattern_learning_min_success_rate',
      ]
    );
  }

  /**
   * Get intent examples configuration
   */
  async getIntentExamplesConfig(): Promise<IntentExamplesConfig> {
    return this.getConfigSection<IntentExamplesConfig>(
      'intent_examples',
      DEFAULT_INTENT_EXAMPLES_CONFIG,
      [
        'insights_intent_examples_enabled',
        'insights_intent_examples_default_limit',
        'insights_intent_examples_max_limit',
      ]
    );
  }

  /**
   * Get user extraction configuration
   */
  async getUserExtractionConfig(): Promise<UserExtractionConfig> {
    return this.getConfigSection<UserExtractionConfig>(
      'user_extraction',
      DEFAULT_USER_EXTRACTION_CONFIG,
      [
        'memory_user_extraction_model',
        'memory_user_extraction_temperature',
        'memory_user_extraction_max_tokens',
        'memory_user_extraction_confidence_threshold',
      ]
    );
  }

  /**
   * Get full insights configuration
   */
  async getFullConfig(): Promise<InsightsConfig> {
    const [baseline, error_learning, plugin_performance, pattern_learning, intent_examples, user_extraction] =
      await Promise.all([
        this.getBaselineConfig(),
        this.getErrorLearningConfig(),
        this.getPluginPerformanceConfig(),
        this.getPatternLearningConfig(),
        this.getIntentExamplesConfig(),
        this.getUserExtractionConfig(),
      ]);

    return {
      baseline,
      error_learning,
      plugin_performance,
      pattern_learning,
      intent_examples,
      user_extraction,
    };
  }

  /**
   * Clear config cache (call after admin updates)
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Insights config cache cleared');
  }

  // ============ Private Methods ============

  private async getConfigSection<T extends Record<string, unknown>>(
    sectionKey: string,
    defaults: T,
    keys: string[]
  ): Promise<T> {
    const cacheKey = `insights_${sectionKey}`;
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && now < cached.expires) {
      return cached.value as T;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', keys);

      if (error) {
        logger.error({ err: error }, `Failed to load ${sectionKey} config`);
        return defaults;
      }

      const config = { ...defaults };

      if (data && data.length > 0) {
        for (const item of data) {
          const fieldName = this.keyToFieldName(item.key);
          if (fieldName && fieldName in config) {
            (config as Record<string, unknown>)[fieldName] = this.parseValue(item.value);
          }
        }
      }

      // Update cache
      this.cache.set(cacheKey, { value: config, expires: now + this.CACHE_TTL_MS });

      return config;
    } catch (err) {
      logger.error({ err }, `Error loading ${sectionKey} config`);
      return defaults;
    }
  }

  /**
   * Convert database key to field name
   * e.g., "insights_baseline_min_samples" -> "min_samples"
   */
  private keyToFieldName(key: string): string | null {
    // Handle insights_* keys
    const insightsMatch = key.match(/^insights_[a-z_]+_(.+)$/);
    if (insightsMatch) {
      return insightsMatch[1];
    }

    // Handle memory_user_extraction_* keys
    const memoryMatch = key.match(/^memory_user_extraction_(.+)$/);
    if (memoryMatch) {
      return memoryMatch[1];
    }

    return null;
  }

  private parseValue(value: string): unknown {
    // Try JSON parse first
    try {
      return JSON.parse(value);
    } catch {
      // Not JSON
    }

    // Boolean strings
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Numbers
    const num = Number(value);
    if (!isNaN(num)) return num;

    // String
    return value;
  }
}

// ============ Singleton Factory ============

let _instance: InsightsConfigService | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getInsightsConfigService(supabase: SupabaseClient): InsightsConfigService {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new InsightsConfigService(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}

// ============ Exports for defaults (used by admin API) ============

export const INSIGHTS_DEFAULTS = {
  baseline: DEFAULT_BASELINE_CONFIG,
  error_learning: DEFAULT_ERROR_LEARNING_CONFIG,
  plugin_performance: DEFAULT_PLUGIN_PERFORMANCE_CONFIG,
  pattern_learning: DEFAULT_PATTERN_LEARNING_CONFIG,
  intent_examples: DEFAULT_INTENT_EXAMPLES_CONFIG,
  user_extraction: DEFAULT_USER_EXTRACTION_CONFIG,
};
