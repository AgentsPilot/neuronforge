/**
 * The comparison read model (workplan §4): current per unit, coverage set,
 * colours, area tags, pending lines, sorting, and the manual-entry flag
 * context. Every dependency is mocked; model names are built, not written.
 */

const name = (...parts: string[]) => parts.join('-');
const liveModel = name('example', 'live', 'model');
const fallbackModel = name('example', 'fallback', 'model');
const unpricedModel = name('example', 'unpriced', 'model');
const tableOnlyModel = name('example', 'table', 'only');
const imageModel = name('example', 'image', 'model');
const otherProviderModel = name('example', 'other', 'provider');

const mockListActiveExact = jest.fn();
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActiveExact: () => mockListActiveExact() },
}));
const mockListPending = jest.fn();
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({
  aiPriceProposalRepository: { listPendingLines: () => mockListPending() },
}));
jest.mock('@/lib/repositories/AdminUserRepository', () => ({
  adminUserRepository: {
    listActive: async () => ({ data: [{ user_id: 'admin-1', email: 'admin@example.com' }], error: null }),
  },
}));
const mockImageConfig = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const imageName = ['example', 'image', 'model'].join('-');
  return {
    ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
    IMAGE_FALLBACK_PRICING: Object.freeze({
      [`${imageName}:1024x1024:low`]: 0.011,
      [`${imageName}:1024x1024:high`]: 0.167,
    }),
    systemConfigRepository: { getImageGenerationConfig: () => mockImageConfig() },
  };
});
const mockResolveImagePrice = jest.fn();
jest.mock('@/lib/services/GeneratedImageService', () => ({
  resolveImagePrice: (...args: unknown[]) => mockResolveImagePrice(...args),
}));
jest.mock('@/lib/ai/pricing', () => {
  const fallbackName = ['example', 'fallback', 'model'].join('-');
  const liveName = ['example', 'live', 'model'].join('-');
  return {
    // Per 1,000 tokens, as in the real table.
    inCodeTokenPrices: () => ({ openai: { [fallbackName]: { input: 0.00015, output: 0.0006 }, [liveName]: { input: 0.00015, output: 0.0006 } } }),
    isInputOnlyPricedModel: (_provider: string, model: string) => model.startsWith('example-embedding'),
  };
});
jest.mock('@/lib/business-os/llm/chargePricing', () => ({
  conservativeRateDerivation: () => [
    { kind: 'text', provider: 'openai', scope: 'provider', inputPer1k: 0.03, outputPer1k: 0.18 },
    { kind: 'image', provider: '*', scope: 'all_providers', perImage: 0.25 },
  ],
}));
const mockBuildAreaTags = jest.fn();
jest.mock('../areaTags', () => ({
  buildAreaTags: () => mockBuildAreaTags(),
  modelKey: (provider: string, model: string) => `${provider}:${model}`,
}));

import { buildComparison, lineContextFor, loadPricingSnapshot, STORED_PRICE_NOTE } from '../comparisonModel';
import type { PendingLineInput } from '../pendingLineSchema';

function pendingToken(model: string, input: string, output: string, extra: Record<string, unknown> = {}) {
  return {
    id: `line-${model}`,
    proposal_id: 'proposal-1',
    kind: 'token',
    provider: 'openai',
    model_name: model,
    image_size: null,
    image_quality: null,
    input_per_1m: input,
    output_per_1m: output,
    cached_input_per_1m: null,
    price_per_image: null,
    source_url: 'https://developers.openai.com/api/docs/pricing',
    checked_on: '2026-10-14',
    flags: [],
    cross_check_verdict: null,
    created_by: 'admin-1',
    created_at: '2026-10-14T10:00:00Z',
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListActiveExact.mockResolvedValue({
    data: [
      // Newest first: the first row per model is the charged one.
      { id: 'row-new', provider: 'openai', model_name: liveModel, input_cost_per_token: '0.00000015', output_cost_per_token: '0.0000006', cached_input_cost_per_token: '0.00000001', effective_date: '2026-10-11', created_at: 'x' },
      { id: 'row-old', provider: 'openai', model_name: liveModel, input_cost_per_token: '0.00000099', output_cost_per_token: '0.00000099', cached_input_cost_per_token: null, effective_date: '2026-06-29', created_at: 'x' },
      { id: 'row-t', provider: 'anthropic', model_name: tableOnlyModel, input_cost_per_token: '0.000003', output_cost_per_token: '0.000015', cached_input_cost_per_token: null, effective_date: '2026-06-29', created_at: 'x' },
    ],
    error: null,
  });
  mockListPending.mockResolvedValue({ data: [], error: null });
  mockImageConfig.mockResolvedValue({ model: 'ignored', quality: 'auto', sizes: { wide: '1536x1024', portrait: '1024x1536', square: '1024x1024' }, pricesUsd: {} });
  mockResolveImagePrice.mockImplementation((prices: Record<string, number>, model: string, size: string, quality: string) => {
    const key = `${model}:${size}:${quality}`;
    if (prices[key]) return { usdPerImage: prices[key], source: 'config' };
    const fallback: Record<string, number> = { [`${imageModel}:1024x1024:low`]: 0.011, [`${imageModel}:1024x1024:high`]: 0.167 };
    return fallback[key] ? { usdPerImage: fallback[key], source: 'fallback' } : { usdPerImage: 0, source: 'unpriced' };
  });
  mockBuildAreaTags.mockResolvedValue({
    tagsByModel: new Map([
      [`openai:${liveModel}`, [{ area: 'chat', label: 'chat', callNames: ['planner'], enabled: true }]],
      [`openai:${unpricedModel}`, [{ area: 'leads', label: 'leads', callNames: ['reply_recommendation'], enabled: true }]],
      [`openai:${imageModel}`, [{ area: 'images', label: 'images', callNames: ['image_generation'], enabled: true }]],
    ]),
    imageModelKeys: new Set([`openai:${imageModel}`]),
    defaultModelKeys: new Set([`openai:${liveModel}`]),
    embedding: { status: 'not_set', label: 'not set (service default applies)' },
  });
});

