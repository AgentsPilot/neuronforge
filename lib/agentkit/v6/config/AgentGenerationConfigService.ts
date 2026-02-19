/**
 * Agent Generation Configuration Service
 *
 * Provides cached access to agent generation (V6 pipeline) configuration
 * from system_settings_config table with smart caching to avoid performance issues.
 */

import { createClient } from '@supabase/supabase-js';

export interface PhaseModelConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  temperature: number;
}

export interface AgentGenerationConfig {
  requirements: PhaseModelConfig;
  semantic: PhaseModelConfig;
  formalization: PhaseModelConfig;
}

// In-memory cache
let configCache: AgentGenerationConfig | null = null;
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

// Default configuration (fallback if database is unavailable)
const DEFAULT_CONFIG: AgentGenerationConfig = {
  requirements: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.0
  },
  semantic: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.3
  },
  formalization: {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    temperature: 0.0
  }
};

/**
 * Load configuration from database
 */
async function loadConfigFromDatabase(): Promise<AgentGenerationConfig> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: settings, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .like('key', 'agent_generation_phase_%');

    if (error) {
      console.warn('[AgentGenerationConfig] Failed to load from database:', error);
      return DEFAULT_CONFIG;
    }

    if (!settings || settings.length === 0) {
      console.warn('[AgentGenerationConfig] No settings found, using defaults');
      return DEFAULT_CONFIG;
    }

    // Start with defaults
    const config: AgentGenerationConfig = { ...DEFAULT_CONFIG };

    // Override with database values
    settings.forEach((setting) => {
      const { key, value } = setting;

      // Parse JSON values (model names are stored as JSON strings)
      let parsedValue;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // If not JSON, use as-is (for numbers)
        parsedValue = isNaN(Number(value)) ? value : Number(value);
      }

      // Map database keys to config structure
      if (key === 'agent_generation_phase_requirements_provider') config.requirements.provider = parsedValue;
      if (key === 'agent_generation_phase_requirements_model') config.requirements.model = parsedValue;
      if (key === 'agent_generation_phase_requirements_temperature') config.requirements.temperature = Number(parsedValue);

      if (key === 'agent_generation_phase_semantic_provider') config.semantic.provider = parsedValue;
      if (key === 'agent_generation_phase_semantic_model') config.semantic.model = parsedValue;
      if (key === 'agent_generation_phase_semantic_temperature') config.semantic.temperature = Number(parsedValue);

      if (key === 'agent_generation_phase_formalization_provider') config.formalization.provider = parsedValue;
      if (key === 'agent_generation_phase_formalization_model') config.formalization.model = parsedValue;
      if (key === 'agent_generation_phase_formalization_temperature') config.formalization.temperature = Number(parsedValue);
    });

    console.log('[AgentGenerationConfig] ✓ Loaded from database');
    return config;
  } catch (error) {
    console.error('[AgentGenerationConfig] Error loading from database:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Get agent generation configuration with smart caching
 *
 * - Uses in-memory cache (5 minute TTL)
 * - Falls back to defaults if database unavailable
 * - Non-blocking - returns cached/default config immediately if cache is fresh
 */
export async function getAgentGenerationConfig(): Promise<AgentGenerationConfig> {
  const now = Date.now();
  const cacheAge = now - cacheLastUpdated;

  // Return cached config if still fresh
  if (configCache && cacheAge < CACHE_TTL_MS) {
    return configCache;
  }

  // Cache expired or empty - refresh from database
  configCache = await loadConfigFromDatabase();
  cacheLastUpdated = now;

  return configCache;
}

/**
 * Manually refresh configuration cache
 * Call this after updating configuration via admin UI
 */
export async function refreshConfigCache(): Promise<void> {
  configCache = await loadConfigFromDatabase();
  cacheLastUpdated = Date.now();
  console.log('[AgentGenerationConfig] Cache refreshed manually');
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): { hasCached: boolean; ageMs: number; ttlMs: number } {
  return {
    hasCached: configCache !== null,
    ageMs: Date.now() - cacheLastUpdated,
    ttlMs: CACHE_TTL_MS
  };
}

/**
 * Clear cache (for testing)
 */
export function clearCache(): void {
  configCache = null;
  cacheLastUpdated = 0;
}
