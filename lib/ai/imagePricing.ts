// lib/ai/imagePricing.ts
//
// The price of one generated image: the ONE resolver that charging, the Layer 2
// guardrail and the admin comparison share (AI model price review slice 7, R-1).
//
// Precedence, per provider + model + size + quality:
//   1. the newest active row of `ai_model_image_pricing` priced above 0, which
//      is the authoritative store;
//   2. the in-code `IMAGE_FALLBACK_PRICING`, the outage fallback;
//   3. nothing: $0, which the caller reports as unpriced.
// The setting `image_generation_prices_usd` is no longer part of it (slice 7
// O-1, user decision BQ-7b): approving a price is the only way to change what an
// image costs. The conservative charge rate is NOT here. It stays the maximum of
// the in-code table (`chargePricing.ts`, requirement finding 3).
//
// The table is cached per serverless instance for `PRICING_CACHE_TTL_MS`
// (SA RC7-3):
//   - an empty read is a successful load. The table is empty in production
//     until the first approved image price, and treating "empty" as "not
//     loaded" would query the database on every image and every guardrail
//     check;
//   - single-flight: concurrent callers share one read;
//   - a failed read keeps the previous map and leaves the load time unchanged,
//     so the next caller retries. Never throws;
//   - `invalidateImagePrices()` marks the map stale without reading, and a read
//     already in flight can no longer mark it fresh (SA C-1)
//     (`refreshPricingCache()` calls it, SA RC7-4).
//
// Dependency-light on purpose: it imports the logger, the image repository and
// the in-code table, and never `lib/ai/pricing.ts` (which imports it), the
// catalog, `modelSettings` or `GeneratedImageService`. Both of the last two
// import it, so it must not import either. Server-side only: it reaches the
// repository layer.

import { createLogger } from '@/lib/logger';
import { aiModelImagePricingRepository } from '@/lib/repositories/AiModelImagePricingRepository';
import { IMAGE_FALLBACK_PRICING } from '@/lib/repositories/SystemConfigRepository';
import { PRICING_CACHE_TTL_MS } from './pricingCacheTtl';

const logger = createLogger({ module: 'ImagePricing' });

/** `provider:model:size:quality` → USD per image. Only prices above 0 are in it. */
export type ImagePriceTable = ReadonlyMap<string, number>;

/** Where an image price came from. */
export type ImagePriceSource = 'table' | 'fallback' | 'unpriced';

/** How long an image request waits for a cold table read before pricing from the fallback (SA RC7-3). */
export const IMAGE_PRICE_WAIT_MS = 2_000;

/** The cache key of one image price. */
export function imagePriceKey(provider: string, model: string, size: string, quality: string): string {
  return `${provider}:${model}:${size}:${quality}`;
}

/** The fields the selection rule reads; both repository row shapes have them. */
interface ImagePriceRowLike {
  provider: string;
  model_name: string;
  size: string;
  quality: string;
  cost_per_image: number | string;
}

