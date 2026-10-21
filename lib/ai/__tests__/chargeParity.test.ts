/**
 * Charge parity: what every Business OS charge path costs TODAY, frozen
 * (AI model price review slice 7, workplan §5, SA RC7-8).
 *
 * Slice 7 moves the price readers onto the database (cached input, images, the
 * embedding figure). With today's production state it must change no charge,
 * so this suite was written and run green on the UNMODIFIED tree before any
 * slice 7 code, and it is not edited afterwards. If it goes red, the code
 * changed a charge; fix the code, never this file.
 *
 * Self-contained by design (RC7-8):
 *   - the expected costs are LITERAL numbers, and the reference formula below
 *     uses literal rates and today's operations in today's order;
 *   - nothing here calls `calculateCostSync`, `resolveImagePrice`,
 *     `inCodeTokenPrices` or `IMAGE_FALLBACK_PRICING`, because slice 7 touches
 *     or wraps all of them;
 *   - the real `OpenAIProvider` runs against a mocked SDK, so the private cost
 *     function AND the ledger row (`cost_usd`) are both covered;
 *   - the database is a small in-memory fake behind `supabaseServer`, holding
 *     production-shaped rows (JSON numbers, as `select('*')` returns them,
 *     read on 2026-10-16). Every repository, old or new, reads through it, so
 *     no module path that slice 7 adds needs to be named here.
 *
 * Production state, 2026-10-16: active token rows with cached input NULL; the
 * `text-embedding-3-small` row (BQ-7a, added by runbook); no image rows; no
 * image price setting; no `bos_llm_area_*` override that differs from a default.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- fresh module registries per scenario (cold vs warm cache) */

type Row = Record<string, unknown>;

/** The fake database. `mock` prefix: read inside the jest.mock factories. */
const mockDb: { tables: Record<string, Row[]>; failing: Set<string>; reads: string[] } = {
  tables: {},
  failing: new Set(),
  reads: [],
};

jest.mock('@/lib/supabaseServer', () => {
  type Filter = (row: Record<string, unknown>) => boolean;
  const builder = (table: string) => {
    const filters: Filter[] = [];
    const orders: Array<[string, boolean]> = [];
    let mode: 'many' | 'single' | 'maybe' = 'many';
    const run = () => {
      mockDb.reads.push(table);
      if (mockDb.failing.has(table)) return { data: null, error: { message: 'database unavailable (test)' }, count: null };
      const rows = (mockDb.tables[table] ?? [])
        .filter((row) => filters.every((f) => f(row)))
        .sort((a, b) => {
          for (const [column, ascending] of orders) {
            const left = String(a[column] ?? '');
            const right = String(b[column] ?? '');
            if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        })
        .map((row) => ({ ...row }));
      if (mode === 'many') return { data: rows, error: null, count: rows.length };
      if (mode === 'single' && rows.length !== 1) return { data: null, error: { message: 'not exactly one row (test)' }, count: null };
      return { data: rows[0] ?? null, error: null, count: null };
    };
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), query),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), query),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), query),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), query),
      lte: (column: string, value: unknown) => (filters.push((row) => String(row[column]) <= String(value)), query),
      gte: (column: string, value: unknown) => (filters.push((row) => String(row[column]) >= String(value)), query),
      order: (column: string, options?: { ascending?: boolean }) => (orders.push([column, options?.ascending !== false]), query),
      limit: () => query,
      range: () => query,
      single: () => ((mode = 'single'), query),
      maybeSingle: () => ((mode = 'maybe'), query),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return query;
  };
  return {
    supabaseServer: {
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: { message: 'no rpc in this suite' } }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        }),
      },
    },
  };
});

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        mockLogged.push({
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

const mockGenerate = jest.fn();
const mockChatCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    images: { generate: (...args: unknown[]) => mockGenerate(...args) },
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
    embeddings: { create: (...args: unknown[]) => mockEmbeddingsCreate(...args) },
  }))
);

const mockMedia = { findBySourceRef: jest.fn(), countGeneratedSince: jest.fn(), record: jest.fn() };
jest.mock('@/lib/repositories/UserMediaRepository', () => ({ userMediaRepository: mockMedia }));

import type { AICallData } from '@/lib/analytics/aiAnalytics';
import type { UsageCallRecord } from '@/lib/ai/usageScope';

// ---------------------------------------------------------------------------
// Production-shaped data (read-only from production, 2026-10-16)
// ---------------------------------------------------------------------------

