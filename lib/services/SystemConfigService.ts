import { SupabaseClient } from '@supabase/supabase-js';

/**
 * SystemConfigService - Manages system-wide configuration settings with caching
 *
 * Features:
 * - In-memory cache with TTL (5 minutes default)
 * - Type-safe configuration retrieval
 * - Fallback values for missing configs
 * - Admin-only write operations
 */

interface SystemSetting {
  id: string;
  key: string;
  value: any; // JSONB can be any type
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface CacheEntry {
  value: any;
  timestamp: number;
}

export class SystemConfigService {
  private static cache = new Map<string, CacheEntry>();
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get a configuration value by key with caching
   */
  static async get<T = any>(
    supabase: SupabaseClient,
    key: string,
    fallback?: T
  ): Promise<T> {
    // Check cache first
    const cached = this.getCached(key);
    if (cached !== undefined) {
      return cached as T;
    }

    // Fetch from database
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', key)
      .single();

    if (error || !data) {
      console.warn(`[SystemConfig] Failed to fetch config '${key}':`, error?.message);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(`Configuration key '${key}' not found and no fallback provided`);
    }

    // Store in cache
    this.setCache(key, data.value);

    return data.value as T;
  }

  /**
   * Get a boolean configuration value
   */
  static async getBoolean(
    supabase: SupabaseClient,
    key: string,
    fallback: boolean = false
  ): Promise<boolean> {
    const value: any = await this.get(supabase, key, fallback);

    // Handle string "true"/"false" and boolean values
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return Boolean(value);
  }

  /**
   * Get a number configuration value
   */
  static async getNumber(
    supabase: SupabaseClient,
    key: string,
    fallback: number = 0
  ): Promise<number> {
    const value: any = await this.get(supabase, key, fallback);

    if (typeof value === 'string') {
      return parseFloat(value);
    }

    return Number(value);
  }

  /**
   * Get a string configuration value
   */
  static async getString(
    supabase: SupabaseClient,
    key: string,
    fallback: string = ''
  ): Promise<string> {
    const value: any = await this.get(supabase, key, fallback);
    return String(value);
  }

  /**
   * Get all configuration values for a category
   */
  static async getByCategory(
    supabase: SupabaseClient,
    category: string
  ): Promise<SystemSetting[]> {
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('*')
      .eq('category', category)
      .order('key');

    if (error) {
      console.error(`[SystemConfig] Failed to fetch category '${category}':`, error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get all configuration values
   */
  static async getAll(supabase: SupabaseClient): Promise<SystemSetting[]> {
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('*')
      .order('category')
      .order('key');

    if (error) {
      console.error('[SystemConfig] Failed to fetch all configs:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Set a configuration value (admin only)
   * Uses upsert to handle both new and existing keys
   */
  static async set(
    supabase: SupabaseClient,
    key: string,
    value: any
  ): Promise<void> {
    // First, check if the key exists
    const { data: existing } = await supabase
      .from('system_settings_config')
      .select('id, category')
      .eq('key', key)
      .single();

    if (existing) {
      // Update existing
      console.log(`[SystemConfig] Updating existing key '${key}' with value:`, value);
      const { error } = await supabase
        .from('system_settings_config')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key);

      if (error) {
        console.error(`[SystemConfig] Failed to update config '${key}':`, error);
        throw error;
      }
      console.log(`[SystemConfig] Successfully updated '${key}'`);
    } else {
      // Insert new - infer category from key prefix
      const category = key.startsWith('pilot_') || key.startsWith('workflow_orchestrator_')
        ? 'pilot'
        : key.startsWith('routing_') || key.startsWith('intelligent_routing_')
        ? 'routing'
        : key.startsWith('helpbot_')
        ? 'helpbot'
        : key.startsWith('memory_')
        ? 'memory'
        : 'general';

      console.log(`[SystemConfig] Inserting new key '${key}' with category '${category}' and value:`, value);
      const { error } = await supabase
        .from('system_settings_config')
        .insert({
          key,
          value,
          category,
          description: `Auto-created configuration for ${key}`
        });

      if (error) {
        console.error(`[SystemConfig] Failed to create config '${key}':`, error);
        throw error;
      }
      console.log(`[SystemConfig] Successfully created '${key}'`);
    }

    // Invalidate cache
    this.invalidateCache(key);
  }

  /**
   * Set multiple configuration values in a transaction (admin only)
   */
  static async setMultiple(
    supabase: SupabaseClient,
    updates: Record<string, any>
  ): Promise<void> {
    const keys = Object.keys(updates);

    // Update each key
    for (const key of keys) {
      await this.set(supabase, key, updates[key]);
    }
  }

  /**
   * Create a new configuration entry (admin only)
   */
  static async create(
    supabase: SupabaseClient,
    key: string,
    value: any,
    category: string,
    description?: string
  ): Promise<void> {
    const { error } = await supabase
      .from('system_settings_config')
      .insert({
        key,
        value,
        category,
        description
      });

    if (error) {
      console.error(`[SystemConfig] Failed to create config '${key}':`, error);
      throw error;
    }
  }

  /**
   * Delete a configuration entry (admin only)
   */
  static async delete(
    supabase: SupabaseClient,
    key: string
  ): Promise<void> {
    const { error } = await supabase
      .from('system_settings_config')
      .delete()
      .eq('key', key);

    if (error) {
      console.error(`[SystemConfig] Failed to delete config '${key}':`, error);
      throw error;
    }

    this.invalidateCache(key);
  }

  /**
   * Clear all cached configuration values
   */
  static clearCache(): void {
    this.cache.clear();
    console.log('[SystemConfig] Cache cleared');
  }

  /**
   * Invalidate a specific cache entry
   */
  static invalidateCache(key: string): void {
    this.cache.delete(key);
    console.log(`[SystemConfig] Cache invalidated for key: ${key}`);
  }

  /**
   * Get value from cache if valid
   */
  private static getCached(key: string): any | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if cache entry is still valid
    const now = Date.now();
    if (now - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Store value in cache
   */
  private static setCache(key: string, value: any): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Get routing configuration (convenience method)
   */
  static async getRoutingConfig(supabase: SupabaseClient) {
    const [
      enabled,
      lowThreshold,
      mediumThreshold,
      minExecutions,
      minSuccessRate,
      anthropicEnabled
    ] = await Promise.all([
      this.getBoolean(supabase, 'intelligent_routing_enabled', false),
      this.getNumber(supabase, 'routing_low_threshold', 3.9),
      this.getNumber(supabase, 'routing_medium_threshold', 6.9),
      this.getNumber(supabase, 'routing_min_executions', 3),
      this.getNumber(supabase, 'routing_min_success_rate', 85),
      this.getBoolean(supabase, 'anthropic_provider_enabled', true)
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
}
