// lib/repositories/SystemConfigRepository.ts
// Repository for managing system_settings_config table

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type { SystemSettingsConfig, AgentRepositoryResult } from './types';

/** The crops an owner can ask a generated image for. */
export type ImageGenerationAspect = 'wide' | 'portrait' | 'square';

/** The `system_settings_config` keys image generation reads, all in one round trip. */
export const IMAGE_GENERATION_CONFIG_KEYS = {
  model: 'image_generation_model',
  sizes: 'image_generation_sizes',
  quality: 'image_generation_quality',
  pricesUsd: 'image_generation_prices_usd',
} as const;

export interface ImageGenerationConfig {
  model: string;
  /** Aspect → the size string the provider is asked for. */
  sizes: Record<ImageGenerationAspect, string>;
  /**
   * Sent on every request. `auto` (the default) lets the provider choose; the
   * price is then keyed on the quality the provider REPORTS it used.
   */
  quality: string;
  /** `"<model>:<size>:<reported quality>"` → USD per image. Empty when nothing is configured. */
  pricesUsd: Record<string, number>;
}

/**
 * Documented in-code defaults, overridden by configuration (Layer 1.5 FR-10).
 *
 * - model: the literal GeneratedImageService used before this was configurable.
 * - sizes: the aspect → size map it used, unchanged.
 * - quality: 'auto' — what the provider applied before Layer 1.5, when the call
 *   sent no quality at all. Kept by user decision (CR-1, option C, 2026-09-18),
 *   so images look and cost exactly as they did. `auto` is priced AFTER the
 *   call, by the quality the provider reports it used; configure
 *   `image_generation_quality` to pin `low`, `medium` or `high` instead.
 * - pricesUsd: empty. The documented per-image fallback prices are
 *   IMAGE_FALLBACK_PRICING below, applied only when configuration has no entry.
 */
export const IMAGE_GENERATION_CONFIG_DEFAULTS: Readonly<ImageGenerationConfig> = Object.freeze({
  model: 'gpt-image-1',
  sizes: Object.freeze({ wide: '1536x1024', portrait: '1024x1536', square: '1024x1024' }),
  quality: 'auto',
  pricesUsd: Object.freeze({}),
});

/**
 * Documented fallback per-image prices in USD, keyed `model:size:quality`,
 * where quality is the one the provider reports it used (never `auto`).
 *
 * Provenance: gpt-image-1's per-image price table (low / medium / high at
 * 1024x1024 and at 1024x1536 / 1536x1024). On 2026-09-18 all nine values were
 * confirmed against OpenAI's own model page
 * (developers.openai.com/api/docs/models/gpt-image-1, "Image generation — Per
 * image"). Re-check that page when prices change. These are the
 * DEFAULT, not the rule: `image_generation_prices_usd` in configuration
 * overrides any entry, and is where a price change belongs. This mirrors
 * `FALLBACK_PRICING` in lib/ai/pricing.ts for token models. Resolved by
 * `resolveImagePrice` in GeneratedImageService; kept here, beside the other
 * documented defaults, so no model name is written in the service.
 */
export const IMAGE_FALLBACK_PRICING: Readonly<Record<string, number>> = Object.freeze({
  'gpt-image-1:1024x1024:low': 0.011,
  'gpt-image-1:1024x1536:low': 0.016,
  'gpt-image-1:1536x1024:low': 0.016,
  'gpt-image-1:1024x1024:medium': 0.042,
  'gpt-image-1:1024x1536:medium': 0.063,
  'gpt-image-1:1536x1024:medium': 0.063,
  'gpt-image-1:1024x1024:high': 0.167,
  'gpt-image-1:1024x1536:high': 0.25,
  'gpt-image-1:1536x1024:high': 0.25,
});

/** A JSONB value may arrive as the object itself or as a JSON string. */
function asObject(value: unknown): Record<string, unknown> | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