const PROD_TOKEN_ROWS: Row[] = [
  { id: 'd1dc6cf0-16da-49de-a3f5-f8dd238a41d2', provider: 'openai', model_name: 'gpt-4o', input_cost_per_token: 0.0000025, output_cost_per_token: 0.00001, effective_date: '2026-06-29', retired_date: null, created_at: '2025-10-03T19:55:40.920383+00:00', cached_input_cost_per_token: null, proposal_id: null, proposal_line_id: null },
  { id: '6d0bbad2-d0d6-4136-be7b-f59284de4872', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 1.5e-7, output_cost_per_token: 6e-7, effective_date: '2026-06-29', retired_date: null, created_at: '2026-06-29T13:48:26.001306+00:00', cached_input_cost_per_token: null, proposal_id: null, proposal_line_id: null },
  { id: '549fcc6e-3f63-4d06-b959-71c77759a12e', provider: 'openai', model_name: 'text-embedding-3-small', input_cost_per_token: 2e-8, output_cost_per_token: 0, effective_date: '2026-10-16', retired_date: null, created_at: '2026-10-16T19:56:29.842154+00:00', cached_input_cost_per_token: null, proposal_id: null, proposal_line_id: null },
];

const PROD_SETTINGS_ROWS: Row[] = [
  { key: 'helpbot_embedding_model', value: 'text-embedding-3-small' },
  { key: 'helpbot_embedding_cost_per_1k_tokens', value: 0.00002 },
];

function prodState(): void {
  mockDb.tables = {
    ai_model_pricing: PROD_TOKEN_ROWS.map((row) => ({ ...row })),
    ai_model_image_pricing: [],
    system_settings_config: PROD_SETTINGS_ROWS.map((row) => ({ ...row })),
  };
  mockDb.failing = new Set();
}

// ---------------------------------------------------------------------------
// The reference: today's operations, written out with literal rates
// ---------------------------------------------------------------------------

/** USD per 1,000 tokens, as written in today's in-code table (and equal to the rows). */
const RATE = {
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'text-embedding-3-small': { input: 0.00002, output: 0 },
} as const;

/** `openaiProvider.calculateCost` then `calculateCostSync`, as on `98735db9`. */
function todayChatCost(model: keyof typeof RATE, prompt: number, cachedReported: number, completion: number): number {
  const cached = Math.min(cachedReported > 0 ? cachedReported : 0, prompt);
  const billableInput = prompt - cached + Math.round(cached / 2);
  const inputCost = (billableInput / 1000) * RATE[model].input;
  const outputCost = (completion / 1000) * RATE[model].output;
  return inputCost + outputCost;
}

/** Per-image prices of the live image model, written out (not read from the map). */
const FLARE_USD: Record<'square' | 'portrait' | 'wide', Record<'low' | 'medium' | 'high' | 'xhigh' | 'max', number>> = {
  square: { low: 0.007, medium: 0.015, high: 0.054, xhigh: 0.095, max: 0.212 },
  portrait: { low: 0.006, medium: 0.012, high: 0.043, xhigh: 0.075, max: 0.166 },
  wide: { low: 0.006, medium: 0.012, high: 0.043, xhigh: 0.075, max: 0.166 },
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const USER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const GROUP = '33333333-3333-4333-8333-333333333333';
const NO_PRICE_WARN = 'No pricing found; recording $0 for this call';

const trackAICall = jest.fn();

type Modules = {
  pricing: typeof import('@/lib/ai/pricing');
  openai: typeof import('@/lib/ai/providers/openaiProvider');
  factory: typeof import('@/lib/ai/providerFactory');
  usage: typeof import('@/lib/ai/usageScope');
  images: typeof import('@/lib/services/GeneratedImageService');
  embeddings: typeof import('@/lib/services/EmbeddingService');
  settings: typeof import('@/lib/business-os/llm/modelSettings');
  charge: typeof import('@/lib/business-os/llm/chargePricing');
};

/** A fresh module registry: a cold instance, exactly as a new serverless instance starts. */
function freshInstance(): Modules & { provider: InstanceType<Modules['openai']['OpenAIProvider']> } {
  let loaded: Modules | undefined;
  jest.isolateModules(() => {
    loaded = {
      pricing: require('@/lib/ai/pricing'),
      openai: require('@/lib/ai/providers/openaiProvider'),
      factory: require('@/lib/ai/providerFactory'),
      usage: require('@/lib/ai/usageScope'),
      images: require('@/lib/services/GeneratedImageService'),
      embeddings: require('@/lib/services/EmbeddingService'),
      settings: require('@/lib/business-os/llm/modelSettings'),
      charge: require('@/lib/business-os/llm/chargePricing'),
    };
  });
  const m = loaded as Modules;
  const provider = new m.openai.OpenAIProvider('test-key', { trackAICall: (d: AICallData) => trackAICall(d) });
  jest.spyOn(m.factory.ProviderFactory, 'getOpenAI').mockReturnValue(provider);
  jest.spyOn(m.factory.ProviderFactory, 'getProvider').mockReturnValue(provider);
  jest.spyOn(m.factory.ProviderFactory, 'isProviderAvailable').mockReturnValue(true);
  return { ...m, provider };
}

/** Warm the token cache the way a warm instance has it: one load of the active rows. */
async function warm(m: Modules): Promise<void> {
  await m.pricing.refreshPricingCache();
}

function ledgerCosts(): number[] {
  return trackAICall.mock.calls.map((c) => (c[0] as AICallData).cost_usd);
}

async function scoped(m: Modules, fn: () => Promise<unknown>): Promise<UsageCallRecord[]> {
  const outcome = await m.usage.withUsageScope(GROUP, fn);
  return outcome.usage.calls;
}

function chatUsage(prompt: number, cached: number | undefined, completion: number): Record<string, unknown> {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
  };
}

