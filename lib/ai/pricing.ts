// lib/ai/pricing.ts
// Centralized AI model pricing service.
//
// Reads the `ai_model_pricing` table through `AiModelPricingRepository`
// (CLAUDE.md mandatory rule 1 — all DB access goes through the repository
// layer) and caches it in this module for an hour. Every credit charge in the
// product is computed from these numbers, so the cache is on the hot path of
// every billed LLM call: `calculateCostSync` is called from inside the
// providers' tracking.
//
// AI model price review slice 7 (R-1: the database is authoritative):
//   - a row's `cached_input_cost_per_token`, when above 0, is the rate for
//     input served from the provider's prompt cache
//     (`calculateCostWithCachedSync`); otherwise the provider's derived rule
//     applies, unchanged;
//   - one load at a time (single-flight). `refreshPricingCache()` never joins a
//     load already in flight: it starts a new read after it, and a generation
//     counter stops an older read from overwriting a newer one (SA C-1);
//   - `warmPricingCache()` lets the Business OS settings path load the rows
//     before a call is priced (RC7-5). The sync lookup only reads the warm
//     cache, so an instance nobody warmed charges from the in-code table;
//   - `refreshPricingCache()` also marks the image prices stale
//     (`lib/ai/imagePricing.ts`), without reading them (RC7-4).

import { invalidateImagePrices } from '@/lib/ai/imagePricing';
import { PRICING_CACHE_TTL_MS } from '@/lib/ai/pricingCacheTtl';
import { createLogger } from '@/lib/logger';
import { aiModelPricingRepository } from '@/lib/repositories/AiModelPricingRepository';
import type { AiModelPricing } from '@/lib/repositories/types';

const logger = createLogger({ module: 'AiPricing' });

interface PricingInfo {
  input: number;
  output: number;
  /**
   * Per 1000 cached input tokens, from a database row whose
   * `cached_input_cost_per_token` is above 0. Absent otherwise, and always
   * absent for the in-code table: the provider's derived rule then applies.
   */
  cachedInput?: number;
}

/** The shape of one price row, per 1000 tokens. Exported as a type only (for `inCodeTokenPrices`). */
export type TokenPriceInfo = Readonly<PricingInfo>;

/**
 * Whether a model has a usable price (deduction layer slice 2, SQ-13 (1)).
 *
 * `priced` means a row exists AND is > 0 on the input side, and > 0 on the
 * output side unless the model is input-only (embeddings). A row at 0 is not a
 * price: it is exactly the silent $0 the deduction layer must not charge on.
 */
export type PriceStatus = 'priced' | 'unpriced';

// In-memory cache to avoid repeated database queries
let pricingCache: Map<string, PricingInfo> = new Map();
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = PRICING_CACHE_TTL_MS; // 1 hour, shared with the image price cache

/*
 * Single-flight with an ordered refresh (slice 7, SA C-1).
 *  - `inFlightLoad` is the read every lookup and the warm join.
 *  - Every read gets a generation number when it STARTS. A read applies its rows
 *    only if no newer read has applied already, so an older read finishing late
 *    can never overwrite a newer one.
 *  - `refreshPricingCache()` never joins: it starts a new read chained after the
 *    one in flight (which may have begun before an apply committed), and that new
 *    read becomes the one everybody joins.
 */
let startedGeneration = 0;
let appliedGeneration = 0;
let inFlightLoad: Promise<void> | null = null;

