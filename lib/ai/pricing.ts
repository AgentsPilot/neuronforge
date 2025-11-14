// lib/ai/pricing.ts
// Centralized AI model pricing service
// Fetches pricing from Supabase ai_model_pricing table with in-memory caching

import { createClient } from '@supabase/supabase-js';

/**
 * Database schema for ai_model_pricing table:
 * - id: UUID
 * - provider: string (openai, anthropic, google, kimi)
 * - model_name: string (gpt-4o, claude-3-sonnet, kimi-k2-0905-preview, etc.)
 * - input_cost_per_token: decimal (cost per single token, not per 1000)
 * - output_cost_per_token: decimal (cost per single token, not per 1000)
 * - effective_date: date
 * - retired_date: date (nullable)
 * - created_at: timestamp
 */

interface ModelPricingRow {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: string; // decimal as string from DB
  output_cost_per_token: string; // decimal as string from DB
  effective_date: string;
  retired_date: string | null;
  created_at: string;
}

interface PricingInfo {
  input: number;
  output: number;
}

// In-memory cache to avoid repeated database queries
let pricingCache: Map<string, PricingInfo> = new Map();
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// Fallback pricing if database is unavailable
const FALLBACK_PRICING = {
  'openai': {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
  'anthropic': {
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku-20241022': { input: 0.001, output: 0.005 },
    'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
    'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
    'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    'claude-3-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-opus': { input: 0.015, output: 0.075 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  },
  'google': {
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    'gemini-1.0-pro': { input: 0.0005, output: 0.0015 },
  },
  'kimi': {
    // Kimi K2 Base Models - Highly competitive pricing (as of 2025)
    'kimi-k2-0711-preview': { input: 0.00015, output: 0.0025 },  // $0.15 per M input, $2.50 per M output
    'kimi-k2-0905-preview': { input: 0.00015, output: 0.0025 },  // Same pricing as 0711
    // Kimi K2 Thinking Model - Enhanced reasoning capabilities
    'kimi-k2-thinking': { input: 0.0006, output: 0.0025 },        // $0.60 per M input, $2.50 per M output
  }
} as const;

/**
 * Load pricing data from Supabase and populate cache
 */
async function loadPricingFromDatabase(): Promise<void> {
  try {
    // Use service role client to query ai_model_pricing table
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('ai_model_pricing')
      .select('*')
      .is('retired_date', null) // Only get active pricing
      .order('effective_date', { ascending: false });

    if (error) {
      console.error('❌ Failed to load pricing from database:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ No pricing data found in ai_model_pricing table');
      return;
    }

    // Clear and repopulate cache
    pricingCache.clear();

    (data as ModelPricingRow[]).forEach((row) => {
      const key = `${row.provider}:${row.model_name}`;
      // Convert per-token costs from DB (stored as cost per single token)
      // to per-1000-tokens format for consistency with existing code
      pricingCache.set(key, {
        input: parseFloat(row.input_cost_per_token) * 1000,
        output: parseFloat(row.output_cost_per_token) * 1000,
      });
    });

    cacheLastUpdated = Date.now();
    console.log(`✅ Loaded ${pricingCache.size} model pricing entries from database`);
  } catch (error) {
    console.error('❌ Error loading pricing from database:', error);
  }
}

/**
 * Get pricing from cache or database, with fallback to hardcoded values
 */
async function getPricingInternal(provider: string, modelName: string): Promise<PricingInfo | null> {
  // Check if cache needs refresh
  const cacheAge = Date.now() - cacheLastUpdated;
  if (cacheAge > CACHE_TTL_MS || pricingCache.size === 0) {
    await loadPricingFromDatabase();
  }

  // Try cache first
  const key = `${provider}:${modelName}`;
  const cached = pricingCache.get(key);
  if (cached) {
    return cached;
  }

  // Try fallback pricing
  const providerFallback = FALLBACK_PRICING[provider as keyof typeof FALLBACK_PRICING];
  if (providerFallback) {
    const modelFallback = providerFallback[modelName as keyof typeof providerFallback] as PricingInfo | undefined;
    if (modelFallback) {
      console.log(`ℹ️ Using fallback pricing for ${provider}/${modelName}`);
      return modelFallback;
    }
  }

  return null;
}

/**
 * Calculate the cost of an LLM API call based on token usage
 *
 * @param provider - The AI provider (openai, anthropic, google)
 * @param modelName - The specific model name
 * @param inputTokens - Number of input/prompt tokens
 * @param outputTokens - Number of output/completion tokens
 * @returns Cost in USD, or 0 if pricing not found
 */
export async function calculateCost(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): Promise<number> {
  console.log('💰 Calculating cost for:', { provider, modelName, inputTokens, outputTokens });

  const pricing = await getPricingInternal(provider, modelName);

  if (!pricing) {
    console.warn(`❌ No pricing found for ${provider}/${modelName}`);
    return 0;
  }

  // Pricing is stored as cost per 1000 tokens
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  const totalCost = inputCost + outputCost;

  console.log('💰 Cost breakdown:', {
    inputCost: inputCost.toFixed(6),
    outputCost: outputCost.toFixed(6),
    totalCost: totalCost.toFixed(6)
  });

  return totalCost;
}

/**
 * Synchronous version of calculateCost for when pricing is already cached
 * Falls back to database pricing if not in cache
 */
export function calculateCostSync(
  provider: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number
): number {
  const key = `${provider}:${modelName}`;
  let pricing = pricingCache.get(key);

  // If not in cache, try fallback
  if (!pricing) {
    const providerFallback = FALLBACK_PRICING[provider as keyof typeof FALLBACK_PRICING];
    if (providerFallback) {
      pricing = providerFallback[modelName as keyof typeof providerFallback] as PricingInfo | undefined;
    }
  }

  if (!pricing) {
    console.warn(`❌ No pricing found for ${provider}/${modelName}`);
    return 0;
  }

  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Get pricing information for a specific model
 *
 * @param provider - The AI provider
 * @param modelName - The specific model name
 * @returns Pricing info or null if not found
 */
export async function getPricing(provider: string, modelName: string): Promise<PricingInfo | null> {
  return getPricingInternal(provider, modelName);
}

/**
 * Check if pricing exists for a given provider and model
 *
 * @param provider - The AI provider
 * @param modelName - The specific model name
 * @returns true if pricing exists, false otherwise
 */
export async function hasPricing(provider: string, modelName: string): Promise<boolean> {
  const pricing = await getPricingInternal(provider, modelName);
  return pricing !== null;
}

/**
 * Manually refresh pricing cache from database
 */
export async function refreshPricingCache(): Promise<void> {
  await loadPricingFromDatabase();
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): { size: number; ageMs: number; ttlMs: number } {
  return {
    size: pricingCache.size,
    ageMs: Date.now() - cacheLastUpdated,
    ttlMs: CACHE_TTL_MS,
  };
}
