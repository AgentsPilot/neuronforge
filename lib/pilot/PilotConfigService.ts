/**
 * Pilot Configuration Service
 *
 * Loads Pilot workflow configuration from database
 * Provides defaults and caching for performance
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { PilotOptions } from './types';

export class PilotConfigService {
  private static configCache: PilotOptions | null = null;
  private static lastFetch: number = 0;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get default Pilot configuration
   */
  private static getDefaultConfig(): PilotOptions {
    return {
      maxParallelSteps: 3,
      defaultTimeout: 300000, // 5 minutes
      enableCaching: false,
      continueOnError: false,
      enableProgressTracking: true,
      enableRealTimeUpdates: false,
      enableOptimizations: true,
      cacheStepResults: false,
      defaultRetryPolicy: {
        maxRetries: 3,
        backoffMs: 1000, // Start with 1 second
        backoffMultiplier: 2, // Exponential backoff
        retryableErrors: ['TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMIT', 'SERVICE_UNAVAILABLE'],
      },
    };
  }

  /**
   * Load Pilot configuration from database
   *
   * @param supabase - Supabase client
   * @returns Pilot configuration with fallback to defaults
   */
  static async loadPilotConfig(supabase: SupabaseClient): Promise<PilotOptions> {
    // Return cached config if still valid
    const now = Date.now();
    if (this.configCache && (now - this.lastFetch) < this.CACHE_TTL) {
      return this.configCache;
    }

    try {
      const { data, error } = await supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'pilot_max_parallel_steps',
          'pilot_max_execution_time_ms',
          'pilot_enable_caching',
          'pilot_continue_on_error',
          'pilot_enable_progress_tracking',
          'pilot_enable_real_time_updates',
          'pilot_enable_optimizations',
          'pilot_cache_step_results',
        ]);

      if (error || !data) {
        console.warn('[PilotConfig] Failed to load config from database, using defaults:', error);
        this.configCache = this.getDefaultConfig();
        this.lastFetch = now;
        return this.configCache;
      }

      // Parse configuration
      const config: Record<string, any> = {};
      data.forEach((row) => {
        config[row.key] = row.value;
      });

      this.configCache = {
        maxParallelSteps: parseInt(config['pilot_max_parallel_steps']) || this.getDefaultConfig().maxParallelSteps,
        defaultTimeout: parseInt(config['pilot_max_execution_time_ms']) || this.getDefaultConfig().defaultTimeout,
        enableCaching: config['pilot_enable_caching'] === true,
        continueOnError: config['pilot_continue_on_error'] === true,
        enableProgressTracking: config['pilot_enable_progress_tracking'] !== false, // Default true
        enableRealTimeUpdates: config['pilot_enable_real_time_updates'] === true,
        enableOptimizations: config['pilot_enable_optimizations'] !== false, // Default true
        cacheStepResults: config['pilot_cache_step_results'] === true,
        defaultRetryPolicy: this.getDefaultConfig().defaultRetryPolicy, // Use default for now
      };

      this.lastFetch = now;
      console.log('[PilotConfig] Configuration loaded from database:', this.configCache);
      return this.configCache;
    } catch (err) {
      console.error('[PilotConfig] Error loading config:', err);
      this.configCache = this.getDefaultConfig();
      this.lastFetch = now;
      return this.configCache;
    }
  }

  /**
   * Clear the configuration cache
   * Useful for testing or forcing a refresh
   */
  static clearCache(): void {
    this.configCache = null;
    this.lastFetch = 0;
  }
}
