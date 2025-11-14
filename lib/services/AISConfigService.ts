// lib/services/AISConfigService.ts
// Centralized AIS Configuration Service - SINGLE SOURCE OF TRUTH for all AIS ranges

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AISRange {
  min: number;
  max: number;
}

export interface AISRanges {
  // Execution metrics (runtime complexity)
  token_volume: AISRange;  // DEPRECATED: Will be removed after migration to growth-based system
  token_peak: AISRange;    // DEPRECATED: Will be removed after migration to growth-based system
  token_io_ratio_min: number;
  token_io_ratio_max: number;
  iterations: AISRange;
  duration_ms: AISRange;
  failure_rate: AISRange;
  retry_rate: AISRange;
  plugin_count: AISRange;
  plugins_per_run: AISRange;
  orchestration_overhead_ms: AISRange;
  workflow_steps: AISRange;
  branches: AISRange;
  loops: AISRange;
  parallel: AISRange;

  // Memory metrics (Phase 4 - database-driven)
  memory_ratio_min: number;      // Memory token ratio min (default: 0.0)
  memory_ratio_max: number;      // Memory token ratio max (default: 0.9)
  memory_diversity_min: number;  // Memory type diversity min (default: 0)
  memory_diversity_max: number;  // Memory type diversity max (default: 3)
  memory_volume_min: number;     // Memory entry count min (default: 0)
  memory_volume_max: number;     // Memory entry count max (default: 20)

  // Creation-specific metrics (design complexity)
  creation_workflow_steps: AISRange;
  creation_plugins: AISRange;
  creation_io_fields: AISRange;

  // Output Token Growth Thresholds (NEW - replaces absolute token thresholds)
  output_token_growth_monitor_threshold?: number;    // Default: 25%
  output_token_growth_rescore_threshold?: number;    // Default: 50%
  output_token_growth_upgrade_threshold?: number;    // Default: 100%
  output_token_growth_monitor_adjustment?: number;   // Default: 0.2
  output_token_growth_rescore_adjustment?: number;   // Default: 0.75
  output_token_growth_upgrade_adjustment?: number;   // Default: 1.25

  // Quality Metric Thresholds (NEW - for amplifying growth adjustments)
  quality_success_threshold?: number;                // Default: 80 (%)
  quality_retry_threshold?: number;                  // Default: 30 (%)
  quality_success_multiplier?: number;               // Default: 0.3
  quality_retry_multiplier?: number;                 // Default: 0.2
}

/**
 * Centralized AIS Configuration Service
 *
 * ELIMINATES HARDCODING:
 * - All normalization ranges loaded from database
 * - Single source of truth for AIS calculations
 * - Consistent across AgentIntensityService, updateAgentIntensity, and API routes
 *
 * FEATURES:
 * - Database-driven configuration
 * - 5-minute caching for performance
 * - Fallback to safe defaults if database unavailable
 * - Type-safe range access
 */
export class AISConfigService {
  private static cache: AISRanges | null = null;
  private static cacheTimestamp: number = 0;
  private static CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get active AIS ranges (with caching)
   *
   * This is the ONLY method that should be used to get normalization ranges.
   * All hardcoded values have been eliminated.
   */
  static async getRanges(supabase: SupabaseClient): Promise<AISRanges> {
    const now = Date.now();

    // Return cached ranges if still valid
    if (this.cache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      // Fetch ranges from database using RPC function
      const { data, error } = await supabase.rpc('get_active_ais_ranges');

      if (error || !data) {
        console.warn('⚠️ [AIS Config] Failed to fetch ranges from database, using fallback defaults');
        console.warn('⚠️ [AIS Config] Error:', error?.message);
        return this.getFallbackRanges();
      }

      // Convert array of ranges to typed object
      const ranges = this.parseRanges(data);

      // Update cache
      this.cache = ranges;
      this.cacheTimestamp = now;

      console.log('✅ [AIS Config] Loaded ranges from database (cached for 5 minutes)');
      return ranges;

    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching ranges:', error);
      return this.getFallbackRanges();
    }
  }