/** A finite price above 0, from a number or a numeric string. NaN, 0 and negatives are not prices. */
function positivePrice(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * THE selection rule (SA RC7-7), shared by the cache and the admin comparison:
 * per key, the first row priced above 0, with rows in repository order
 * (newest `effective_date`, then newest `created_at`, first). Pure.
 */
export function selectActiveImagePrices<R extends ImagePriceRowLike>(rows: readonly R[]): Map<string, R> {
  const selected = new Map<string, R>();
  for (const row of rows) {
    if (positivePrice(row.cost_per_image) === null) continue;
    const key = imagePriceKey(row.provider, row.model_name, row.size, row.quality);
    if (!selected.has(key)) selected.set(key, row);
  }
  return selected;
}

/**
 * The per-image price: the table, then the in-code fallback, then 0. Pure and
 * SILENT: the guardrail calls it once per size and quality, so reporting an
 * unpriced image is the caller's job.
 */
export function resolveImagePriceFrom(
  table: ImagePriceTable,
  provider: string,
  model: string,
  size: string,
  quality: string
): { usdPerImage: number; source: ImagePriceSource } {
  const stored = positivePrice(table.get(imagePriceKey(provider, model, size, quality)));
  if (stored !== null) return { usdPerImage: stored, source: 'table' };

  // The in-code table is keyed without a provider: OpenAI is the only image provider (F-15).
  const fallback = positivePrice(IMAGE_FALLBACK_PRICING[`${model}:${size}:${quality}`]);
  if (fallback !== null) return { usdPerImage: fallback, source: 'fallback' };

  return { usdPerImage: 0, source: 'unpriced' };
}

// ---------------------------------------------------------------------------
// The per-instance cache
// ---------------------------------------------------------------------------

const EMPTY: ImagePriceTable = new Map();

let prices: ImagePriceTable = EMPTY;
/** When `prices` was last read successfully; 0 before the first success. Never reset by invalidation. */
let pricesReadAt = 0;
/** Bumped by `invalidateImagePrices()`. A map is fresh only if it was read in the current epoch. */
let epoch = 0;
/** The epoch `prices` was read in; -1 before the first success. */
let pricesEpoch = -1;
let inFlight: Promise<ImagePriceTable> | null = null;
let inFlightEpoch = -1;

function isFresh(): boolean {
  return pricesEpoch === epoch && pricesReadAt > 0 && Date.now() - pricesReadAt < PRICING_CACHE_TTL_MS;
}

async function readTable(startEpoch: number): Promise<ImagePriceTable> {
  try {
    const { data, error } = await aiModelImagePricingRepository.listActive();
    if (error || !data) {
      logger.warn({ err: error }, 'Could not read image prices; keeping the current ones (in-code fallback when none)');
      return prices;
    }
    if (startEpoch !== epoch) {
      // Invalidated while this read was in flight: it may hold the rows from
      // before the change, so it must not mark the cache fresh (SA C-1). The
      // read chained after it applies instead.
      // BACKSTOP (SA F-4): a load after the invalidation chains behind this read
      // and `isFresh` also requires the current epoch, so this cannot change the
      // outcome today. Kept as defence in depth.
      logger.debug({ startEpoch, epoch }, 'Discarded an image price read that began before an invalidation');
      return prices;
    }
    const next = new Map<string, number>();
    for (const [key, row] of selectActiveImagePrices(data)) {
      next.set(key, positivePrice(row.cost_per_image) as number);
    }
    prices = next;
    pricesReadAt = Date.now();
    pricesEpoch = startEpoch;
    logger.debug({ rows: data.length, entries: next.size }, 'Loaded image prices');
    return prices;
  } catch (error) {
    // Unreachable unless the repository breaks its never-throws contract.
    logger.warn({ err: error }, 'Image price read failed; keeping the current ones');
    return prices;
  }
}

/**
 * The image price table for this instance: the cached map while fresh,
 * otherwise one shared read. Never throws; on a failed read it returns the
 * previous map (empty before the first success, which prices every image from
 * the in-code fallback, exactly as before slice 7).
 *
 * After `invalidateImagePrices()`, a read already in flight is NOT joined: a new
 * read starts after it (SA C-1), and later callers join the new one.
 */
export function loadImagePrices(): Promise<ImagePriceTable> {
  if (isFresh()) return Promise.resolve(prices);
  if (inFlight && inFlightEpoch === epoch) return inFlight;
  const startEpoch = epoch;
  const pending: Promise<ImagePriceTable> = (inFlight ?? Promise.resolve(prices))
    .catch(() => prices)
    .then(() => readTable(startEpoch))
    .finally(() => {
      if (inFlight === pending) {
        inFlight = null;
        inFlightEpoch = -1;
      }
    });
  inFlight = pending;
  inFlightEpoch = startEpoch;
  return pending;
}

/**
 * `loadImagePrices()`, waiting at most `maxWaitMs`. On timeout it returns the
 * last loaded map (SA ruling 2: empty on a cold instance, so the in-code
 * fallback prices the image) and lets the read land for the next caller. The
 * warning carries the map's age. Never throws, never hangs.
 */
export async function loadImagePricesWithin(maxWaitMs: number = IMAGE_PRICE_WAIT_MS): Promise<ImagePriceTable> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ImagePriceTable>((resolve) => {
    timer = setTimeout(() => {
      logger.warn(
        { maxWaitMs, pricesAgeMs: pricesReadAt > 0 ? Date.now() - pricesReadAt : null, entries: prices.size },
        'Image price read is slow; pricing from the last loaded prices'
      );
      resolve(prices);
    }, maxWaitMs);
    // Never hold a serverless invocation open for the timer's sake.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([loadImagePrices(), timeout]);
  } catch (error) {
    // Unreachable: neither promise rejects. Kept so a future change cannot fail an image.
    logger.warn({ err: error }, 'Image price wait failed; pricing from the last loaded prices');
    return prices;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Mark the image prices stale WITHOUT reading them (SA RC7-4): the next image
 * request or guardrail check reloads. Called by `refreshPricingCache()` after an
 * apply, so that path, and every test that refreshes, stays free of a network
 * read. A read already in flight can no longer mark the cache fresh (SA C-1).
 */
export function invalidateImagePrices(): void {
  epoch += 1;
}

/** Drop the cache. Tests only. */
export function __resetImagePricesForTests(): void {
  prices = EMPTY;
  pricesReadAt = 0;
  epoch = 0;
  pricesEpoch = -1;
  inFlight = null;
  inFlightEpoch = -1;
}
