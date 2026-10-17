/**
 * The comparison's "current" equals what charging charges, for the same rows
 * (AI model price review slice 7, SA RC7-7 truth test).
 *
 * The comparison reads fresh exact rows (`listActiveExact`); charging reads the
 * cached rows (`listActive`, numbers). Both are fed the SAME production-shaped
 * rows here, and the real charging code (`lib/ai/pricing.ts`,
 * `lib/ai/imagePricing.ts`, `GeneratedImageService.resolveImagePrice`) runs.
 * Offline: every repository is mocked.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const name = (...parts: string[]) => parts.join('-');
const chatModel = name('example', 'chat', 'model');
const derivedModel = name('example', 'derived', 'model');
const imageModel = name('example', 'image', 'model');
const anthropicModel = name('example', 'anthropic', 'model');

/** Token rows as both reads return them: numbers for the billing reader, text for the comparison. */
const TOKEN_ROWS = [
  { id: 'tok-cached', provider: 'openai', model_name: chatModel, input: 0.0000025, output: 0.00001, cached: 0.00000125, inputText: '0.0000025', outputText: '0.00001', cachedText: '0.00000125' },
  { id: 'tok-zero', provider: 'openai', model_name: derivedModel, input: 1.5e-7, output: 6e-7, cached: 0, inputText: '0.00000015', outputText: '0.0000006', cachedText: '0' },
  // SA F-1: a cached rate on a provider whose charge never reads it.
  { id: 'tok-anthropic', provider: 'anthropic', model_name: anthropicModel, input: 0.000003, output: 0.000015, cached: 3e-7, inputText: '0.000003', outputText: '0.000015', cachedText: '0.0000003' },
];
const IMAGE_ROWS = [
  { id: 'img-new', provider: 'openai', model_name: imageModel, size: '1024x1024', quality: 'high', cost: 0.061, costText: '0.061', effective_date: '2026-10-16', created_at: '2026-10-16T01:00:00Z' },
  { id: 'img-old', provider: 'openai', model_name: imageModel, size: '1024x1024', quality: 'high', cost: 0.05, costText: '0.05', effective_date: '2026-10-01', created_at: '2026-10-01T01:00:00Z' },
];

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: {
    listActive: async () => ({
      data: TOKEN_ROWS.map((r) => ({
        id: r.id, provider: r.provider, model_name: r.model_name, input_cost_per_token: r.input, output_cost_per_token: r.output,
        cached_input_cost_per_token: r.cached, effective_date: '2026-10-16', retired_date: null, created_at: 'x',
      })),
      error: null,
    }),
    listActiveExact: async () => ({
      data: TOKEN_ROWS.map((r) => ({
        id: r.id, provider: r.provider, model_name: r.model_name, input_cost_per_token: r.inputText, output_cost_per_token: r.outputText,
        cached_input_cost_per_token: r.cachedText, effective_date: '2026-10-16', created_at: 'x',
      })),
      error: null,
    }),
  },
}));
jest.mock('@/lib/repositories/AiModelImagePricingRepository', () => ({
  aiModelImagePricingRepository: {
    listActive: async () => ({
      data: IMAGE_ROWS.map((r) => ({ id: r.id, provider: r.provider, model_name: r.model_name, size: r.size, quality: r.quality, cost_per_image: r.cost, effective_date: r.effective_date, created_at: r.created_at })),
      error: null,
    }),
    listActiveExact: async () => ({
      data: IMAGE_ROWS.map((r) => ({ id: r.id, provider: r.provider, model_name: r.model_name, size: r.size, quality: r.quality, cost_per_image: r.costText, effective_date: r.effective_date, created_at: r.created_at })),
      error: null,
    }),
  },
}));
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: { listPendingLines: async () => ({ data: [], error: null }) },
}));
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: { listActive: async () => ({ data: [], error: null }) },
}));
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
  systemConfigRepository: {
    // The setting holds a price that would win before slice 7; it must be ignored now (O-1).
    getImageGenerationConfig: async () => ({
      model: 'ignored',
      quality: 'high',
      sizes: { wide: '1024x1024', portrait: '1024x1024', square: '1024x1024' },
      pricesUsd: { [['example', 'image', 'model'].join('-') + ':1024x1024:high']: 9 },
    }),
  },
}));
jest.mock('../areaTags', () => ({
  buildAreaTags: async () => ({
    tagsByModel: new Map(),
    imageModelKeys: new Set([`openai:${['example', 'image', 'model'].join('-')}`]),
    defaultModelKeys: new Set(),
    embedding: { status: 'not_set', label: 'not set (service default applies)' },
  }),
  modelKey: (provider: string, model: string) => `${provider}:${model}`,
}));