function chatResponse(usage: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    id: 'c1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  };
}

async function chat(m: ReturnType<typeof freshInstance>, model: string, feature: string, component: string, usage: Record<string, unknown> | undefined) {
  mockChatCreate.mockResolvedValueOnce(chatResponse(usage));
  return scoped(m, () =>
    m.provider.chatCompletion(
      { model, messages: [{ role: 'user', content: 'hi' }] },
      { userId: USER, sessionId: GROUP, feature, component }
    )
  );
}

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  prodState();
  mockDb.reads = [];
  mockLogged.length = 0;
  trackAICall.mockReset();
  trackAICall.mockResolvedValue(undefined);
  mockGenerate.mockReset();
  mockChatCreate.mockReset();
  mockEmbeddingsCreate.mockReset();
  Object.values(mockMedia).forEach((fn) => fn.mockReset());
  mockMedia.findBySourceRef.mockResolvedValue(null);
  mockMedia.countGeneratedSince.mockResolvedValue(0);
  mockMedia.record.mockResolvedValue({ id: 'm1' });
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

// ---------------------------------------------------------------------------
// P-1, P-1b, P-1c, P-1d: token calls
// ---------------------------------------------------------------------------

/** [label, model, area feature, call, prompt, cached reported, completion, golden USD] */
const TOKEN_GOLDEN: Array<[string, keyof typeof RATE, string, string, number, number | undefined, number, number]> = [
  ['chat planner, no cache', 'gpt-4o-mini', 'business-os-chat', 'planner', 1200, 0, 150, 0.00026999999999999995],
  ['chat planner, cached 512', 'gpt-4o-mini', 'business-os-chat', 'planner', 1200, 512, 150, 0.00023159999999999996],
  ['chat planner, odd cached 301 (Math.round)', 'gpt-4o-mini', 'business-os-chat', 'planner', 1200, 301, 150, 0.0002475],
  ['chat planner, cached above prompt (clamp)', 'gpt-4o-mini', 'business-os-chat', 'planner', 1200, 2000, 150, 0.00017999999999999998],
  ['insight content', 'gpt-4o-mini', 'business-os-insights', 'insight_content', 1200, 512, 150, 0.00023159999999999996],
  ['briefing narration', 'gpt-4o-mini', 'business-os-briefing', 'daily_narration', 1200, undefined, 150, 0.00026999999999999995],
  ['lead reply', 'gpt-4o-mini', 'business-os-leads', 'reply_recommendation', 1200, 301, 150, 0.0002475],
  ['website full site, cached 1024', 'gpt-4o', 'business-os-website', 'full_site', 3000, 1024, 800, 0.01422],
  ['intake form, no cache', 'gpt-4o', 'business-os-intake', 'form_generation', 3000, 0, 800, 0.0155],
  ['onboarding extraction, cached 1024', 'gpt-4o', 'business-os-onboarding', 'business_story_extraction', 3000, 1024, 800, 0.01422],
];