/** A JSONB string value may arrive bare or JSON-quoted. */
function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      text = typeof parsed === 'string' ? parsed.trim() : '';
    } catch {
      return null;
    }
  }
  return text.length > 0 ? text : null;
}

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
      this.getString('agent_generation_ai_model', 'gpt-5.4')
    ]);

    return { provider, model };
  }

  /**
   * Get agent execution AI processing configuration
   * Fetches AI provider and model settings for ai_processing steps
   * (classify, generate, extract, summarize via callLLMDirect)
   */
  async getAgentExecutionAIProcessingConfig(): Promise<{
    provider: string;
    model: string;
  }> {
    const [provider, model] = await Promise.all([
      this.getString('agent_execution_ai_processing_provider', 'anthropic'),
      this.getString('agent_execution_ai_processing_model', 'claude-sonnet-4-6')
    ]);

    return { provider, model };
  }

  /**
   * Image generation configuration: model, sizes, quality and per-image prices,
   * in ONE read (`getByKeys`, a single `.in('key', …)` select).
   *
   * Never throws. A failed read, a missing key or a malformed value falls back
   * to the documented default for THAT key only, with a warning — one bad row
   * must not leave images both unsized and unpriced. Logs key names and counts,
   * never configuration values.
   *
   * The price key lives here while no per-image price table exists; it moves
   * if one arrives with the credit-deduction layer.
   */
  async getImageGenerationConfig(): Promise<ImageGenerationConfig> {
    const methodLogger = this.logger.child({ method: 'getImageGenerationConfig' });
    const defaults = IMAGE_GENERATION_CONFIG_DEFAULTS;
    const keys = Object.values(IMAGE_GENERATION_CONFIG_KEYS);

    const { data, error } = await this.getByKeys(keys);
    if (error || !data) {
      methodLogger.warn('Image generation config unreadable; using the documented defaults');
      return { ...defaults, sizes: { ...defaults.sizes }, pricesUsd: {} };
    }

    const byKey = new Map(data.map((row) => [row.key, row.value as unknown]));
    const invalid: string[] = [];

    const readText = (key: string, fallback: string): string => {
      if (!byKey.has(key)) return fallback;
      const text = asText(byKey.get(key));
      if (text === null) invalid.push(key);
      return text ?? fallback;
    };

    const model = readText(IMAGE_GENERATION_CONFIG_KEYS.model, defaults.model);
    const quality = readText(IMAGE_GENERATION_CONFIG_KEYS.quality, defaults.quality);

    const sizes = { ...defaults.sizes };
    if (byKey.has(IMAGE_GENERATION_CONFIG_KEYS.sizes)) {
      const configured = asObject(byKey.get(IMAGE_GENERATION_CONFIG_KEYS.sizes));
      if (!configured) invalid.push(IMAGE_GENERATION_CONFIG_KEYS.sizes);
      for (const aspect of Object.keys(sizes) as ImageGenerationAspect[]) {
        const size = asText(configured?.[aspect]);
        if (size) sizes[aspect] = size;
      }
    }

    const pricesUsd: Record<string, number> = {};
    if (byKey.has(IMAGE_GENERATION_CONFIG_KEYS.pricesUsd)) {
      const configured = asObject(byKey.get(IMAGE_GENERATION_CONFIG_KEYS.pricesUsd));
      if (!configured) invalid.push(IMAGE_GENERATION_CONFIG_KEYS.pricesUsd);
      let dropped = 0;
      for (const [priceKey, raw] of Object.entries(configured ?? {})) {
        const usd = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (Number.isFinite(usd) && usd > 0) pricesUsd[priceKey] = usd;
        else dropped++;
      }
      if (dropped > 0) methodLogger.warn({ dropped }, 'Ignored image prices that are not positive numbers');
    }

    if (invalid.length > 0) {
      methodLogger.warn({ keys: invalid }, 'Malformed image generation config; using the default for those keys');
    }
    methodLogger.debug(
      { configuredKeys: byKey.size, priceEntries: Object.keys(pricesUsd).length },
      'Image generation config read'
    );

    return { model, sizes, quality, pricesUsd };
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