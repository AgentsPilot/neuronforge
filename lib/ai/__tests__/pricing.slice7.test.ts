/**
 * `lib/ai/pricing.ts`, slice 7 behaviour (AI model price review; workplan §3.1,
 * §3.6, SA C-1, RC7-4, RC7-5, O-2, O-5):
 *   - the cached-input rate from the row, and today's rule when there is none;
 *   - the warm-up: no read when fresh, one shared read, bounded, never throws;
 *   - a refresh never joins a read in flight, and an older read never
 *     overwrites a newer one (C-1);
 *   - a refresh marks the image prices stale without reading them (RC7-4);
 *   - P-1d for the embedding row added by the BQ-7a runbook: warm and cold
 *     charge the same, bit for bit.
 * Offline: the repository is mocked; a fresh module per case.
 */

const logged: Array<{ level: string; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        logged.push({ level, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockListActive = jest.fn();
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: (...args: unknown[]) => mockListActive(...args) },
}));

const mockImageListActive = jest.fn();
jest.mock('@/lib/repositories/AiModelImagePricingRepository', () => ({
  aiModelImagePricingRepository: { listActive: (...args: unknown[]) => mockImageListActive(...args) },
}));

type Pricing = typeof import('../pricing');
type ImagePricing = typeof import('../imagePricing');

async function fresh(): Promise<{ pricing: Pricing; images: ImagePricing }> {
  let loaded!: { pricing: Pricing; images: ImagePricing };
  await jest.isolateModulesAsync(async () => {
    loaded = { pricing: await import('../pricing'), images: await import('../imagePricing') };
  });
  return loaded;
}