describe('P-1 / P-1b token calls cost exactly what they cost today', () => {
  it('the reference formula reproduces every golden literal', () => {
    for (const [, model, , , prompt, cached, completion, golden] of TOKEN_GOLDEN) {
      expect(todayChatCost(model, prompt, cached ?? 0, completion)).toBe(golden);
    }
  });

  it.each(['cold', 'warm'] as const)('%s instance: ledger cost and scope cost equal the golden literal', async (state) => {
    const m = freshInstance();
    if (state === 'warm') await warm(m);
    for (const [label, model, feature, component, prompt, cached, completion, golden] of TOKEN_GOLDEN) {
      trackAICall.mockClear();
      const calls = await chat(m, model, feature, component, chatUsage(prompt, cached, completion));
      expect({ label, ledger: ledgerCosts() }).toEqual({ label, ledger: [golden] });
      expect({ label, scope: calls.map((c) => c.costUsd), status: calls.map((c) => c.pricing?.status) }).toEqual({
        label,
        scope: [golden],
        status: ['priced'],
      });
    }
  });

  it('P-1c: the database down gives the same costs (in-code fallback)', async () => {
    mockDb.failing.add('ai_model_pricing');
    const m = freshInstance();
    await warm(m);
    for (const [label, model, feature, component, prompt, cached, completion, golden] of TOKEN_GOLDEN) {
      trackAICall.mockClear();
      await chat(m, model, feature, component, chatUsage(prompt, cached, completion));
      expect({ label, ledger: ledgerCosts() }).toEqual({ label, ledger: [golden] });
    }
  });

  it('P-1d: warm and cold are bit-identical for every live Business OS model', async () => {
    const cold = freshInstance();
    const warmInstance = freshInstance();
    await warm(warmInstance);
    for (const [, model, feature, component, prompt, cached, completion] of TOKEN_GOLDEN) {
      trackAICall.mockClear();
      await chat(cold, model, feature, component, chatUsage(prompt, cached, completion));
      const coldCost = ledgerCosts()[0];
      trackAICall.mockClear();
      await chat(warmInstance, model, feature, component, chatUsage(prompt, cached, completion));
      expect(Object.is(ledgerCosts()[0], coldCost)).toBe(true);
    }
  });

  it('usage missing: costs 0 and is still priced', async () => {
    const m = freshInstance();
    const calls = await chat(m, 'gpt-4o', 'business-os-intake', 'form_generation', undefined);
    expect(ledgerCosts()).toEqual([0]);
    expect(calls[0].pricing?.status).toBe('priced');
  });

  it('an unpriced model: costs 0, unpriced, and warns exactly once', async () => {
    const m = freshInstance();
    await warm(m);
    mockLogged.length = 0;
    const calls = await chat(m, 'gpt-imaginary', 'business-os-chat', 'planner', chatUsage(1200, 200, 300));
    expect(ledgerCosts()).toEqual([0]);
    expect(calls[0].pricing?.status).toBe('unpriced');
    expect(mockLogged.filter((line) => line.msg === NO_PRICE_WARN)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// P-2: embeddings
// ---------------------------------------------------------------------------

describe('P-2 embeddings cost exactly what they cost today', () => {
  const GOLDEN: Array<[number, number]> = [
    [37, 7.4e-7],
    [8191, 0.00016382000000000004],
  ];

  it('the reference reproduces the golden literals', () => {
    for (const [tokens, golden] of GOLDEN) {
      expect((tokens / 1000) * RATE['text-embedding-3-small'].input + (0 / 1000) * RATE['text-embedding-3-small'].output).toBe(golden);
    }
  });

  it.each([
    ['cold, row present', false, false],
    ['warm, row present', true, false],
    ['warm, row absent', true, true],
  ] as const)('%s: createEmbedding charges the golden literal', async (_label, isWarm, removeRow) => {
    if (removeRow) mockDb.tables.ai_model_pricing = mockDb.tables.ai_model_pricing.filter((r) => r.model_name !== 'text-embedding-3-small');
    const m = freshInstance();
    if (isWarm) await warm(m);
    for (const [tokens, golden] of GOLDEN) {
      trackAICall.mockClear();
      mockEmbeddingsCreate.mockResolvedValueOnce({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: tokens, total_tokens: tokens } });
      const calls = await scoped(m, () =>
        m.provider.createEmbedding(
          { model: 'text-embedding-3-small', input: 'q' },
          { userId: USER, sessionId: GROUP, feature: 'business-os-chat', component: 'plan_cache_lookup_embedding' }
        )
      );
      expect(ledgerCosts()).toEqual([golden]);
      expect(calls.map((c) => [c.costUsd, c.pricing?.status])).toEqual([[golden, 'priced']]);
    }
  });

  it('EmbeddingService reports the same figure the ledger charged', async () => {
    const m = freshInstance();
    const { supabaseServer } = require('@/lib/supabaseServer');
    const service = new m.embeddings.EmbeddingService('unused', supabaseServer);
    for (const [tokens, golden] of GOLDEN) {
      trackAICall.mockClear();
      mockEmbeddingsCreate.mockResolvedValueOnce({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: tokens, total_tokens: tokens } });
      const result = await service.generateEmbedding('a question', { userId: USER, feature: 'business-os-chat', turnId: GROUP, callName: 'plan_cache_lookup_embedding' });
      expect([result.cost, ledgerCosts()[0]]).toEqual([golden, golden]);
    }
  });
});

// ---------------------------------------------------------------------------
// P-3: images
// ---------------------------------------------------------------------------

const OWNER = { userId: USER, groupId: GROUP };
/** A different prompt per image, with no word the people filter refuses ("portrait" is one). */
let promptCounter = 0;

async function generate(m: ReturnType<typeof freshInstance>, aspect: 'square' | 'portrait' | 'wide', reported: string | undefined) {
  mockGenerate.mockResolvedValueOnce({
    created: 1,
    ...(reported === undefined ? {} : { quality: reported }),
    data: [{ b64_json: Buffer.from('png').toString('base64') }],
  });
  return scoped(m, () => m.images.generateImage(OWNER, `A quiet oak desk, take ${(promptCounter += 1)}`, aspect, 'hero'));
}

describe('P-3 images cost exactly what they cost today', () => {
  const QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
  const ASPECTS = ['square', 'portrait', 'wide'] as const;

  it('every size and reported quality of the live model is charged the literal price', async () => {
    const m = freshInstance();
    for (const aspect of ASPECTS) {
      for (const quality of QUALITIES) {
        trackAICall.mockClear();
        const calls = await generate(m, aspect, quality);
        expect({ aspect, quality, ledger: ledgerCosts() }).toEqual({ aspect, quality, ledger: [FLARE_USD[aspect][quality]] });
        expect({ aspect, quality, status: calls.map((c) => c.pricing?.status) }).toEqual({ aspect, quality, status: ['priced'] });
      }
    }
  });

  it('the live image model and request: gpt-image-2.5-flare at high, sizes by aspect', async () => {
    const m = freshInstance();
    await generate(m, 'wide', 'high');
    const request = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
    expect([request.model, request.size, request.quality, request.n]).toEqual(['gpt-image-2.5-flare', '1536x1024', 'high', 1]);
    expect((trackAICall.mock.calls[0][0] as AICallData).model_name).toBe('gpt-image-2.5-flare');
  });

  it('an unreported quality is priced as high', async () => {
    const m = freshInstance();
    for (const aspect of ASPECTS) {
      trackAICall.mockClear();
      await generate(m, aspect, undefined);
      expect(ledgerCosts()).toEqual([FLARE_USD[aspect].high]);
    }
  });

  it('a reported quality other than the requested one is priced by the reported one', async () => {
    const m = freshInstance();
    await generate(m, 'square', 'medium');
    expect(ledgerCosts()).toEqual([0.015]);
  });

  it('P-3b: a key priced nowhere records $0, unpriced, with one error log', async () => {
    const m = freshInstance();
    mockLogged.length = 0;
    const calls = await generate(m, 'square', 'ultra');
    expect(ledgerCosts()).toEqual([0]);
    expect(calls.map((c) => c.pricing?.status)).toEqual(['unpriced']);
    expect(mockLogged.filter((line) => line.level === 'error' && line.fields.quality === 'ultra')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// P-4: the Layer 2 guardrail
// ---------------------------------------------------------------------------

describe('P-4 the Layer 2 guardrail gives the same verdicts', () => {
  it('the live image model passes; an image model priced nowhere is refused', async () => {
    const m = freshInstance();
    const flare = await m.settings.validateAreaRow('images', { model: 'gpt-image-2.5-flare' });
    expect(flare.ok).toBe(true);
    const sunburst = await m.settings.validateAreaRow('images', { model: 'gpt-image-2.5-sunburst' });
    expect(sunburst.ok).toBe(false);
    expect(sunburst.rejected.map((issue) => [issue.field, issue.reason])).toEqual([['model', 'image_price_missing']]);
  });

  it('a priced token model passes; an unpriced one is refused', async () => {
    const m = freshInstance();
    expect((await m.settings.validateAreaRow('insights', { model: 'gpt-4o' })).ok).toBe(true);
    const unpriced = await m.settings.validateAreaRow('insights', { model: 'gpt-imaginary' });
    expect(unpriced.ok).toBe(false);
    // One issue per insights call that inherits the area-level model.
    expect(unpriced.rejected.map((issue) => issue.reason)).toEqual(['unpriced_model', 'unpriced_model', 'unpriced_model', 'unpriced_model']);
  });
});

// ---------------------------------------------------------------------------
// P-5, P-6: the charge and the conservative rate
// ---------------------------------------------------------------------------

describe('P-5 / P-6 the action charge and the conservative rate', () => {
  it('P-5: one action of each kind is charged the same', async () => {
    const m = freshInstance();
    const records: UsageCallRecord[] = [];
    records.push(...(await chat(m, 'gpt-4o-mini', 'business-os-chat', 'planner', chatUsage(1200, 301, 150))));
    records.push(...(await chat(m, 'gpt-imaginary', 'business-os-chat', 'planner', chatUsage(1200, 200, 300))));
    mockEmbeddingsCreate.mockResolvedValueOnce({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 37, total_tokens: 37 } });
    records.push(
      ...(await scoped(m, () =>
        m.provider.createEmbedding(
          { model: 'text-embedding-3-small', input: 'q' },
          { userId: USER, sessionId: GROUP, feature: 'business-os-chat', component: 'plan_cache_lookup_embedding' }
        )
      ))
    );
    records.push(...(await generate(m, 'square', 'high')));
    records.push(...(await generate(m, 'square', 'ultra')));

    const priced = m.charge.priceActionForCharge(records);
    expect(priced.calls.map((c) => [c.kind, c.basis, c.costUsd])).toEqual([
      ['text', 'measured', 0.0002475],
      ['text', 'conservative_fallback', 0.09],
      ['embedding', 'measured', 7.4e-7],
      ['image', 'measured', 0.054],
      ['image', 'conservative_fallback', 0.212],
    ]);
    expect([priced.isFallbackPriced, priced.fallbackCallCount]).toEqual([true, 2]);
    expect(priced.costUsd).toBe(0.35624824);
  });

  it('P-6: the conservative rates come from the in-code tables, whatever the database holds', async () => {
    // A database that disagrees wildly: a huge token price with a cached rate, and an image row.
    mockDb.tables.ai_model_pricing.push({
      id: 'x1', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.5, output_cost_per_token: 0.9,
      effective_date: '2026-10-15', retired_date: null, created_at: '2026-10-16T00:00:00+00:00',
      cached_input_cost_per_token: 0.1, proposal_id: null, proposal_line_id: null,
    });
    mockDb.tables.ai_model_image_pricing = [
      { id: 'i1', provider: 'openai', model_name: 'gpt-image-2.5-flare', size: '1024x1024', quality: 'max', cost_per_image: 9, effective_date: '2026-10-15', retired_date: null, created_at: '2026-10-16T00:00:00+00:00', proposal_id: null, proposal_line_id: null },
    ];
    const m = freshInstance();
    await warm(m);
    await generate(m, 'square', 'low');
    const byKind = m.charge
      .conservativeRateDerivation()
      .filter((rate) => rate.provider === 'openai' || rate.provider === '*')
      .map((rate) => [rate.kind, rate.provider, rate.inputPer1k ?? null, rate.outputPer1k ?? null, rate.perImage ?? null, rate.imageFrom ?? null]);
    expect(byKind).toEqual([
      ['text', 'openai', 0.03, 0.18, null, null],
      ['embedding', 'openai', 0.00013, null, null, null],
      ['text', '*', 0.03, 0.18, null, null],
      ['embedding', '*', 0.00013, null, null, null],
      ['image', '*', null, null, 0.212, 'gpt-image-2.5-flare:1024x1024:max'],
    ]);
  });
});
