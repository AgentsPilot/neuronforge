/**
 * `lib/ai/pricing.ts` after the Step 1 move (SA addendum §E).
 *
 * Three things are proven:
 *   1. The reader goes through `AiModelPricingRepository`, not a client it
 *      builds itself (mandatory rule 1).
 *   2. **The newest price wins.** The rows come back `effective_date DESC` and
 *      the cache keeps the FIRST row per `provider:model`. The previous
 *      implementation overwrote on every row, so any model with more than one
 *      effective_date row was billed at its OLDEST price — and the admin sync
 *      has been able to create exactly those duplicates.
 *   3. The Layer 2 "price must be > 0 on both sides" rule was NOT pushed in
 *      here: `hasPricing` still says yes to an input-only embedding model,
 *      whose `output: 0` is legitimate (D-14, SA addendum §F.6).
 */

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        logged.push({
          level,
          fields: typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {},
          msg: typeof first === 'string' ? first : String(second ?? ''),
        });
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

type Pricing = typeof import('../pricing');

/** A fresh module instance, so the hour-long in-module cache cannot leak between cases. */
async function freshPricing(): Promise<Pricing> {
  let loaded!: Pricing;
  await jest.isolateModulesAsync(async () => {
    loaded = await import('../pricing');
  });
  return loaded;
}

function row(overrides: Record<string, unknown>) {
  return {
    id: 'id',
    provider: 'openai',
    model_name: 'gpt-4o',
    input_cost_per_token: '0.0000025',
    output_cost_per_token: '0.00001',
    effective_date: '2026-01-01',
    retired_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  logged.length = 0;
  mockListActive.mockReset().mockResolvedValue({ data: [], error: null });
});

describe('reading prices', () => {
  it('asks the repository for the active rows', async () => {
    const pricing = await freshPricing();
    await pricing.getPricing('openai', 'gpt-4o');
    expect(mockListActive).toHaveBeenCalled();
  });

  it('keeps the NEWEST row per model, not the last one it reads', async () => {
    mockListActive.mockResolvedValue({
      data: [
        // newest first, as `listActive` orders them
        row({ effective_date: '2026-06-01', input_cost_per_token: '0.000001', output_cost_per_token: '0.000004' }),
        row({ effective_date: '2024-01-01', input_cost_per_token: '0.00009', output_cost_per_token: '0.0009' }),
      ],
      error: null,
    });

    const pricing = await freshPricing();
    expect(await pricing.getPricing('openai', 'gpt-4o')).toEqual({ input: 0.001, output: 0.004 });
    expect(logged.some((line) => line.fields.superseded === 1)).toBe(true);
  });

  it('accepts numeric as well as string costs', async () => {
    mockListActive.mockResolvedValue({
      data: [row({ model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006 })],
      error: null,
    });
    const pricing = await freshPricing();
    const price = await pricing.getPricing('openai', 'gpt-4o-mini');
    expect(price?.input).toBeCloseTo(0.00015, 10);
    expect(price?.output).toBeCloseTo(0.0006, 10);
  });

  it('falls back to the in-code table when the database has no row for the model', async () => {
    const pricing = await freshPricing();
    expect(await pricing.getPricing('openai', 'gpt-4o')).toEqual({ input: 0.0025, output: 0.01 });
  });

  it('never throws when the read fails, and says so at error level', async () => {
    mockListActive.mockResolvedValue({ data: null, error: new Error('unreachable') });
    const pricing = await freshPricing();
    await expect(pricing.getPricing('openai', 'gpt-4o')).resolves.toEqual({ input: 0.0025, output: 0.01 });
    expect(logged.some((line) => line.level === 'error')).toBe(true);
  });

  it('distinguishes "the query matched nothing" from "the read failed" (D-17)', async () => {
    const pricing = await freshPricing();
    await pricing.getPricing('openai', 'gpt-4o');
    const warn = logged.find((line) => line.level === 'warn');
    expect(warn?.fields).toMatchObject({ activeRows: 0 });
  });

  it('returns null for a model nobody has priced', async () => {
    const pricing = await freshPricing();
    expect(await pricing.getPricing('openai', 'gpt-4o-imaginary')).toBeNull();
  });
});

describe('the zero-price rule stays in Layer 2 (D-14, SA §F.6)', () => {
  it('still reports pricing for an input-only embedding model', async () => {
    const pricing = await freshPricing();
    // output: 0 is correct for these models — there is no completion side.
    expect(await pricing.getPricing('openai', 'text-embedding-3-small')).toEqual({
      input: 0.00002,
      output: 0,
    });
    expect(await pricing.hasPricing('openai', 'text-embedding-3-small')).toBe(true);
  });

  it('and hasPricing still says yes to a 0/0 row — which is why Layer 2 checks the price itself', async () => {
    mockListActive.mockResolvedValue({
      data: [row({ model_name: 'gpt-free', input_cost_per_token: '0', output_cost_per_token: '0' })],
      error: null,
    });
    const pricing = await freshPricing();
    expect(await pricing.hasPricing('openai', 'gpt-free')).toBe(true);
    expect(await pricing.getPricing('openai', 'gpt-free')).toEqual({ input: 0, output: 0 });
  });
});