function row(model: string, input: number, output: number, cached: number | string | null = null, overrides: Record<string, unknown> = {}) {
  return {
    id: `id-${model}`,
    provider: 'openai',
    model_name: model,
    input_cost_per_token: input,
    output_cost_per_token: output,
    cached_input_cost_per_token: cached,
    effective_date: '2026-10-16',
    retired_date: null,
    created_at: '2026-10-16T00:00:00Z',
    ...overrides,
  };
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const NO_PRICE_WARN = 'No pricing found; recording $0 for this call';

beforeEach(() => {
  logged.length = 0;
  mockListActive.mockReset().mockResolvedValue({ data: [], error: null });
  mockImageListActive.mockReset().mockResolvedValue({ data: [], error: null });
});

afterEach(() => jest.restoreAllMocks());

describe('cached input (O-2, O-5)', () => {
  const usage = { promptTokens: 1200, cachedTokens: 512, completionTokens: 150, derivedCachedTokens: 256 };

  it('a row with a cached rate charges cached tokens at it (below half the input rate)', async () => {
    mockListActive.mockResolvedValue({ data: [row('gpt-4o-mini', 1.5e-7, 6e-7, 7.5e-8 / 5)], error: null });
    const { pricing } = await fresh();
    await pricing.refreshPricingCache();
    const expected = ((1200 - 512) / 1000) * 0.00015 + (512 / 1000) * ((7.5e-8 / 5) * 1000) + (150 / 1000) * 0.0006;
    expect(pricing.calculateCostWithCachedSync('openai', 'gpt-4o-mini', usage)).toBe(expected);
  });

  it('and at it when it is above half the input rate too (the database is the authority)', async () => {
    mockListActive.mockResolvedValue({ data: [row('gpt-4o-mini', 1.5e-7, 6e-7, 1.2e-7)], error: null });
    const { pricing } = await fresh();
    await pricing.refreshPricingCache();
    const derived = pricing.calculateCostSync('openai', 'gpt-4o-mini', 1200 - 512 + 256, 150);
    expect(pricing.calculateCostWithCachedSync('openai', 'gpt-4o-mini', usage)).toBeGreaterThan(derived);
  });

  it.each([
    ['NULL', null],
    ['0', 0],
    ['"0"', '0'],
    ['NaN', 'abc'],
    ['negative', -1e-8],
  ])('a cached rate of %s is not set: exactly today\'s expression', async (_label, cached) => {
    mockListActive.mockResolvedValue({ data: [row('gpt-4o-mini', 1.5e-7, 6e-7, cached as number | string | null)], error: null });
    const { pricing } = await fresh();
    await pricing.refreshPricingCache();
    expect(
      Object.is(
        pricing.calculateCostWithCachedSync('openai', 'gpt-4o-mini', usage),
        pricing.calculateCostSync('openai', 'gpt-4o-mini', 1200 - 512 + 256, 150)
      )
    ).toBe(true);
  });

  it('the in-code table never carries a cached rate: cold instance = today\'s rule', async () => {
    const { pricing } = await fresh();
    expect(pricing.calculateCostWithCachedSync('openai', 'gpt-4o', usage)).toBe(
      pricing.calculateCostSync('openai', 'gpt-4o', 1200 - 512 + 256, 150)
    );
  });

  it('a missing price returns 0 and warns exactly once', async () => {
    const { pricing } = await fresh();
    expect(pricing.calculateCostWithCachedSync('openai', 'gpt-imaginary', usage)).toBe(0);
    expect(logged.filter((line) => line.msg === NO_PRICE_WARN)).toHaveLength(1);
  });
});

describe('P-1d: the BQ-7a embedding row charges the same warm and cold', () => {
  it('row 549fcc6e (input 2e-8, a JSON number) equals the in-code price bit for bit', async () => {
    const embeddingRow = row('text-embedding-3-small', 2e-8, 0, null, { id: '549fcc6e-3f63-4d06-b959-71c77759a12e' });
    expect(0.00000002 * 1000).toBe(0.00002);

    const cold = (await fresh()).pricing;
    mockListActive.mockResolvedValue({ data: [embeddingRow], error: null });
    const warm = (await fresh()).pricing;
    await warm.refreshPricingCache();

    for (const tokens of [1, 37, 8191, 100_000]) {
      const usage = { promptTokens: tokens, cachedTokens: 0, completionTokens: 0, derivedCachedTokens: 0 };
      const coldCost = cold.calculateCostWithCachedSync('openai', 'text-embedding-3-small', usage);
      const warmCost = warm.calculateCostWithCachedSync('openai', 'text-embedding-3-small', usage);
      expect(Object.is(warmCost, coldCost)).toBe(true);
    }
    expect(warm.calculateCostWithCachedSync('openai', 'text-embedding-3-small', { promptTokens: 37, cachedTokens: 0, completionTokens: 0, derivedCachedTokens: 0 })).toBe(7.4e-7);
  });
});

describe('warmPricingCache (RC7-5)', () => {
  it('a fresh cache: no read', async () => {
    mockListActive.mockResolvedValue({ data: [row('gpt-4o', 0.0000025, 0.00001)], error: null });
    const { pricing } = await fresh();
    await pricing.warmPricingCache(1_000);
    await pricing.warmPricingCache(1_000);
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });

  it('a stale cache: one read, and the rows are then charged', async () => {
    mockListActive.mockResolvedValue({ data: [row('gpt-4o', 0.000005, 0.00002)], error: null });
    const { pricing } = await fresh();
    await pricing.warmPricingCache(1_000);
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);
  });

  it('concurrent cold callers share one read (warm, getPricing, listPricedModels)', async () => {
    const read = deferred<{ data: unknown[]; error: null }>();
    mockListActive.mockReturnValue(read.promise);
    const { pricing } = await fresh();
    const all = Promise.all([pricing.warmPricingCache(5_000), pricing.getPricing('openai', 'gpt-4o'), pricing.listPricedModels()]);
    read.resolve({ data: [row('gpt-4o', 0.0000025, 0.00001)], error: null });
    await all;
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });

  it('a hung read: the warm returns by maxWaitMs, and the read lands later', async () => {
    const read = deferred<{ data: unknown[]; error: null }>();
    mockListActive.mockReturnValue(read.promise);
    const { pricing } = await fresh();
    const started = Date.now();
    await pricing.warmPricingCache(30);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(logged.some((line) => line.level === 'warn' && line.msg.includes('warm-up is slow'))).toBe(true);
    read.resolve({ data: [row('gpt-4o', 0.000005, 0.00002)], error: null });
    await flush();
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);
  });

  it('a failed read: never throws, prices stay in-code', async () => {
    mockListActive.mockResolvedValue({ data: null, error: new Error('down') });
    const { pricing } = await fresh();
    await expect(pricing.warmPricingCache(1_000)).resolves.toBeUndefined();
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.0025);
  });
});

