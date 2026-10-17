/**
 * The shared image price resolver and its per-instance cache (AI model price
 * review slice 7, workplan §3.2, SA RC7-3 / RC7-4 / RC7-7). Offline: the
 * repository is mocked.
 */

const mockWarns: Array<Record<string, unknown>> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown) => {
        if (level === 'warn' && typeof first === 'object' && first !== null) mockWarns.push(first as Record<string, unknown>);
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockListActive = jest.fn();
jest.mock('@/lib/repositories/AiModelImagePricingRepository', () => ({
  aiModelImagePricingRepository: { listActive: (...args: unknown[]) => mockListActive(...args) },
}));

import {
  IMAGE_PRICE_WAIT_MS,
  __resetImagePricesForTests,
  imagePriceKey,
  invalidateImagePrices,
  loadImagePrices,
  loadImagePricesWithin,
  resolveImagePriceFrom,
  selectActiveImagePrices,
} from '@/lib/ai/imagePricing';
import { PRICING_CACHE_TTL_MS } from '@/lib/ai/pricingCacheTtl';
import { IMAGE_FALLBACK_PRICING } from '@/lib/repositories/SystemConfigRepository';

const FLARE = 'gpt-image-2.5-flare';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r1',
    provider: 'openai',
    model_name: FLARE,
    size: '1024x1024',
    quality: 'high',
    cost_per_image: 0.05,
    effective_date: '2026-10-16',
    created_at: '2026-10-16T00:00:00+00:00',
    ...overrides,
  };
}

beforeEach(() => {
  __resetImagePricesForTests();
  mockListActive.mockReset();
  jest.restoreAllMocks();
});

describe('selectActiveImagePrices (the one selection rule)', () => {
  it('keeps the first row per key, in repository order (newest first)', () => {
    const newest = row({ id: 'new', cost_per_image: 0.06 });
    const older = row({ id: 'old', cost_per_image: 0.04 });
    const other = row({ id: 'sq-low', quality: 'low', cost_per_image: 0.01 });
    const selected = selectActiveImagePrices([newest, older, other]);
    expect([...selected.values()].map((r) => r.id)).toEqual(['new', 'sq-low']);
  });

  it('skips a row not priced above 0 and takes the next one for the key', () => {
    const selected = selectActiveImagePrices([row({ id: 'zero', cost_per_image: 0 }), row({ id: 'nan', cost_per_image: 'abc' }), row({ id: 'ok', cost_per_image: '0.07' })]);
    expect([...selected.values()].map((r) => r.id)).toEqual(['ok']);
  });

  it('keys on provider, model, size and quality', () => {
    expect(imagePriceKey('openai', FLARE, '1024x1024', 'high')).toBe(`openai:${FLARE}:1024x1024:high`);
    const selected = selectActiveImagePrices([row(), row({ id: 'other-provider', provider: 'acme' })]);
    expect(selected.size).toBe(2);
  });
});

describe('resolveImagePriceFrom', () => {
  const fallbackKey = `${FLARE}:1024x1024:high`;

  it('the table beats the in-code fallback', () => {
    const table = new Map([[imagePriceKey('openai', FLARE, '1024x1024', 'high'), 0.09]]);
    expect(resolveImagePriceFrom(table, 'openai', FLARE, '1024x1024', 'high')).toEqual({ usdPerImage: 0.09, source: 'table' });
  });

  it('an empty table gives the in-code fallback, exactly', () => {
    expect(resolveImagePriceFrom(new Map(), 'openai', FLARE, '1024x1024', 'high')).toEqual({
      usdPerImage: IMAGE_FALLBACK_PRICING[fallbackKey],
      source: 'fallback',
    });
  });

  it('a table entry for another provider does not price this one', () => {
    const table = new Map([[imagePriceKey('acme', FLARE, '1024x1024', 'high'), 0.09]]);
    expect(resolveImagePriceFrom(table, 'openai', FLARE, '1024x1024', 'high').source).toBe('fallback');
  });

  it('a 0 or NaN in the table is not a price', () => {
    for (const bad of [0, Number.NaN, -1]) {
      const table = new Map([[imagePriceKey('openai', FLARE, '1024x1024', 'high'), bad]]);
      expect(resolveImagePriceFrom(table, 'openai', FLARE, '1024x1024', 'high').source).toBe('fallback');
    }
  });

  it('priced nowhere: 0, unpriced', () => {
    expect(resolveImagePriceFrom(new Map(), 'openai', FLARE, '1024x1024', 'ultra')).toEqual({ usdPerImage: 0, source: 'unpriced' });
    expect(resolveImagePriceFrom(new Map(), 'openai', 'gpt-image-2.5-sunburst', '1024x1024', 'high').source).toBe('unpriced');
  });
});