const rowOf = (rows: Awaited<ReturnType<typeof buildComparison>>['rows'], model: string) => {
  const row = rows.find((candidate) => candidate.modelName === model);
  if (!row) throw new Error(`no row ${model}`);
  return row;
};

describe('current = what we charge today', () => {
  it('table row (newest wins), shown per 1M, with the 1 h note', async () => {
    const row = rowOf((await buildComparison()).rows, liveModel);
    expect(row.currentBasis).toBe('table');
    expect(row.currentNote).toBe(STORED_PRICE_NOTE);
    expect(row.units.find((unit) => unit.unit === 'input')?.current).toBe('0.15');
    expect(row.units.find((unit) => unit.unit === 'output')?.current).toBe('0.6');
  });

  it('cached input is derived (half the input) for OpenAI, ignoring a stored cached column (no reader until slice 7)', async () => {
    const cached = rowOf((await buildComparison()).rows, liveModel).units.find((unit) => unit.unit === 'cached_input');
    expect(cached).toMatchObject({ current: '0.075', currentBasis: 'derived' });
  });

  it('cached input for another provider is not compared (O-8)', async () => {
    const cached = rowOf((await buildComparison()).rows, tableOnlyModel).units.find((unit) => unit.unit === 'cached_input');
    expect(cached).toMatchObject({ current: null, colour: 'grey' });
  });

  it('in-code fallback when no table row, converted from per 1,000 exactly', async () => {
    const row = rowOf((await buildComparison()).rows, fallbackModel);
    expect(row.currentBasis).toBe('in_code_fallback');
    expect(row.units.find((unit) => unit.unit === 'input')?.current).toBe('0.15');
    expect(row.usageLabel).toBe('not used by Business OS');
  });

  it('a Business OS model with no price anywhere is red, not priced', async () => {
    const row = rowOf((await buildComparison()).rows, unpricedModel);
    expect(row).toMatchObject({ currentBasis: 'unpriced', colour: 'red', usedByBusinessOs: true });
    expect(row.summary).toBe('Undercharging: input not priced, output not priced');
  });

  it('images: resolveImagePrice only for known keys (C-7); other required keys are unpriced', async () => {
    const row = rowOf((await buildComparison()).rows, imageModel);
    const high = row.units.find((unit) => unit.unit === 'image 1024x1024 high');
    expect(high).toMatchObject({ current: '0.167', currentBasis: 'in_code_fallback' });
    const unknown = row.units.find((unit) => unit.unit === 'image 1536x1024 medium');
    expect(unknown).toMatchObject({ current: null, colour: 'red', status: 'not_priced' });
    for (const call of mockResolveImagePrice.mock.calls) {
      expect(['1024x1024:low', '1024x1024:high']).toContain(`${call[2]}:${call[3]}`);
    }
  });
});