describe('refreshPricingCache never joins a read in flight (SA C-1)', () => {
  const OLD = { data: [row('gpt-4o', 0.0000025, 0.00001)], error: null };
  const NEW = { data: [row('gpt-4o', 0.000005, 0.00002)], error: null };

  it('read in flight, then a refresh: the refresh makes its own read, after it, and its rows win', async () => {
    const first = deferred<typeof OLD>();
    mockListActive.mockReturnValueOnce(first.promise).mockResolvedValueOnce(NEW);
    const { pricing } = await fresh();

    const lookup = pricing.getPricing('openai', 'gpt-4o');
    const refresh = pricing.refreshPricingCache();
    await flush();
    // The refresh did not join, and does not start until the read in flight settles.
    expect(mockListActive).toHaveBeenCalledTimes(1);

    first.resolve(OLD);
    await Promise.all([lookup, refresh]);
    expect(mockListActive).toHaveBeenCalledTimes(2);
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);
  });

  // QA M08: proves the RESULT is right in this order too (through chaining); it does not exercise the generation backstop.
  it('the refresh rows win when they are ready before the older read returns', async () => {
    const first = deferred<typeof OLD>();
    const second = deferred<typeof NEW>();
    mockListActive.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { pricing } = await fresh();

    const lookup = pricing.getPricing('openai', 'gpt-4o');
    const refresh = pricing.refreshPricingCache();
    second.resolve(NEW); // the newer data is ready before the older read returns
    await flush();
    first.resolve(OLD);
    await Promise.all([lookup, refresh]);
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);
  });

  it('a lookup made after the refresh joins the refresh\'s read, not the older one', async () => {
    const first = deferred<typeof OLD>();
    mockListActive.mockReturnValueOnce(first.promise).mockResolvedValueOnce(NEW);
    const { pricing } = await fresh();

    void pricing.getPricing('openai', 'gpt-4o');
    const refresh = pricing.refreshPricingCache();
    const later = pricing.getPricing('openai', 'gpt-4o');
    first.resolve(OLD);
    await refresh;
    expect(await later).toMatchObject({ input: 0.005 });
    expect(mockListActive).toHaveBeenCalledTimes(2);
  });

  it('the older read failing, or the refresh read failing, keeps the best rows', async () => {
    const first = deferred<{ data: null; error: Error }>();
    mockListActive.mockReturnValueOnce(first.promise).mockResolvedValueOnce(NEW);
    const { pricing } = await fresh();
    const lookup = pricing.getPricing('openai', 'gpt-4o');
    const refresh = pricing.refreshPricingCache();
    first.resolve({ data: null, error: new Error('down') });
    await lookup;
    await refresh;
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);

    mockListActive.mockResolvedValueOnce({ data: null, error: new Error('down again') });
    await pricing.refreshPricingCache();
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 0)).toBe(0.005);
  });

  it('a refresh marks the image prices stale WITHOUT reading them (RC7-4)', async () => {
    const { pricing, images } = await fresh();
    await images.loadImagePrices();
    expect(mockImageListActive).toHaveBeenCalledTimes(1);
    await pricing.refreshPricingCache();
    expect(mockImageListActive).toHaveBeenCalledTimes(1);
    await images.loadImagePrices();
    expect(mockImageListActive).toHaveBeenCalledTimes(2);
  });
});

// A module, not a script: its names must not collide with other suites in the type-check.
export {};