// Fallback pricing if database is unavailable
// Prices are per 1000 tokens (cost_per_million / 1000)
//
// NON-AUTHORITATIVE (AI model price review R-1): the active `ai_model_pricing`
// rows are the prices; this table is the OUTAGE FALLBACK for a model with no row,
// and what a cold instance charges until its rows load. It is also the source of
// the CONSERVATIVE rates (`chargePricing.ts`, finding 3), so NEVER SHRINK IT:
// removing or lowering an entry silently lowers those rates. An approved price
// that differs from an entry here is updated by PR. It carries no cached-input
// rate on purpose: without a row, OpenAI's derived rule applies.
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
async function loadPricingFromDatabase(generation: number): Promise<void> {
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
    // The partial unique index on active rows (provider, model_name,
    // effective_date WHERE retired_date IS NULL) allows several active
    // effective_date rows per model, so the FIRST row per provider:model is
    // the current price and every later row is history. The previous
    // implementation overwrote on every row, which left the OLDEST price in the
    // cache for any model with more than one row — exactly the duplicates the
    // admin pricing sync used to create.
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
      const info: PricingInfo = {
        input: Number(row.input_cost_per_token) * 1000,
        output: Number(row.output_cost_per_token) * 1000,
      };
      // NULL, 0, NaN and negatives are "not set" (slice 7, O-5): a 0 would make
      // cached tokens free, and the derived rule charges more, never less.
      const cached = Number(row.cached_input_cost_per_token ?? NaN);
      if (Number.isFinite(cached) && cached > 0) info.cachedInput = cached * 1000;
      next.set(key, info);
    }

    if (generation < appliedGeneration) {
      // A newer read has already landed; these rows are older (SA C-1).
      // BACKSTOP (SA F-4): reads are chained (`startLoad` waits for the read in
      // flight), so they never overlap and this cannot fire today. Kept as
      // defence in depth in case a future change starts reads in parallel.
      logger.debug({ generation, appliedGeneration }, 'Discarded an older pricing read');
      return;
    }
    appliedGeneration = generation;
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

/** Start a read after `after` settles (C-1), and make it the shared one. Never rejects. */
function startLoad(after: Promise<void> | null): Promise<void> {
  startedGeneration += 1;
  const generation = startedGeneration;
  const run = (after ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => loadPricingFromDatabase(generation));
  const pending: Promise<void> = run.finally(() => {
    if (inFlightLoad === pending) inFlightLoad = null;
  });
  inFlightLoad = pending;
  return pending;
}

/** The read in flight, or a new one. What lookups and the warm use. */
function sharedLoad(): Promise<void> {
  return inFlightLoad ?? startLoad(null);
}

/** The rule every async reader uses: reload when older than the TTL, or when empty. */
function isCacheStale(): boolean {
  return Date.now() - cacheLastUpdated > CACHE_TTL_MS || pricingCache.size === 0;
}

/**
 * Get pricing from cache or database, with fallback to hardcoded values
 */
