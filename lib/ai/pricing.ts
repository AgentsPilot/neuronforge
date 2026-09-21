// lib/ai/pricing.ts
// Centralized AI model pricing service.
//
// Reads the `ai_model_pricing` table through `AiModelPricingRepository`
// (CLAUDE.md mandatory rule 1 — all DB access goes through the repository
// layer) and caches it in this module for an hour. Every credit charge in the
// product is computed from these numbers, so the cache is on the hot path of
// every billed LLM call: `calculateCostSync` is called from inside the
// providers' tracking.

import { createLogger } from '@/lib/logger';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';
import type { AiModelPricing } from '@/lib/repositories/types';

const logger = createLogger({ module: 'AiPricing' });

interface PricingInfo {
  input: number;
  output: number;
}

// In-memory cache to avoid repeated database queries
let pricingCache: Map<string, PricingInfo> = new Map();
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// Fallback pricing if database is unavailable
// Prices are per 1000 tokens (cost_per_million / 1000)
const FALLBACK_PRICING = {
  'openai': {
    // GPT-5.4 Series (March 2026 — Latest)
    'gpt-5.4': { input: 0.0025, output: 0.015 },
    'gpt-5.4-mini': { input: 0.00075, output: 0.0045 },
    'gpt-5.4-nano': { input: 0.0002, output: 0.00125 },
    'gpt-5.4-pro': { input: 0.03, output: 0.18 },
    // GPT-5.2 Series
    'gpt-5.2': { input: 0.00175, output: 0.014 },
    // GPT-5.1 Series
    'gpt-5.1': { input: 0.00125, output: 0.01 },
    // GPT-5 Series
    'gpt-5': { input: 0.00125, output: 0.01 },
    'gpt-5-mini': { input: 0.00025, output: 0.002 },
    'gpt-5-nano': { input: 0.00005, output: 0.0004 },
    // GPT-4.1 Series
    'gpt-4.1': { input: 0.002, output: 0.008 },
    'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
    'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
    // o-Series (Reasoning)
    'o3': { input: 0.002, output: 0.008 },
    'o3-pro': { input: 0.02, output: 0.08 },
    'o4-mini': { input: 0.0011, output: 0.0044 },
    // GPT-4o Series (Legacy)
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    // Embeddings. Priced on input only — there is no completion side, so
    // `output` is 0 and the output-token term contributes nothing.
    'text-embedding-3-small': { input: 0.00002, output: 0 },
    'text-embedding-3-large': { input: 0.00013, output: 0 },
    'text-embedding-ada-002': { input: 0.0001, output: 0 },
    // Legacy
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
  'anthropic': {
    // Claude 4.6 Series (Feb 2026 — Latest)
    'claude-opus-4-6': { input: 0.005, output: 0.025 },
    'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
    // Claude 4.5 Series
    'claude-opus-4-5-20251101': { input: 0.005, output: 0.025 },
    'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
    'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
    // Claude 4.1 Series
    'claude-opus-4-1-20250805': { input: 0.015, output: 0.075 },
    // Claude 4 Series
    'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
    'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
    // Claude 3.5 Series
    'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 },
    // Claude 3 Series (Deprecated)
    'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
    'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
    'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  },
  'google': {
    'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    'gemini-1.0-pro': { input: 0.0005, output: 0.0015 },
  },
  'kimi': {
    // Kimi K2.5 Series (Jan 2026 — Latest)
    'kimi-k2.5': { input: 0.0006, output: 0.003 },
    // Kimi K2 Series
    'kimi-k2-0905-preview': { input: 0.0006, output: 0.0025 },
    'kimi-k2-0711-preview': { input: 0.0006, output: 0.0025 },
    'kimi-k2-turbo-preview': { input: 0.00115, output: 0.008 },
    'kimi-k2-thinking': { input: 0.0006, output: 0.0025 },
    'kimi-k2-thinking-turbo': { input: 0.00115, output: 0.008 },
  }
} as const;

/**
 * Models that are legitimately priced on INPUT ONLY, so an `output` cost of 0
 * is correct rather than a mistake (see the embedding rows above: there is no
 * completion side to charge for).
 *
 * Used only to stop the admin screen's zero-price alert from crying wolf on
 * such a row (D-14, QA D-Q9). It deliberately does NOT change what anything is
 * charged: `calculateCost`, `calculateCostSync` and `hasPricing` are untouched,
 * and Business OS Layer 2 keeps its own stricter "> 0 on both sides" rule,
 * which embeddings never reach because they are excluded from those settings.
 */
export function isInputOnlyPricedModel(provider: string, modelName: string): boolean {
  return provider === 'openai' && modelName.startsWith('text-embedding-');
}

/**
 * Load pricing data from the database and populate the cache.
 *
 * Never throws: a failure leaves the previous cache in place (or empty, which
 * makes every lookup fall back to FALLBACK_PRICING below), because a pricing
 * read must never break a call that is already running.
 */
async function loadPricingFromDatabase(): Promise<void> {
  try {
    const { data, error } = await aiModelPricingRepository.listActive();

    if (error || !data) {
      logger.error({ err: error }, 'Failed to load pricing from the database; keeping the current cache');
      return;
    }

    if (data.length === 0) {
      // The query SUCCEEDED and matched nothing. Since 2026-09-20
      // `ai_model_pricing` is admin-SELECT-only under RLS, so a non-service-role
      // reader would also land here rather than on an error (D-17). Every reader
      // today is service-role, so this really does mean "no active rows".
      logger.warn(
        { activeRows: 0 },
        'No active rows in ai_model_pricing; falling back to the in-code price table'
      );
      return;
    }

    // Rows arrive newest-first (`listActive` orders by effective_date DESC).
    // The unique constraint allows several effective_date rows per model, so
    // the FIRST row per provider:model is the current price and every later
    // row is history. The previous implementation overwrote on every row, which
    // left the OLDEST price in the cache for any model with more than one row —
    // exactly the duplicates the admin pricing sync used to create.
    const next = new Map<string, PricingInfo>();
    let superseded = 0;

    for (const row of data as AiModelPricing[]) {
      const key = `${row.provider}:${row.model_name}`;
      if (next.has(key)) {
        superseded += 1;
        continue;
      }
      // Stored as cost per single token; the cache holds cost per 1000 tokens.
      // `numeric` columns come back as strings on some PostgREST paths and as
      // numbers on others, so both are normalised through Number().
      next.set(key, {
        input: Number(row.input_cost_per_token) * 1000,
        output: Number(row.output_cost_per_token) * 1000,
      });
    }

    pricingCache = next;
    cacheLastUpdated = Date.now();
    logger.info(
      { entries: pricingCache.size, rows: data.length, superseded },
      'Loaded model pricing from the database'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error loading pricing from the database');
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
      logger.debug({ provider, model: modelName }, 'Using the in-code fallback price');
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
  const pricing = await getPricingInternal(provider, modelName);

  if (!pricing) {
    logger.warn({ provider, model: modelName }, 'No pricing found; recording $0 for this call');
    return 0;
  }

  // Pricing is stored as cost per 1000 tokens
  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  const totalCost = inputCost + outputCost;

  logger.debug(
    { provider, model: modelName, inputTokens, outputTokens, inputCost, outputCost, totalCost },
    'Calculated call cost'
  );

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
    logger.warn({ provider, model: modelName }, 'No pricing found; recording $0 for this call');
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
