// lib/utils/pricingConfig.ts
// Centralized pricing configuration utility
// CRITICAL: All token-to-credit conversions MUST use this to avoid inconsistencies

import { SupabaseClient } from '@supabase/supabase-js';

export interface PricingConfig {
  pilot_credit_cost_usd: number;      // Cost per Pilot Credit in USD (default: 0.00048)
  tokens_per_pilot_credit: number;    // LLM tokens per Pilot Credit (default: 10)
}

// In-memory cache to avoid repeated database queries
let cachedConfig: PricingConfig | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch pricing configuration from database
 * This is the SINGLE SOURCE OF TRUTH for pricing conversions
 *
 * @param supabase - Supabase client instance
 * @param forceRefresh - Force refresh cache (default: false)
 * @returns PricingConfig with pilot_credit_cost_usd and tokens_per_pilot_credit
 */
export async function getPricingConfig(
  supabase: SupabaseClient,
  forceRefresh: boolean = false
): Promise<PricingConfig> {
  // Return cached value if still fresh
  const now = Date.now();
  if (!forceRefresh && cachedConfig && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    // Fetch from database
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

    if (error) {
      console.error('❌ Error fetching pricing config:', error);
      // Return fallback values
      return getDefaultPricingConfig();
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No pricing config found in database, using defaults');
      return getDefaultPricingConfig();
    }

    // Parse config values
    const configMap = new Map(data.map(c => [c.config_key, c.config_value]));

    const config: PricingConfig = {
      pilot_credit_cost_usd: parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048'),
      tokens_per_pilot_credit: parseInt(configMap.get('tokens_per_pilot_credit') || '10')
    };

    // Validate values
    if (config.pilot_credit_cost_usd <= 0 || config.pilot_credit_cost_usd > 1) {
      console.warn(`⚠️ Invalid pilot_credit_cost_usd: ${config.pilot_credit_cost_usd}, using default`);
      config.pilot_credit_cost_usd = 0.00048;
    }

    if (config.tokens_per_pilot_credit <= 0 || config.tokens_per_pilot_credit > 1000) {
      console.warn(`⚠️ Invalid tokens_per_pilot_credit: ${config.tokens_per_pilot_credit}, using default`);
      config.tokens_per_pilot_credit = 10;
    }

    // Cache the result
    cachedConfig = config;
    cacheTimestamp = now;

    return config;
  } catch (err) {
    console.error('❌ Error in getPricingConfig:', err);
    return getDefaultPricingConfig();
  }
}

/**
 * Get default pricing config (fallback values)
 * These should only be used if database is unavailable
 */
export function getDefaultPricingConfig(): PricingConfig {
  return {
    pilot_credit_cost_usd: 0.00048,
    tokens_per_pilot_credit: 10
  };
}

/**
 * Convert LLM tokens to Pilot Credits
 * Uses database configuration for conversion rate
 *
 * @param tokens - Number of LLM tokens
 * @param supabase - Supabase client
 * @returns Number of Pilot Credits (rounded up)
 */
export async function tokensToPilotCredits(
  tokens: number,
  supabase: SupabaseClient
): Promise<number> {
  const config = await getPricingConfig(supabase);
  return Math.ceil(tokens / config.tokens_per_pilot_credit);
}

/**
 * Convert Pilot Credits to LLM tokens
 * Uses database configuration for conversion rate
 *
 * @param credits - Number of Pilot Credits
 * @param supabase - Supabase client
 * @returns Number of LLM tokens
 */
export async function pilotCreditsToTokens(
  credits: number,
  supabase: SupabaseClient
): Promise<number> {
  const config = await getPricingConfig(supabase);
  return credits * config.tokens_per_pilot_credit;
}

/**
 * Calculate USD cost for given Pilot Credits
 *
 * @param credits - Number of Pilot Credits
 * @param supabase - Supabase client
 * @returns Cost in USD
 */
export async function calculateCreditCost(
  credits: number,
  supabase: SupabaseClient
): Promise<number> {
  const config = await getPricingConfig(supabase);
  return credits * config.pilot_credit_cost_usd;
}

/**
 * Clear pricing config cache
 * Call this when pricing configuration is updated in admin panel
 */
export function clearPricingCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
  console.log('🔄 Pricing config cache cleared');
}