import { buildComparison, lineContextFor, loadPricingSnapshot } from '../comparisonModel';
import { calculateCostSync, calculateCostWithCachedSync, refreshPricingCache } from '@/lib/ai/pricing';
import { __resetImagePricesForTests, loadImagePrices } from '@/lib/ai/imagePricing';
import { resolveImagePrice } from '@/lib/services/GeneratedImageService';

beforeEach(() => __resetImagePricesForTests());

const unit = (rows: Awaited<ReturnType<typeof buildComparison>>['rows'], model: string, unitName: string) =>
  rows.find((row) => row.modelName === model)?.units.find((u) => u.unit === unitName);

it('cached input: a stored rate is current AND charged; a stored 0 is derived in both', async () => {
  await refreshPricingCache();
  const rows = (await buildComparison()).rows;

  // One million cached tokens and nothing else: the charge is the per-1M cached rate.
  const million = { promptTokens: 1_000_000, cachedTokens: 1_000_000, completionTokens: 0, derivedCachedTokens: 500_000 };

  const stored = unit(rows, chatModel, 'cached_input');
  expect(stored).toMatchObject({ current: '1.25', currentBasis: 'table' });
  expect(calculateCostWithCachedSync('openai', chatModel, million)).toBeCloseTo(Number(stored?.current), 12);

  const derived = unit(rows, derivedModel, 'cached_input');
  expect(derived).toMatchObject({ current: '0.075', currentBasis: 'derived' });
  expect(calculateCostWithCachedSync('openai', derivedModel, million)).toBeCloseTo(Number(derived?.current), 12);
});

it('SA F-1: a cached rate on a non-OpenAI row is neither current nor charged', async () => {
  await refreshPricingCache();
  const rows = (await buildComparison()).rows;

  // Not shown as a stored, charged rate: only OpenAI's charge reads the column.
  const cached = unit(rows, anthropicModel, 'cached_input');
  expect(cached?.currentBasis).not.toBe('table');
  expect(cached).toMatchObject({ current: null, currentBasis: 'unpriced' });

  // And charging ignores it: Anthropic is charged through calculateCostSync,
  // which prices every input token at the input rate whatever the column holds.
  expect(calculateCostSync('anthropic', anthropicModel, 1_000_000, 0)).toBeCloseTo(3, 12);
});

it('image: the newest table row is current AND charged, and the setting is ignored by both', async () => {
  const rows = (await buildComparison()).rows;
  const current = unit(rows, imageModel, 'image 1024x1024 high');
  expect(current).toMatchObject({ current: '0.061', currentBasis: 'table' });

  const table = await loadImagePrices();
  expect(resolveImagePrice(table, imageModel, '1024x1024', 'high')).toEqual({ usdPerImage: 0.061, source: 'table' });
  expect(Number(current?.current)).toBe(0.061);
});

it('a manual image line snapshots the table basis with the image row id', async () => {
  const { snapshotFields } = lineContextFor(await loadPricingSnapshot(), {
    kind: 'image',
    provider: 'openai',
    model_name: imageModel,
    image_size: '1024x1024',
    image_quality: 'high',
    price_per_image: '0.07',
    source_url: 'https://developers.openai.com/api/docs/guides/image-generation',
    checked_on: '2026-10-16',
  });
  expect(snapshotFields).toMatchObject({ current_basis: 'table', current_row_id: 'img-new', current_cost_per_image: '0.061' });
});