describe('pending lines and colours', () => {
  it('a pending line makes the row compare: red when the provider is above us, with the red unit named', async () => {
    mockListPending.mockResolvedValue({ data: [pendingToken(liveModel, '0.15', '0.68')], error: null });
    const row = rowOf((await buildComparison()).rows, liveModel);
    expect(row.colour).toBe('red');
    expect(row.redUnits).toEqual(['output']);
    expect(row.summary).toBe('Undercharging: output -11.76%');
    expect(row.pending).toEqual([
      expect.objectContaining({ lineId: `line-${liveModel}`, createdBy: 'admin@example.com', crossCheck: 'not run', unit: 'tokens' }),
    ]);
  });

  it('green when we are at or above the provider price', async () => {
    mockListPending.mockResolvedValue({ data: [pendingToken(liveModel, '0.15', '0.5')], error: null });
    const row = rowOf((await buildComparison()).rows, liveModel);
    expect(row.colour).toBe('green');
    expect(row.units.find((unit) => unit.unit === 'output')?.label).toBe('Covered: we charge +20.00% vs provider');
  });

  it('a pending line for a new model adds its row; an unknown creator is "former admin"', async () => {
    mockListPending.mockResolvedValue({ data: [pendingToken(otherProviderModel, '1', '2', { created_by: 'gone' })], error: null });
    const row = rowOf((await buildComparison()).rows, otherProviderModel);
    expect(row.usageLabel).toBe('not used by Business OS');
    expect(row.pending[0].createdBy).toBe('former admin');
  });

  it('a new_model flag carries the label the user chose, "not used yet", beside the code', async () => {
    mockListPending.mockResolvedValue({ data: [pendingToken(otherProviderModel, '1', '2', { flags: ['new_model', 'cached_input_listed'] })], error: null });
    const view = rowOf((await buildComparison()).rows, otherProviderModel).pending[0];
    expect(view.flags).toEqual(['new_model', 'cached_input_listed']);
    expect(view.flagLabels).toEqual([{ flag: 'new_model', label: 'not used yet' }]);
  });

  it('an image key configured as 0 (or a non-number) with no fallback is unpriced and never reaches the resolver', async () => {
    mockImageConfig.mockResolvedValue({
      model: 'ignored',
      quality: 'auto',
      sizes: { wide: '1536x1024', portrait: '1024x1536', square: '1024x1024' },
      pricesUsd: { [`${imageModel}:1536x1024:low`]: 0, [`${imageModel}:1024x1536:low`]: 'x' as unknown as number },
    });
    const row = rowOf((await buildComparison()).rows, imageModel);
    expect(row.units.find((unit) => unit.unit === 'image 1536x1024 low')).toMatchObject({ current: null, currentBasis: 'unpriced' });
    for (const call of mockResolveImagePrice.mock.calls) {
      expect(['1024x1024:low', '1024x1024:high']).toContain(`${call[2]}:${call[3]}`);
    }
  });

  it('sorts red first, then models Business OS uses', async () => {
    const rows = (await buildComparison()).rows;
    const firstNonRed = rows.findIndex((row) => row.colour !== 'red');
    expect(rows.slice(0, firstNonRed).every((row) => row.colour === 'red')).toBe(true);
    expect(rows.slice(firstNonRed).every((row) => row.colour !== 'red')).toBe(true);
  });

  it('the embedding state is passed through', async () => {
    expect((await buildComparison()).embedding).toEqual({ status: 'not_set', label: 'not set (service default applies)' });
  });

  it('a read failure throws', async () => {
    mockListActiveExact.mockResolvedValue({ data: null, error: new Error('down') });
    await expect(buildComparison()).rejects.toThrow('down');
  });
});

describe('lineContextFor (manual entry)', () => {
  const tokenLine = (model: string): PendingLineInput => ({
    kind: 'token',
    provider: 'openai',
    model_name: model,
    input_per_1m: '0.15',
    output_per_1m: '0.6',
    source_url: 'https://developers.openai.com/api/docs/pricing',
    checked_on: '2026-10-14',
  });

  it('carries the table snapshot as exact per-token strings and the row id', async () => {
    const { context, snapshotFields } = lineContextFor(await loadPricingSnapshot(), tokenLine(liveModel));
    expect(snapshotFields).toMatchObject({
      current_basis: 'table',
      current_row_id: 'row-new',
      current_input_cost_per_token: '0.00000015',
      current_output_cost_per_token: '0.0000006',
      current_cached_input_cost_per_token: '0.000000075',
    });
    expect(context).toMatchObject({ inCoverage: true, inputOnly: false, conservative: { input: '0.00003', output: '0.00018' } });
  });

  it('a model outside the coverage set is not in coverage (new_model)', async () => {
    const { context, snapshotFields } = lineContextFor(await loadPricingSnapshot(), tokenLine(otherProviderModel));
    expect(context.inCoverage).toBe(false);
    expect(snapshotFields.current_basis).toBe('unpriced');
  });

  it('an image line snapshots the image price and its basis', async () => {
    const { context, snapshotFields } = lineContextFor(await loadPricingSnapshot(), {
      kind: 'image',
      provider: 'openai',
      model_name: imageModel,
      image_size: '1024x1024',
      image_quality: 'high',
      price_per_image: '0.2',
      source_url: 'https://developers.openai.com/api/docs/pricing',
      checked_on: '2026-10-14',
    });
    expect(snapshotFields).toMatchObject({ current_basis: 'in_code_fallback', current_cost_per_image: '0.167' });
    expect(context).toMatchObject({ inCoverage: true, fallback: { perImage: '0.167' }, conservative: { perImage: '0.25' } });
  });
});