  /**
   * Parse database result into typed AISRanges object
   */
  private static parseRanges(data: any[]): AISRanges {
    const map: Record<string, { min: number; max: number }> = {};

    // Build map from array of {range_key, min_value, max_value}
    data.forEach((row: any) => {
      map[row.range_key] = {
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value)
      };
    });

    // Extract global threshold values from first row (all rows have same values)
    const firstRow = data[0] || {};

    // Return fully typed ranges with fallbacks
    return {
      // Execution ranges
      token_volume: map.token_volume ?? { min: 0, max: 5000 },
      token_peak: map.token_peak ?? { min: 0, max: 10000 },
      token_io_ratio_min: map.token_io_ratio_min?.min ?? 0.5,
      token_io_ratio_max: map.token_io_ratio_max?.min ?? 3.0,
      iterations: map.iterations ?? { min: 1, max: 10 },
      duration_ms: map.duration_ms ?? { min: 0, max: 30000 },
      failure_rate: map.failure_rate ?? { min: 0, max: 50 },
      retry_rate: map.retry_rate ?? { min: 0, max: 3 },
      plugin_count: map.plugin_count ?? { min: 0, max: 10 },
      plugins_per_run: map.plugins_per_run ?? { min: 0, max: 8 },
      orchestration_overhead_ms: map.orchestration_overhead_ms ?? { min: 0, max: 5000 },
      workflow_steps: map.workflow_steps ?? { min: 0, max: 20 },
      branches: map.branches ?? { min: 0, max: 10 },
      loops: map.loops ?? { min: 0, max: 50 },
      parallel: map.parallel ?? { min: 0, max: 5 },

      // Memory ranges (Phase 4 - database-driven)
      memory_ratio_min: map.memory_ratio?.min ?? 0.0,
      memory_ratio_max: map.memory_ratio?.max ?? 0.9,
      memory_diversity_min: map.memory_diversity?.min ?? 0,
      memory_diversity_max: map.memory_diversity?.max ?? 3,
      memory_volume_min: map.memory_volume?.min ?? 0,
      memory_volume_max: map.memory_volume?.max ?? 20,

      // Creation ranges (use same as execution if not explicitly defined)
      creation_workflow_steps: map.creation_workflow_steps ?? map.workflow_steps ?? { min: 1, max: 10 },
      creation_plugins: map.creation_plugins ?? map.plugin_count ?? { min: 1, max: 5 },
      creation_io_fields: map.creation_io_fields ?? { min: 1, max: 8 },

      // Growth thresholds (extracted from first row, all rows have same values)
      output_token_growth_monitor_threshold: firstRow.output_token_growth_monitor_threshold ?? 25,
      output_token_growth_rescore_threshold: firstRow.output_token_growth_rescore_threshold ?? 50,
      output_token_growth_upgrade_threshold: firstRow.output_token_growth_upgrade_threshold ?? 100,
      output_token_growth_monitor_adjustment: firstRow.output_token_growth_monitor_adjustment ?? 0.2,
      output_token_growth_rescore_adjustment: firstRow.output_token_growth_rescore_adjustment ?? 0.75,
      output_token_growth_upgrade_adjustment: firstRow.output_token_growth_upgrade_adjustment ?? 1.25,

      // Quality thresholds (extracted from first row, all rows have same values)
      quality_success_threshold: firstRow.quality_success_threshold ?? 80,
      quality_retry_threshold: firstRow.quality_retry_threshold ?? 30,
      quality_success_multiplier: firstRow.quality_success_multiplier ?? 0.3,
      quality_retry_multiplier: firstRow.quality_retry_multiplier ?? 0.2,
    };
  }

  /**
   * Fallback ranges used when database is unavailable
   * These are industry best-practice values
   */
  private static getFallbackRanges(): AISRanges {
    console.log('⚠️ [AIS Config] Using fallback ranges (database unavailable)');

    return {
      // Execution ranges
      token_volume: { min: 0, max: 5000 },
      token_peak: { min: 0, max: 10000 },
      token_io_ratio_min: 0.5,
      token_io_ratio_max: 3.0,
      iterations: { min: 1, max: 10 },
      duration_ms: { min: 0, max: 30000 },
      failure_rate: { min: 0, max: 50 },
      retry_rate: { min: 0, max: 3 },
      plugin_count: { min: 0, max: 10 },
      plugins_per_run: { min: 0, max: 8 },
      orchestration_overhead_ms: { min: 0, max: 5000 },
      workflow_steps: { min: 0, max: 20 },
      branches: { min: 0, max: 10 },
      loops: { min: 0, max: 50 },
      parallel: { min: 0, max: 5 },

      // Memory ranges (Phase 4 fallback)
      memory_ratio_min: 0.0,
      memory_ratio_max: 0.9,
      memory_diversity_min: 0,
      memory_diversity_max: 3,
      memory_volume_min: 0,
      memory_volume_max: 20,

      // Creation ranges
      creation_workflow_steps: { min: 1, max: 10 },
      creation_plugins: { min: 1, max: 5 },
      creation_io_fields: { min: 1, max: 8 },

      // Growth thresholds (fallback defaults)
      output_token_growth_monitor_threshold: 25,
      output_token_growth_rescore_threshold: 50,
      output_token_growth_upgrade_threshold: 100,
      output_token_growth_monitor_adjustment: 0.2,
      output_token_growth_rescore_adjustment: 0.75,
      output_token_growth_upgrade_adjustment: 1.25,

      // Quality thresholds (fallback defaults)
      quality_success_threshold: 80,
      quality_retry_threshold: 30,
      quality_success_multiplier: 0.3,
      quality_retry_multiplier: 0.2,
    };
  }

  /**
   * Normalize value to 0-10 scale using a given range
   *
   * @param value - The value to normalize
   * @param range - The min/max range for this metric
   * @param invert - If true, higher values = lower scores (for efficiency metrics)
   * @returns Score from 0-10
   */
  static normalize(value: number, range: AISRange, invert: boolean = false): number {
    // Clamp value to range
    const clamped = Math.max(range.min, Math.min(range.max, value));

    // Normalize to 0-10
    const normalized = ((clamped - range.min) / (range.max - range.min)) * 10;

    // Invert if needed (e.g., for efficiency where lower is better)
    return invert ? (10 - normalized) : normalized;
  }

  /**
   * Get system configuration value
   * Used for pricing, limits, and other system-wide settings
   *
   * @param supabase - Supabase client
   * @param configKey - Configuration key (e.g., 'pilot_credit_cost_usd')
   * @param fallbackValue - Fallback value if config not found
   * @returns Configuration value
   */
  static async getSystemConfig(
    supabase: SupabaseClient,
    configKey: string,
    fallbackValue: number
  ): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_value')
        .eq('config_key', configKey)
        .single();

      if (error || !data) {
        console.warn(`⚠️  [AIS Config] Config key '${configKey}' not found, using fallback: ${fallbackValue}`);
        return fallbackValue;
      }

      return Number(data.config_value);
    } catch (error) {
      console.error(`❌ [AIS Config] Error fetching config '${configKey}':`, error);
      return fallbackValue;
    }
  }

  /**
   * Get all system configuration
   * Returns a complete config object with all settings
   *
   * @param supabase - Supabase client
   * @returns System configuration object
   */
  static async getAllSystemConfig(supabase: SupabaseClient): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value');

      if (error || !data) {
        console.error('❌ [AIS Config] Error fetching all system config:', error);
        return {};
      }

      return Object.fromEntries(
        data.map(item => [item.config_key, Number(item.config_value)])
      );
    } catch (error) {
      console.error('❌ [AIS Config] Error fetching all system config:', error);
      return {};
    }
  }

  /**
   * Get scoring weights for a component
   *
   * @param supabase - Supabase client
   * @param componentKey - Component key (e.g., 'token_complexity', 'execution', 'creation')
   * @returns Object with sub-component weights
   */
  static async getScoringWeights(
    supabase: SupabaseClient,
    componentKey: string
  ): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('ais_scoring_weights')
        .select('sub_component, weight')
        .eq('component_key', componentKey);

      if (error || !data) {
        console.warn(`⚠️  [AIS Config] No weights found for component '${componentKey}'`);
        return {};
      }

      return Object.fromEntries(
        data.map(item => [item.sub_component || 'default', Number(item.weight)])
      );
    } catch (error) {
      console.error(`❌ [AIS Config] Error fetching weights for '${componentKey}':`, error);
      return {};
    }
  }

  /**
   * Get all scoring weights grouped by component
   *
   * @param supabase - Supabase client
   * @returns Nested object with all weights organized by component
   */
  static async getAllScoringWeights(supabase: SupabaseClient): Promise<Record<string, Record<string, number>>> {
    try {
      const { data, error } = await supabase
        .from('ais_scoring_weights')
        .select('component_key, sub_component, weight');

      if (error || !data) {
        console.error('❌ [AIS Config] Error fetching all scoring weights:', error);
        return {};
      }

      const weights: Record<string, Record<string, number>> = {};

      for (const item of data) {
        if (!weights[item.component_key]) {
          weights[item.component_key] = {};
        }
        weights[item.component_key][item.sub_component || 'default'] = Number(item.weight);
      }

      return weights;
    } catch (error) {
      console.error('❌ [AIS Config] Error fetching all scoring weights:', error);
      return {};
    }
  }

  /**
   * Clear cache (useful for testing or after admin updates ranges)
   */
  static clearCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
    console.log('🔄 [AIS Config] Cache cleared');
  }

  /**
   * Get cache status (for monitoring)
   */
  static getCacheStatus(): { cached: boolean; age_ms: number | null } {
    if (!this.cache) {
      return { cached: false, age_ms: null };
    }

    return {
      cached: true,
      age_ms: Date.now() - this.cacheTimestamp
    };
  }

  /**
   * Get execution dimension weights from database
   * Returns the 5 main dimension weights that determine execution_score
   *
   * Database keys:
   * - ais_weight_tokens (default: 0.30)
   * - ais_weight_execution (default: 0.25)
   * - ais_weight_plugins (default: 0.20)
   * - ais_weight_workflow (default: 0.15)
   * - ais_weight_memory (default: 0.10)
   *
   * ELIMINATES: lib/types/intensity.ts EXECUTION_WEIGHTS constant
   */
  static async getExecutionWeights(
    supabase: SupabaseClient
  ): Promise<{
    tokens: number;
    execution: number;
    plugins: number;
    workflow: number;
    memory: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_weight_tokens',
          'ais_weight_execution',
          'ais_weight_plugins',
          'ais_weight_workflow',
          'ais_weight_memory'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch execution weights, using fallback defaults');
        console.warn('⚠️ [AIS Config] Error:', error?.message);
        return {
          tokens: 0.30,
          execution: 0.25,
          plugins: 0.20,
          workflow: 0.15,
          memory: 0.10
        };
      }

      // Convert to map
      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      const weights = {
        tokens: weightMap['ais_weight_tokens'] ?? 0.30,
        execution: weightMap['ais_weight_execution'] ?? 0.25,
        plugins: weightMap['ais_weight_plugins'] ?? 0.20,
        workflow: weightMap['ais_weight_workflow'] ?? 0.15,
        memory: weightMap['ais_weight_memory'] ?? 0.10
      };

      console.log('✅ [AIS Config] Loaded execution weights from database:', weights);
      return weights;

    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching execution weights:', error);
      return {
        tokens: 0.30,
        execution: 0.25,
        plugins: 0.20,
        workflow: 0.15,
        memory: 0.10
      };
    }
  }

  /**
   * Get combined score weights from database
   * Returns the creation/execution blend weights
   *
   * Database keys:
   * - ais_weight_creation (default: 0.3)
   * - ais_weight_execution_blend (default: 0.7)
   *
   * ELIMINATES: lib/types/intensity.ts COMBINED_WEIGHTS constant
   */
  static async getCombinedWeights(
    supabase: SupabaseClient
  ): Promise<{
    creation: number;
    execution: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_weight_creation',
          'ais_weight_execution_blend'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch combined weights, using fallback defaults');
        console.warn('⚠️ [AIS Config] Error:', error?.message);
        return {
          creation: 0.3,
          execution: 0.7
        };
      }

      // Convert to map
      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      const weights = {
        creation: weightMap['ais_weight_creation'] ?? 0.3,
        execution: weightMap['ais_weight_execution_blend'] ?? 0.7
      };

      console.log('✅ [AIS Config] Loaded combined weights from database:', weights);
      return weights;

    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching combined weights:', error);
      return {
        creation: 0.3,
        execution: 0.7
      };
    }
  }

  /**
   * Get execution subdimension weights from database
   * Controls how execution complexity is calculated from iterations, duration, failures, retries
   *
   * Database keys:
   * - ais_execution_iterations_weight (default: 0.35)
   * - ais_execution_duration_weight (default: 0.30)
   * - ais_execution_failure_weight (default: 0.20)
   * - ais_execution_retry_weight (default: 0.15)
   */
  static async getExecutionSubWeights(
    supabase: SupabaseClient
  ): Promise<{
    iterations: number;
    duration: number;
    failure: number;
    retry: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_execution_iterations_weight',
          'ais_execution_duration_weight',
          'ais_execution_failure_weight',
          'ais_execution_retry_weight'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch execution sub-weights, using fallback defaults');
        return { iterations: 0.35, duration: 0.30, failure: 0.20, retry: 0.15 };
      }

      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      return {
        iterations: weightMap['ais_execution_iterations_weight'] ?? 0.35,
        duration: weightMap['ais_execution_duration_weight'] ?? 0.30,
        failure: weightMap['ais_execution_failure_weight'] ?? 0.20,
        retry: weightMap['ais_execution_retry_weight'] ?? 0.15
      };
    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching execution sub-weights:', error);
      return { iterations: 0.35, duration: 0.30, failure: 0.20, retry: 0.15 };
    }
  }

  /**
   * Get plugin subdimension weights from database
   * Controls how plugin complexity is calculated from count, usage, and overhead
   *
   * Database keys:
   * - ais_plugin_count_weight (default: 0.4)
   * - ais_plugin_usage_weight (default: 0.35)
   * - ais_plugin_overhead_weight (default: 0.25)
   */
  static async getPluginSubWeights(
    supabase: SupabaseClient
  ): Promise<{
    count: number;
    usage: number;
    overhead: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_plugin_count_weight',
          'ais_plugin_usage_weight',
          'ais_plugin_overhead_weight'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch plugin sub-weights, using fallback defaults');
        return { count: 0.4, usage: 0.35, overhead: 0.25 };
      }

      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      return {
        count: weightMap['ais_plugin_count_weight'] ?? 0.4,
        usage: weightMap['ais_plugin_usage_weight'] ?? 0.35,
        overhead: weightMap['ais_plugin_overhead_weight'] ?? 0.25
      };
    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching plugin sub-weights:', error);
      return { count: 0.4, usage: 0.35, overhead: 0.25 };
    }
  }

  /**
   * Get workflow subdimension weights from database
   * Controls how workflow complexity is calculated from steps, branches, loops, parallel
   *
   * Database keys:
   * - ais_workflow_steps_weight (default: 0.4)
   * - ais_workflow_branches_weight (default: 0.25)
   * - ais_workflow_loops_weight (default: 0.20)
   * - ais_workflow_parallel_weight (default: 0.15)
   */
  static async getWorkflowSubWeights(
    supabase: SupabaseClient
  ): Promise<{
    steps: number;
    branches: number;
    loops: number;
    parallel: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_workflow_steps_weight',
          'ais_workflow_branches_weight',
          'ais_workflow_loops_weight',
          'ais_workflow_parallel_weight'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch workflow sub-weights, using fallback defaults');
        return { steps: 0.4, branches: 0.25, loops: 0.20, parallel: 0.15 };
      }

      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      return {
        steps: weightMap['ais_workflow_steps_weight'] ?? 0.4,
        branches: weightMap['ais_workflow_branches_weight'] ?? 0.25,
        loops: weightMap['ais_workflow_loops_weight'] ?? 0.20,
        parallel: weightMap['ais_workflow_parallel_weight'] ?? 0.15
      };
    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching workflow sub-weights:', error);
      return { steps: 0.4, branches: 0.25, loops: 0.20, parallel: 0.15 };
    }
  }

  /**
   * Get memory subdimension weights from database
   * Controls how memory complexity is calculated from ratio, diversity, and volume
   *
   * Database keys:
   * - ais_memory_ratio_weight (default: 0.5)
   * - ais_memory_diversity_weight (default: 0.3)
   * - ais_memory_volume_weight (default: 0.2)
   */
  static async getMemorySubWeights(
    supabase: SupabaseClient
  ): Promise<{
    ratio: number;
    diversity: number;
    volume: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'ais_memory_ratio_weight',
          'ais_memory_diversity_weight',
          'ais_memory_volume_weight'
        ]);

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch memory sub-weights, using fallback defaults');
        return { ratio: 0.5, diversity: 0.3, volume: 0.2 };
      }

      const weightMap: Record<string, number> = {};
      data.forEach(row => {
        weightMap[row.config_key] = Number(row.config_value);
      });

      return {
        ratio: weightMap['ais_memory_ratio_weight'] ?? 0.5,
        diversity: weightMap['ais_memory_diversity_weight'] ?? 0.3,
        volume: weightMap['ais_memory_volume_weight'] ?? 0.2
      };
    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching memory sub-weights:', error);
      return { ratio: 0.5, diversity: 0.3, volume: 0.2 };
    }
  }

  /**
   * Get model routing configuration from database (Phase 3 Refactoring)
   * Controls which models are used for low/medium/high complexity routing
   *
   * Database table: model_routing_config
   * Rows:
   * - low: { model: 'gpt-4o-mini', provider: 'openai' }
   * - medium: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' }
   * - high: { model: 'gpt-4o', provider: 'openai' }
   *
   * ELIMINATES: Hardcoded DEFAULT_CONFIG in ModelRouter
   */
  static async getModelRoutingConfig(
    supabase: SupabaseClient
  ): Promise<{
    low: { model: string; provider: 'openai' | 'anthropic' };
    medium: { model: string; provider: 'openai' | 'anthropic' };
    high: { model: string; provider: 'openai' | 'anthropic' };
  }> {
    const fallbackConfig = {
      low: { model: 'gpt-4o-mini', provider: 'openai' as const },
      medium: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic' as const },
      high: { model: 'gpt-4o', provider: 'openai' as const }
    };

    try {
      const { data, error } = await supabase
        .from('model_routing_config')
        .select('complexity_tier, model_name, provider');

      if (error || !data || data.length === 0) {
        console.warn('⚠️ [AIS Config] Failed to fetch model routing config, using fallback defaults');
        return fallbackConfig;
      }

      // Build config object from rows
      const config: any = {
        low: fallbackConfig.low,
        medium: fallbackConfig.medium,
        high: fallbackConfig.high
      };

      data.forEach(row => {
        if (row.complexity_tier === 'low' || row.complexity_tier === 'medium' || row.complexity_tier === 'high') {
          config[row.complexity_tier] = {
            model: row.model_name,
            provider: row.provider as 'openai' | 'anthropic'
          };
        }
      });

      console.log('✅ [AIS Config] Loaded model routing config from database:', config);
      return config;
    } catch (error) {
      console.error('❌ [AIS Config] Exception fetching model routing config:', error);
      return fallbackConfig;
    }
  }

  /**
   * Get creation component weights from database (Phase 5)
   * Controls how creation score is calculated from workflow, plugin, and I/O complexity
   *
   * @returns Object with workflow, plugins, io_schema weights (should sum to 1.0)
   */
  static async getCreationWeights(supabase: SupabaseClient): Promise<{
    workflow: number;
    plugins: number;
    io_schema: number;
  }> {
    const fallbackWeights = {
      workflow: 0.5,
      plugins: 0.3,
      io_schema: 0.2
    };

    try {
      const [workflowWeight, pluginWeight, ioWeight] = await Promise.all([
        this.getSystemConfig(supabase, 'ais_creation_workflow_weight', 0.5),
        this.getSystemConfig(supabase, 'ais_creation_plugin_weight', 0.3),
        this.getSystemConfig(supabase, 'ais_creation_io_weight', 0.2)
      ]);

      const weights = {
        workflow: workflowWeight,
        plugins: pluginWeight,
        io_schema: ioWeight
      };

      console.log('✅ [AIS Config] Loaded creation weights from database:', weights);
      return weights;
    } catch (error) {
      console.warn('⚠️ [AIS Config] Failed to load creation weights, using fallback:', fallbackWeights);
      return fallbackWeights;
    }
  }
}