async function getPricingInternal(provider: string, modelName: string): Promise<PricingInfo | null> {
  if (isCacheStale()) {
    await sharedLoad();
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
 * The synchronous price lookup: the warm cache, then the in-code table.
 *
 * Extracted verbatim from `calculateCostSync` (deduction layer slice 2, SA
 * Q-2) so that the cost and `getPriceStatusSync` can never read different
 * rows. Logs nothing; the caller decides what a miss means.
 */
function lookupPricingSync(provider: string, modelName: string): PricingInfo | undefined {
  const key = `${provider}:${modelName}`;
  let pricing = pricingCache.get(key);

  // If not in cache, try fallback
  if (!pricing) {
    const providerFallback = FALLBACK_PRICING[provider as keyof typeof FALLBACK_PRICING];
    if (providerFallback) {
      pricing = providerFallback[modelName as keyof typeof providerFallback] as PricingInfo | undefined;
    }
  }

  return pricing;
}

/**
 * Whether `calculateCostSync` would price this model with a usable, non-zero
 * price (deduction layer slice 2). Read-only and SILENT: the missing-price warn
 * still fires once per call, from `calculateCostSync`.
 *
 * TOTAL by contract (SA C-2): it runs inside `callWithTracking`'s `try` (via a
 * provider's `extractMetrics`), where a throw would record a call the provider
 * already billed as a $0 failure. Any non-string or empty input is `unpriced`.
 */
export function getPriceStatusSync(provider: string, modelName: string): PriceStatus {
  if (typeof provider !== 'string' || typeof modelName !== 'string' || provider === '' || modelName === '') {
    return 'unpriced';
  }
  const pricing = lookupPricingSync(provider, modelName);
  if (!pricing) return 'unpriced';
  // D-0 C-1: a row at 0 is not a price. `> 0` is false for NaN too.
  const usable =
    pricing.input > 0 && (pricing.output > 0 || isInputOnlyPricedModel(provider, modelName));
  return usable ? 'priced' : 'unpriced';
}

/**
 * A deep-frozen COPY of the in-code token price table (deduction layer slice
 * 2, SQ-9 and SA S-5): the source of Business OS's conservative fallback rates
 * and of its price-coverage test. A copy, so no caller can change what
 * `calculateCostSync` reads; frozen, because `as const` on the table is
 * type-only. This module gains a read accessor and no billing policy.
 */
export function inCodeTokenPrices(): Readonly<Record<string, Readonly<Record<string, TokenPriceInfo>>>> {
  const copy: Record<string, Readonly<Record<string, TokenPriceInfo>>> = {};
  for (const [provider, entries] of Object.entries(FALLBACK_PRICING)) {
    const models: Record<string, TokenPriceInfo> = {};
    for (const [model, price] of Object.entries(entries as Record<string, PricingInfo>)) {
      models[model] = Object.freeze({ input: price.input, output: price.output });
    }
    copy[provider] = Object.freeze(models);
  }
  return Object.freeze(copy);
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
  const pricing = lookupPricingSync(provider, modelName);

  if (!pricing) {
    logger.warn({ provider, model: modelName }, 'No pricing found; recording $0 for this call');
    return 0;
  }

  const inputCost = (inputTokens / 1000) * pricing.input;
  const outputCost = (outputTokens / 1000) * pricing.output;
  return inputCost + outputCost;
}

/** The token counts of one call whose input may have been partly served from the provider's cache. */
export interface CachedInputUsage {
  promptTokens: number;
  /** Already clamped by the caller to `0..promptTokens`. */
  cachedTokens: number;
  completionTokens: number;
  /**
   * The provider's own rule for cached tokens, as a count of full-price input
   * tokens (OpenAI: half of `cachedTokens`, rounded). Used only when the row
   * has no cached-input rate.
   */
  derivedCachedTokens: number;
}

/**
 * The cost of a call with cached input (slice 7, O-2), from ONE lookup, so the
 * input, output and cached rates always come from the same row.
 *
 * - The row has a cached-input rate (database, above 0): uncached input at the
 *   input rate, cached input at the cached rate, output at the output rate.
 * - Otherwise: EXACTLY today's expression, `calculateCostSync` on
 *   `prompt - cached + derived` input tokens. Same operations in the same
 *   order, so the result is bit-identical, and a missing price warns once, from
 *   `calculateCostSync`.
 */
export function calculateCostWithCachedSync(provider: string, modelName: string, usage: CachedInputUsage): number {
  const pricing = lookupPricingSync(provider, modelName);
  if (pricing && pricing.cachedInput !== undefined) {
    const uncachedCost = ((usage.promptTokens - usage.cachedTokens) / 1000) * pricing.input;
    const cachedCost = (usage.cachedTokens / 1000) * pricing.cachedInput;
    const outputCost = (usage.completionTokens / 1000) * pricing.output;
    return uncachedCost + cachedCost + outputCost;
  }
  return calculateCostSync(
    provider,
    modelName,
    usage.promptTokens - usage.cachedTokens + usage.derivedCachedTokens,
    usage.completionTokens
  );
}

/**
 * Load the price rows before a call is priced, waiting at most `maxWaitMs`
 * (slice 7, RC7-5). Called from the Business OS settings refill, so a Business
 * OS call is charged from the rows rather than the in-code table.
 *
 * - Fresh cache: returns at once, no read.
 * - Otherwise: joins the read in flight, or starts one. On timeout it returns;
 *   the read keeps going and lands for the next call.
 * - Never throws.
 */
export async function warmPricingCache(maxWaitMs: number): Promise<void> {
  if (!isCacheStale()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logger.warn({ maxWaitMs }, 'Pricing warm-up is slow; continuing without waiting for it');
        resolve();
      }, maxWaitMs);
      // Never hold a serverless invocation open for the timer's sake.
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    await Promise.race([sharedLoad(), timeout]);
  } catch (error) {
    // Unreachable: neither promise rejects. Kept so a warm can never fail a call.
    logger.warn({ err: error }, 'Pricing warm-up failed; prices come from the in-code table until a read lands');
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * Refresh the price rows from the database, on THIS instance (finding 4).
 *
 * Never joins a read already in flight (SA C-1): that read may have begun
 * before the change being refreshed for committed. A new read starts after it,
 * and every later lookup joins the new one. The image prices are marked stale
 * and reload on the next image request (RC7-4); nothing is read for them here.
 */
export async function refreshPricingCache(): Promise<void> {
  invalidateImagePrices();
  await startLoad(inFlightLoad);
}

/** One priced model, in the same units the cache holds (cost per 1000 tokens). */
export interface PricedModel {
  provider: string;
  model: string;
  /** Cost per 1,000 input tokens — NOT per token, despite the column name. */
  inputPer1kTokens: number;
  /** Cost per 1,000 output tokens. 0 for input-only models (embeddings). */
  outputPer1kTokens: number;
  /** Where the price came from, so a caller can say so. */
  source: 'database' | 'fallback';
}

/**
 * Every model this module can price, for a picker.
 *
 * Deliberately UNFILTERED: it reports what `getPricingInternal` would serve,
 * database rows and in-code fallback entries alike, and leaves every policy
 * decision to the caller. Business OS's "input > 0 AND output > 0" rule lives
 * with the guardrail that owns it (`lib/business-os/llm/modelOptions.ts`), not
 * here — this module must not grow a second opinion about which models are
 * acceptable.
 *
 * Why the fallback entries are included: `getPricingInternal` serves them on a
 * cache miss, so a picker built from the database alone would omit models the
 * validator WOULD accept, teaching an operator that a usable model is refused.
 *
 * Loads through the same TTL path as every other read, so a warm instance does
 * no database work. `cacheAgeMs` is returned because the list is advisory: a
 * newly priced model can be absent for up to `cacheTtlMs`.
 */
export async function listPricedModels(): Promise<{
  models: PricedModel[];
  cacheAgeMs: number;
  cacheTtlMs: number;
}> {
  // Same refresh rule as getPricingInternal, so the list and the lookup can
  // never be served from different snapshots within one request.
  if (isCacheStale()) {
    await sharedLoad();
  }

  const models: PricedModel[] = [];
  const seen = new Set<string>();

  for (const [key, price] of Array.from(pricingCache.entries())) {
    const separator = key.indexOf(':');
    const provider = key.slice(0, separator);
    const model = key.slice(separator + 1);
    seen.add(key);
    models.push({
      provider,
      model,
      inputPer1kTokens: price.input,
      outputPer1kTokens: price.output,
      source: 'database',
    });
  }

  for (const [provider, entries] of Object.entries(FALLBACK_PRICING)) {
    for (const [model, price] of Object.entries(entries as Record<string, PricingInfo>)) {
      // The database wins, exactly as the lookup does.
      if (seen.has(`${provider}:${model}`)) continue;
      models.push({
        provider,
        model,
        inputPer1kTokens: price.input,
        outputPer1kTokens: price.output,
        source: 'fallback',
      });
    }
  }

  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

  return {
    models,
    cacheAgeMs: Date.now() - cacheLastUpdated,
    cacheTtlMs: CACHE_TTL_MS,
  };
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