describe('loadImagePrices (the per-instance cache)', () => {
  it('loads the table, newest row per key, as numbers', async () => {
    mockListActive.mockResolvedValue({ data: [row({ cost_per_image: '0.06' }), row({ id: 'old', cost_per_image: 0.04 })], error: null });
    const table = await loadImagePrices();
    expect([...table.entries()]).toEqual([[`openai:${FLARE}:1024x1024:high`, 0.06]]);
  });

  it('an empty read is a successful load: no second read inside the TTL', async () => {
    mockListActive.mockResolvedValue({ data: [], error: null });
    await loadImagePrices();
    await loadImagePrices();
    await loadImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });

  it('single-flight: concurrent callers share one read', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockListActive.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = [loadImagePrices(), loadImagePrices(), loadImagePrices()];
    release({ data: [row()], error: null });
    const tables = await Promise.all(pending);
    expect(mockListActive).toHaveBeenCalledTimes(1);
    expect(tables.every((t) => t === tables[0])).toBe(true);
  });

  it('a failed read keeps the previous map and retries on the next call', async () => {
    mockListActive.mockResolvedValueOnce({ data: [row()], error: null });
    const first = await loadImagePrices();
    invalidateImagePrices();
    mockListActive.mockResolvedValueOnce({ data: null, error: new Error('down') });
    expect(await loadImagePrices()).toBe(first);
    mockListActive.mockResolvedValueOnce({ data: [], error: null });
    expect((await loadImagePrices()).size).toBe(0);
    expect(mockListActive).toHaveBeenCalledTimes(3);
  });

  it('a failed first read gives an empty map (fallback pricing) and never throws', async () => {
    mockListActive.mockRejectedValue(new Error('contract broken'));
    await expect(loadImagePrices()).resolves.toEqual(new Map());
  });

  it('reloads after the TTL', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockListActive.mockResolvedValue({ data: [], error: null });
    await loadImagePrices();
    now.mockReturnValue(1_000_000 + PRICING_CACHE_TTL_MS - 1);
    await loadImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + PRICING_CACHE_TTL_MS);
    await loadImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(2);
  });

  it('invalidate reads nothing by itself; the next call reloads (RC7-4)', async () => {
    mockListActive.mockResolvedValue({ data: [], error: null });
    await loadImagePrices();
    invalidateImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(1);
    await loadImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(2);
  });
});

describe('loadImagePricesWithin (the bounded wait)', () => {
  it('the default wait is about 2 s', () => {
    expect(IMAGE_PRICE_WAIT_MS).toBe(2_000);
  });

  it('a hung read returns the last loaded map after the wait, and the read lands later', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockListActive.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const table = await loadImagePricesWithin(20);
    expect(table.size).toBe(0);
    release({ data: [row()], error: null });
    await new Promise((resolve) => setImmediate(resolve));
    expect((await loadImagePrices()).size).toBe(1);
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });

  it('the timeout warning carries the age of the prices used (SA ruling 2)', async () => {
    mockListActive.mockResolvedValueOnce({ data: [row()], error: null });
    await loadImagePrices();
    invalidateImagePrices();
    mockListActive.mockReturnValueOnce(new Promise(() => undefined));
    mockWarns.length = 0;
    const table = await loadImagePricesWithin(20);
    expect(table.size).toBe(1);
    expect(mockWarns).toHaveLength(1);
    expect(typeof mockWarns[0].pricesAgeMs).toBe('number');
    expect(mockWarns[0]).toMatchObject({ maxWaitMs: 20, entries: 1 });
  });

  it('a fast read returns the loaded table', async () => {
    mockListActive.mockResolvedValue({ data: [row()], error: null });
    expect((await loadImagePricesWithin(1_000)).size).toBe(1);
  });
});

describe('invalidation while a read is in flight (SA C-1)', () => {
  it('the read that began before the invalidation cannot mark the cache fresh; a new read follows and wins', async () => {
    let releaseOld: (value: unknown) => void = () => undefined;
    mockListActive
      .mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce({ data: [row({ id: 'new', cost_per_image: 0.08 })], error: null });

    const before = loadImagePrices();
    invalidateImagePrices();
    const after = loadImagePrices();
    // The second load did not join the first.
    expect(after).not.toBe(before);

    releaseOld({ data: [row({ id: 'old', cost_per_image: 0.05 })], error: null });
    await before;
    const table = await after;
    expect([...table.values()]).toEqual([0.08]);
    expect(mockListActive).toHaveBeenCalledTimes(2);
    // Fresh now: no third read.
    await loadImagePrices();
    expect(mockListActive).toHaveBeenCalledTimes(2);
  });

  // QA M08b: proves the RESULT is right in this order too (through chaining); it does not exercise the epoch backstop.
  it('the newer rows win when they are ready before the older read returns', async () => {
    let releaseOld: (value: unknown) => void = () => undefined;
    mockListActive
      .mockReturnValueOnce(new Promise((resolve) => (releaseOld = resolve)))
      .mockReturnValueOnce(Promise.resolve({ data: [row({ id: 'new', cost_per_image: 0.08 })], error: null }));
    void loadImagePrices();
    invalidateImagePrices();
    const after = loadImagePrices();
    releaseOld({ data: [row({ id: 'old', cost_per_image: 0.05 })], error: null });
    expect([...(await after).values()]).toEqual([0.08]);
  });
});
