// lib/agentkit/agentkitClient.ts

import OpenAI from "openai";
import { createClient } from '@supabase/supabase-js';

// Singleton OpenAI client for AgentKit
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// AgentKit Configuration Defaults
const DEFAULT_AGENTKIT_CONFIG = {
  model: "gpt-4o", // Using gpt-4o for agent generation (supports structured outputs)
  temperature: 0.1,
  maxIterations: 10, // Maximum function call loops to prevent infinite execution
  timeout: 120000, // 2 minutes timeout for long-running operations
};

// Cached configuration
let cachedConfig: typeof DEFAULT_AGENTKIT_CONFIG | null = null;
let lastFetch: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load AgentKit configuration from database
 * Falls back to defaults if database is unavailable
 */
async function loadAgentkitConfig(): Promise<typeof DEFAULT_AGENTKIT_CONFIG> {
  // Return cached config if still valid
  const now = Date.now();
  if (cachedConfig && (now - lastFetch) < CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .in('key', [
        'agentkit_default_model',
        'agentkit_temperature',
        'agentkit_max_iterations',
        'agentkit_timeout_ms',
      ]);

    if (error || !data) {
      console.warn('[AgentKit] Failed to load config from database, using defaults:', error);
      cachedConfig = DEFAULT_AGENTKIT_CONFIG;
      lastFetch = now;
      return DEFAULT_AGENTKIT_CONFIG;
    }

    // Parse configuration
    const config: Record<string, any> = {};
    data.forEach((row) => {
      // Parse JSON values from database (stored as JSON strings)
      try {
        config[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      } catch {
        // If not JSON, use raw value
        config[row.key] = row.value;
      }
    });

    cachedConfig = {
      model: config['agentkit_default_model'] || DEFAULT_AGENTKIT_CONFIG.model,
      temperature: parseFloat(config['agentkit_temperature']) || DEFAULT_AGENTKIT_CONFIG.temperature,
      maxIterations: parseInt(config['agentkit_max_iterations']) || DEFAULT_AGENTKIT_CONFIG.maxIterations,
      timeout: parseInt(config['agentkit_timeout_ms']) || DEFAULT_AGENTKIT_CONFIG.timeout,
    };

    lastFetch = now;
    return cachedConfig;
  } catch (err) {
    console.error('[AgentKit] Error loading config:', err);
    cachedConfig = DEFAULT_AGENTKIT_CONFIG;
    lastFetch = now;
    return DEFAULT_AGENTKIT_CONFIG;
  }
}

/**
 * Get AgentKit configuration (async)
 * Use this when you can await the configuration
 */
export async function getAgentkitConfig(): Promise<typeof DEFAULT_AGENTKIT_CONFIG> {
  return loadAgentkitConfig();
}

/**
 * Get cached AgentKit configuration (synchronous)
 * Returns defaults if cache is empty
 * Triggers a background refresh if cache is stale
 */
export function getAgentkitConfigSync(): typeof DEFAULT_AGENTKIT_CONFIG {
  if (!cachedConfig || (Date.now() - lastFetch) > CACHE_TTL) {
    // Trigger background refresh
    loadAgentkitConfig().catch(console.error);
    // Return defaults or stale cache
    return cachedConfig || DEFAULT_AGENTKIT_CONFIG;
  }
  return cachedConfig;
}

// AgentKit Configuration (backward compatibility - use getAgentkitConfig() instead)
// This will be synchronous and use cached values
export const AGENTKIT_CONFIG = new Proxy(DEFAULT_AGENTKIT_CONFIG, {
  get(target, prop) {
    const config = getAgentkitConfigSync();
    return config[prop as keyof typeof DEFAULT_AGENTKIT_CONFIG];
  }
});