describe('cost arithmetic is unchanged', () => {
  it('prices per 1000 tokens, synchronously, from the warm cache', async () => {
    mockListActive.mockResolvedValue({ data: [row({})], error: null });
    const pricing = await freshPricing();
    await pricing.getPricing('openai', 'gpt-4o'); // warm the cache
    expect(pricing.calculateCostSync('openai', 'gpt-4o', 1000, 1000)).toBeCloseTo(0.0025 + 0.01, 10);
  });

  it('records $0 and warns for an unpriced model rather than throwing', async () => {
    const pricing = await freshPricing();
    expect(pricing.calculateCostSync('openai', 'gpt-4o-imaginary', 1000, 1000)).toBe(0);
    expect(await pricing.calculateCost('openai', 'gpt-4o-imaginary', 10, 10)).toBe(0);
    expect(logged.some((line) => line.level === 'warn' && line.fields.model === 'gpt-4o-imaginary')).toBe(true);
  });
});

describe('no console logging remains', () => {
  it('uses Pino only', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const source = require('fs').readFileSync(require('path').join(__dirname, '../pricing.ts'), 'utf8');
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)/);
    expect(source).toContain("createLogger({ module: 'AiPricing' })");
    expect(source).not.toContain('createClient');
  });
});

/**
 * S1-T13 — `listPricedModels`, the admin screen's model picker source (FR-8).
 *
 * The property that matters: it reports what the LOOKUP would serve, database
 * rows and in-code fallback entries alike. A list built from the database
 * alone would omit models `getPricing` accepts, so the picker would teach an
 * operator that a usable model is refused.
 *
 * It deliberately applies NO acceptability rule of its own — Business OS's
 * "> 0 on both sides" lives with the guardrail that owns it.
 */
describe('listPricedModels (admin model options)', () => {
  it('reports database rows, in the units the cache holds (per 1,000 tokens)', async () => {
    mockListActive.mockResolvedValue({
      data: [row({ provider: 'openai', model_name: 'gpt-4o', input_cost_per_token: '0.0000025', output_cost_per_token: '0.00001' })],
      error: null,
    });
    const pricing = await freshPricing();

    const { models } = await pricing.listPricedModels();
    const found = models.find((m) => m.model === 'gpt-4o')!;

    expect(found.source).toBe('database');
    expect(found.inputPer1kTokens).toBeCloseTo(0.0025);
    expect(found.outputPer1kTokens).toBeCloseTo(0.01);
  });

  it('includes the in-code fallback entries the lookup would also serve', async () => {
    mockListActive.mockResolvedValue({ data: [], error: null });
    const pricing = await freshPricing();

    const { models } = await pricing.listPricedModels();
    const fallbackOnly = models.filter((m) => m.source === 'fallback');

    expect(fallbackOnly.length).toBeGreaterThan(0);
    // Every one of them must really be servable by the lookup — that is the
    // claim this list is making.
    for (const candidate of fallbackOnly.slice(0, 5)) {
      expect(await pricing.getPricing(candidate.provider, candidate.model)).not.toBeNull();
    }
  });

  it('lets the database win over the fallback for the same model', async () => {
    mockListActive.mockResolvedValue({
      data: [row({ provider: 'openai', model_name: 'gpt-4o', input_cost_per_token: '0.000009', output_cost_per_token: '0.000009' })],
      error: null,
    });
    const pricing = await freshPricing();

    const { models } = await pricing.listPricedModels();
    const entries = models.filter((m) => m.provider === 'openai' && m.model === 'gpt-4o');

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('database');
  });

  it('filters NOTHING — an input-only model is reported, and the caller decides', async () => {
    mockListActive.mockResolvedValue({ data: [], error: null });
    const pricing = await freshPricing();

    const { models } = await pricing.listPricedModels();

    // `text-embedding-*` is legitimately priced input-only. Business OS refuses
    // it (`zero_price`), but that rule belongs to the guardrail, not here:
    // pushing it into this module would be the second opinion D-3 forbids.
    expect(models.some((m) => m.model.startsWith('text-embedding-') && m.outputPer1kTokens === 0)).toBe(true);
  });

  it('reports the cache age, because the list is advisory for up to an hour', async () => {
    mockListActive.mockResolvedValue({ data: [row({})], error: null });
    const pricing = await freshPricing();

    const { cacheAgeMs, cacheTtlMs } = await pricing.listPricedModels();

    expect(cacheTtlMs).toBe(60 * 60 * 1000);
    expect(cacheAgeMs).toBeGreaterThanOrEqual(0);
    expect(cacheAgeMs).toBeLessThan(cacheTtlMs);
  });

  it('does not re-implement the lookup: one repository read serves both', async () => {
    mockListActive.mockResolvedValue({ data: [row({})], error: null });
    const pricing = await freshPricing();

    await pricing.listPricedModels();
    await pricing.getPricing('openai', 'gpt-4o');

    // The same TTL path, so the list and the lookup can never be served from
    // different snapshots within one request.
    expect(mockListActive).toHaveBeenCalledTimes(1);
  });
});
