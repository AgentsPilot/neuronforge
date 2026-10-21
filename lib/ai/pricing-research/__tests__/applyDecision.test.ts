/**
 * The route-side checks of Apply (AI model price review slice 8; SA RC-6, RC-7,
 * slice 7 F-1, user decisions B-1..B-3). Pure: the snapshot is built here and
 * the real `tokenCurrent` / `lineContextFor` run against it.
 *
 * RC-6 PARITY: the cached-input rate charged today has three statements of the
 * same rule, and they must agree on column NULL, 0 and above 0, on OpenAI and on
 * another provider, including an input with an odd last digit:
 *   1. `chargedCachedInput` (this module, the route side);
 *   2. `tokenCurrent` (slice 7's comparison, which records the snapshot);
 *   3. the SQL CASE of `ai_price_apply_lines` (pinned as text by the slice 8
 *      migration test, and run on the same values by its probe, P04 to P06).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));
jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({ aiModelPricingRepository: {} }));
jest.mock('@/lib/repositories/AiModelImagePricingRepository', () => ({ aiModelImagePricingRepository: {} }));
jest.mock('@/lib/repositories/AiPriceProposalRepository', () => ({ aiPriceProposalRepository: {} }));
jest.mock('@/lib/repositories/AiPriceApplyRepository', () => ({ aiPriceApplyRepository: {} }));
jest.mock('@/lib/repositories/AdminUserRepository', () => ({ adminUserRepository: {} }));
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
  IMAGE_FALLBACK_PRICING: Object.freeze({ 'example-image:1024x1024:high': 0.167 }),
  systemConfigRepository: {},
}));
jest.mock('@/lib/ai/pricing', () => ({
  inCodeTokenPrices: () => ({}),
  isInputOnlyPricedModel: () => false,
}));
jest.mock('@/lib/business-os/llm/chargePricing', () => ({
  conservativeRateDerivation: () => [{ kind: 'text', provider: 'openai', scope: 'provider', inputPer1k: 0.03, outputPer1k: 0.18 }],
}));
jest.mock('../areaTags', () => ({
  buildAreaTags: jest.fn(),
  modelKey: (provider: string, model: string) => `${provider}:${model}`,
}));

import { chargedCachedInput, isLineStale, marginItemsFor, reviewLineForApply } from '../applyDecision';
import { tokenCurrent, type PricingSnapshot } from '../comparisonModel';
import type { AiModelImagePricingExactRow, AiModelPricingExactRow, AiPriceDecisionLine } from '@/lib/repositories/types';

function tokenRow(provider: string, model: string, input: string, cached: string | null, id = `row-${model}`): AiModelPricingExactRow {
  return { id, provider, model_name: model, input_cost_per_token: input, output_cost_per_token: '0.0000006', cached_input_cost_per_token: cached, effective_date: '2026-10-01', created_at: 'x' };
}

function snapshotOf(rows: AiModelPricingExactRow[], options: { inCode?: Array<[string, string, string]>; images?: AiModelImagePricingExactRow[]; tags?: Record<string, string[]> } = {}): PricingSnapshot {
  return {
    activeByKey: new Map(rows.map((row) => [`${row.provider}:${row.model_name}`, row])),
    inCodeByKey: new Map((options.inCode ?? []).map(([key, input, output]) => [key, { input, output }])),
    areas: {
      tagsByModel: new Map(Object.entries(options.tags ?? {}).map(([key, labels]) => [key, labels.map((label) => ({ area: 'chat' as const, label, callNames: ['x'], enabled: true }))])),
      imageModelKeys: new Set<string>(),
      defaultModelKeys: new Set<string>(),
      embedding: { status: 'not_set', label: 'x' },
    },
    imageRowsByKey: new Map((options.images ?? []).map((row) => [`${row.provider}:${row.model_name}:${row.size}:${row.quality}`, row])),
    imageSizes: ['1024x1024'],
    pending: [],
    adminEmailById: new Map(),
  };
}

function line(overrides: Partial<AiPriceDecisionLine> = {}): AiPriceDecisionLine {
  return {
    id: 'line-1',
    proposal_id: 'proposal-1',
    kind: 'token',
    provider: 'openai',
    model_name: 'example-model',
    image_size: null,
    image_quality: null,
    input_per_1m: '0.16',
    output_per_1m: '0.6',
    cached_input_per_1m: null,
    price_per_image: null,
    current_basis: 'table',
    current_row_id: 'row-example-model',
    current_input_cost_per_token: '0.00000015',
    current_output_cost_per_token: '0.0000006',
    current_cached_input_cost_per_token: '0.000000075',
    current_cost_per_image: null,
    source_url: 'https://developers.openai.com/api/docs/pricing',
    checked_on: '2026-10-17',
    flags: [],
    state: 'pending',
    created_by: 'admin-1',
    ...overrides,
  };
}

describe('RC-6 parity: the cached-input rate charged today', () => {
  it.each([
    ['openai, column NULL: half the input', 'openai', '0.00000015', null, '0.000000075'],
    ['openai, column 0 counts as unset', 'openai', '0.00000015', '0', '0.000000075'],
    ['openai, column above 0 is charged', 'openai', '0.00000015', '0.00000003', '0.00000003'],
    ['openai, an odd last digit halves exactly', 'openai', '0.000000000000003', null, '0.0000000000000015'],
    ['another provider: never charged, even when stored', 'anthropic', '0.000003', '0.0000003', null],
    ['another provider, column NULL', 'anthropic', '0.000003', null, null],
  ])('%s', (_label, provider, input, column, expected) => {
    expect(chargedCachedInput(provider, { input, cachedColumn: column })).toBe(expected);
    const current = tokenCurrent(snapshotOf([tokenRow(provider, 'example-model', input, column)]), provider, 'example-model');
    expect(current.cachedInput ?? null).toBe(expected);
  });
});

describe('isLineStale (the route layer; the function is the other)', () => {
  const live = snapshotOf([tokenRow('openai', 'example-model', '0.00000015', null)]);

  it('a matching table snapshot is not stale; equal values in another spelling still match', () => {
    expect(isLineStale(live, line())).toBe(false);
    expect(isLineStale(live, line({ current_input_cost_per_token: '0.000000150' }))).toBe(false);
  });

  it.each([
    ['another row is charged now', { current_row_id: 'row-other' }],
    ['the input changed', { current_input_cost_per_token: '0.00000016' }],
    ['the cached snapshot no longer matches (F-1)', { current_cached_input_cost_per_token: '0.00000003' }],
    ['a recorded fallback basis while a table row exists now', { current_basis: 'in_code_fallback' as const, current_row_id: null }],
    ['basis image_setting is always stale', { current_basis: 'image_setting' as const, current_row_id: null }],
  ])('stale: %s', (_label, overrides) => {
    expect(isLineStale(live, line(overrides))).toBe(true);
  });

  it('a stored cached rate above 0 is the current one (slice 7): a derived snapshot is stale', () => {
    const stored = snapshotOf([tokenRow('openai', 'example-model', '0.00000015', '0.00000003')]);
    expect(isLineStale(stored, line())).toBe(true);
    expect(isLineStale(stored, line({ current_cached_input_cost_per_token: '0.00000003' }))).toBe(false);
  });

  it('an in-code price that changed by a deploy is stale', () => {
    const fallback = snapshotOf([], { inCode: [['openai:example-model', '0.0000002', '0.0000006']] });
    const recorded = line({ current_basis: 'in_code_fallback', current_row_id: null, current_input_cost_per_token: '0.00000015', current_cached_input_cost_per_token: '0.000000075' });
    expect(isLineStale(fallback, recorded)).toBe(true);
    expect(isLineStale(fallback, { ...recorded, current_input_cost_per_token: '0.0000002', current_cached_input_cost_per_token: '0.0000001' })).toBe(false);
  });

  it('image lines: a changed stored image price is stale', () => {
    const images = snapshotOf([], {
      images: [{ id: 'image-row', provider: 'openai', model_name: 'example-image', size: '1024x1024', quality: 'high', cost_per_image: '0.2', effective_date: '2026-10-01', created_at: 'x' }],
    });
    const imageLine = line({
      kind: 'image',
      image_size: '1024x1024',
      image_quality: 'high',
      model_name: 'example-image',
      input_per_1m: null,
      output_per_1m: null,
      price_per_image: '0.25',
      current_row_id: 'image-row',
      current_input_cost_per_token: null,
      current_output_cost_per_token: null,
      current_cached_input_cost_per_token: null,
      current_cost_per_image: '0.2',
    });
    expect(isLineStale(images, imageLine)).toBe(false);
    expect(isLineStale(images, { ...imageLine, current_cost_per_image: '0.3' })).toBe(true);
  });
});

describe('reviewLineForApply (RC-7)', () => {
  const live = snapshotOf([tokenRow('openai', 'example-model', '0.00000015', null)]);

  it('a stored large_move the price no longer earns is a changed blocking flag', () => {
    expect(reviewLineForApply(live, line({ flags: ['large_move'] }))).toMatchObject({ blockingChanged: true, blockingFlags: ['large_move'] });
  });

  it('a large move that is still large is unchanged; cross-check flags are never recomputed', () => {
    expect(reviewLineForApply(live, line({ input_per_1m: '0.5', flags: ['large_move', 'cross_check_differs'] }))).toMatchObject({
      blockingChanged: false,
      blockingFlags: ['large_move', 'cross_check_differs'],
      refusals: [],
    });
  });

  it('a price above the sanity ceiling is a refusal', () => {
    expect(reviewLineForApply(live, line({ input_per_1m: '1001' })).refusals).toHaveLength(1);
  });
});

describe('marginItemsFor (MP-FR-14; B-1, B-2, B-3)', () => {
  it('B-1 / B-2: a model a Business OS area uses needs the prompt, with % per unit', () => {
    const tagged = snapshotOf([], { tags: { 'openai:example-model': ['Chat'] } });
    const result = marginItemsFor(tagged, [line({ flags: ['fallback_differs'] })]);
    expect(result.needed).toBe(true);
    expect(result.items).toEqual([
      {
        provider: 'openai',
        model: 'example-model',
        kind: 'token',
        areas: ['Chat'],
        changes: [
          { unit: 'input per 1M', old: '0.15', new: '0.16', change: '+6.67%' },
          { unit: 'output per 1M', old: '0.6', new: '0.6', change: '0.00%' },
          // SA CR8-4: no cached price on the line, so OpenAI charges half the new input.
          { unit: 'cached input per 1M', old: '0.075', new: '0.08', change: '+6.67%' },
        ],
        fallbackDiffers: true,
      },
    ]);
  });

  it('CR8-4: another provider without a cached price shows no cached change; a line with its own cached price shows it', () => {
    const tagged = snapshotOf([], { tags: { 'anthropic:example-model': ['Chat'], 'openai:example-model': ['Chat'] } });
    const other = marginItemsFor(tagged, [line({ provider: 'anthropic', current_cached_input_cost_per_token: null })]);
    expect(other.items[0].changes.map((entry) => entry.unit)).toEqual(['input per 1M', 'output per 1M']);
    const own = marginItemsFor(tagged, [line({ cached_input_per_1m: '0.04' })]);
    expect(own.items[0].changes[2]).toEqual({ unit: 'cached input per 1M', old: '0.075', new: '0.04', change: '-46.67%' });
  });

  it('U04b / B-1: an image line of a Business OS model needs the prompt too, with its per-image change', () => {
    const tagged = snapshotOf([], { tags: { 'openai:example-image': ['images'] } });
    const result = marginItemsFor(tagged, [
      line({
        kind: 'image',
        model_name: 'example-image',
        image_size: '1024x1024',
        image_quality: 'high',
        input_per_1m: null,
        output_per_1m: null,
        price_per_image: '0.25',
        current_basis: 'in_code_fallback',
        current_row_id: null,
        current_input_cost_per_token: null,
        current_output_cost_per_token: null,
        current_cached_input_cost_per_token: null,
        current_cost_per_image: '0.2',
      }),
    ]);
    expect(result).toEqual({
      needed: true,
      items: [
        {
          provider: 'openai',
          model: 'example-image',
          kind: 'image',
          areas: ['images'],
          changes: [{ unit: 'image 1024x1024 high', old: '0.2', new: '0.25', change: '+25.00%' }],
          fallbackDiffers: false,
        },
      ],
    });
  });

  it('B-3: a model no area uses ("not used yet") adds no item and needs no prompt', () => {
    expect(marginItemsFor(snapshotOf([]), [line({ flags: ['new_model'] })])).toEqual({ needed: false, items: [] });
  });
});
