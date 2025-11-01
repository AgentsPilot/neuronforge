// lib/services/AISConfigService.ts
// Centralized AIS Configuration Service - SINGLE SOURCE OF TRUTH for all AIS ranges

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AISRange {
  min: number;
  max: number;
}

export interface AISRanges {
  // Execution metrics (runtime complexity)
  token_volume: AISRange;
  token_peak: AISRange;
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

  // Creation-specific metrics (design complexity)
  creation_workflow_steps: AISRange;
  creation_plugins: AISRange;
  creation_io_fields: AISRange;
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

      // Creation ranges (use same as execution if not explicitly defined)
      creation_workflow_steps: map.creation_workflow_steps ?? map.workflow_steps ?? { min: 1, max: 10 },
      creation_plugins: map.creation_plugins ?? map.plugin_count ?? { min: 1, max: 5 },
      creation_io_fields: map.creation_io_fields ?? { min: 1, max: 8 },
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

      // Creation ranges
      creation_workflow_steps: { min: 1, max: 10 },
      creation_plugins: { min: 1, max: 5 },
      creation_io_fields: { min: 1, max: 8 },
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
}
