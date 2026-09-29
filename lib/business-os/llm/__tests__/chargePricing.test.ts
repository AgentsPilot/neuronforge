/**
 * Deduction layer slice 2: the conservative fallback rates (SQ-9) and the pure
 * action pricer slice 3 will wire (workplan §2.3, SQ-8).
 *
 * Every expected rate is RECOMPUTED here from the in-code tables, never typed
 * (D-0 C-1 spirit): a price change in the table moves the test with it.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/AiModelPricingRepository', () => ({
  aiModelPricingRepository: { listActive: jest.fn().mockResolvedValue({ data: [], error: null }) },
}));

import { inCodeTokenPrices, isInputOnlyPricedModel } from '@/lib/ai/pricing';
import type { UsageCallRecord } from '@/lib/ai/usageScope';
import { IMAGE_FALLBACK_PRICING } from '@/lib/repositories/SystemConfigRepository';
import { conservativeRateDerivation, priceActionForCharge, type ConservativeRate } from '../chargePricing';

const GROUP = '33333333-3333-4333-8333-333333333333';

function rec(overrides: Partial<UsageCallRecord> = {}): UsageCallRecord {
  return {
    feature: 'business-os-chat',
    component: 'planner',
    provider: 'openai',
    model: 'gpt-4o',
    sessionId: GROUP,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0075,
    success: true,
    ...overrides,
  };
}

/** The expected maxima, recomputed from the tables (first in table order on a tie). */
type Max = { value: number; from: string };
function max(entries: Array<[string, number]>): Max {
  let best: Max | undefined;
  for (const [from, value] of entries) if (value > 0 && (!best || value > best.value)) best = { value, from };
  if (!best) throw new Error('no positive entry');
  return best;
}
const TABLE = inCodeTokenPrices();
function modelsOf(provider: string, inputOnly: boolean): Array<[string, { input: number; output: number }]> {
  return Object.entries(TABLE[provider]).filter(([m]) => isInputOnlyPricedModel(provider, m) === inputOnly);
}
function allModels(inputOnly: boolean): Array<[string, { input: number; output: number }]> {
  return Object.keys(TABLE).flatMap((p) =>
    modelsOf(p, inputOnly).map(([m, price]): [string, { input: number; output: number }] => [`${p}:${m}`, price])
  );
}
const OPENAI_TEXT_IN = max(modelsOf('openai', false).map(([m, p]) => [m, p.input]));
const OPENAI_TEXT_OUT = max(modelsOf('openai', false).map(([m, p]) => [m, p.output]));
const OPENAI_EMBED_IN = max(modelsOf('openai', true).map(([m, p]) => [m, p.input]));
const ALL_TEXT_IN = max(allModels(false).map(([m, p]) => [m, p.input]));
const ALL_TEXT_OUT = max(allModels(false).map(([m, p]) => [m, p.output]));
const ALL_EMBED_IN = max(allModels(true).map(([m, p]) => [m, p.input]));
const IMAGE_MAX = max(Object.entries(IMAGE_FALLBACK_PRICING));

function find(kind: ConservativeRate['kind'], provider: string): ConservativeRate {
  const rate = conservativeRateDerivation().find((r) => r.kind === kind && r.provider === provider);
  if (!rate) throw new Error(`no ${kind} rate for ${provider}`);
  return rate;
}

describe('the conservative rates (SQ-9), recomputed from the tables', () => {
  it('per provider: text is the per-side maximum over non-input-only models, with its source per side', () => {
    for (const provider of Object.keys(TABLE)) {
      const text = modelsOf(provider, false);
      if (text.length === 0) continue;
      const input = max(text.map(([m, p]) => [m, p.input]));
      const output = max(text.map(([m, p]) => [m, p.output]));
      expect(find('text', provider)).toEqual({
        kind: 'text',
        provider,
        scope: 'provider',
        inputPer1k: input.value,
        outputPer1k: output.value,
        inputFrom: input.from,
        outputFrom: output.from,
      });
    }
  });

  it('per provider: embedding is the maximum input over input-only models (only providers that have one)', () => {
    expect(find('embedding', 'openai')).toEqual({
      kind: 'embedding',
      provider: 'openai',
      scope: 'provider',
      inputPer1k: OPENAI_EMBED_IN.value,
      inputFrom: OPENAI_EMBED_IN.from,
    });
    expect(conservativeRateDerivation().some((r) => r.kind === 'embedding' && r.provider === 'anthropic')).toBe(false);
  });

  it('all providers: text, embedding, and the image maximum of IMAGE_FALLBACK_PRICING', () => {
    expect(find('text', '*')).toEqual({
      kind: 'text',
      provider: '*',
      scope: 'all_providers',
      inputPer1k: ALL_TEXT_IN.value,
      outputPer1k: ALL_TEXT_OUT.value,
      inputFrom: ALL_TEXT_IN.from,
      outputFrom: ALL_TEXT_OUT.from,
    });
    expect(find('embedding', '*')).toEqual({
      kind: 'embedding',
      provider: '*',
      scope: 'all_providers',
      inputPer1k: ALL_EMBED_IN.value,
      inputFrom: ALL_EMBED_IN.from,
    });
    expect(find('image', '*')).toEqual({
      kind: 'image',
      provider: '*',
      scope: 'all_providers',
      perImage: IMAGE_MAX.value,
      imageFrom: IMAGE_MAX.from,
    });
  });

  it('is frozen, and the same object each time (computed once, lazily)', () => {
    const derivation = conservativeRateDerivation();
    expect(Object.isFrozen(derivation)).toBe(true);
    expect(derivation.every((r) => Object.isFrozen(r))).toBe(true);
    expect(conservativeRateDerivation()).toBe(derivation);
  });

  it('does not touch the image table at import: a partial SystemConfigRepository mock cannot break loading (SA S-2)', () => {
    jest.isolateModules(() => {
      jest.doMock('@/lib/repositories/SystemConfigRepository', () => ({}));
      expect(() => require('../chargePricing')).not.toThrow();
    });
  });
});

describe('priceActionForCharge', () => {
  it('rules 5 and 6: measured calls are charged their recorded cost', () => {
    const action = priceActionForCharge([
      rec({ pricing: { status: 'priced', unit: 'token' } }),
      rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', costUsd: 0.0105 }),
    ]);
    expect(action.calls.map((c) => [c.basis, c.costUsd])).toEqual([
      ['measured', 0.0075],
      ['measured', 0.0105],
    ]);
    expect(action.isFallbackPriced).toBe(false);
    expect(action.fallbackCallCount).toBe(0);
  });

  it('sums raw costs, unrounded, and a 2e-7 embedding stays non-zero (SQ-8, AC-29)', () => {
    const tiny = rec({ model: 'text-embedding-3-small', inputTokens: 10, outputTokens: 0, costUsd: 2.0000000000000002e-7, pricing: { status: 'priced', unit: 'token' } });
    expect(priceActionForCharge([tiny]).costUsd).toBe(2.0000000000000002e-7);
    const three = priceActionForCharge([
      rec({ costUsd: 0.0015, pricing: { status: 'priced', unit: 'token' } }),
      rec({ costUsd: 0.002, pricing: { status: 'priced', unit: 'token' } }),
      rec({ costUsd: 0.0000024, pricing: { status: 'priced', unit: 'token' } }),
    ]);
    expect(three.costUsd).toBe(0.0015 + 0.002 + 0.0000024);
  });

  it('rule 2: a failed call is charged its recorded 0, not flagged', () => {
    const action = priceActionForCharge([rec({ success: false, inputTokens: 0, outputTokens: 0, costUsd: 0 })]);
    expect(action.calls[0]).toEqual({ basis: 'failed_call', kind: 'text', costUsd: 0 });
    expect(action.isFallbackPriced).toBe(false);
  });

  it('rule 3, text: the provider maximum on the FULL input tokens and the output tokens, flagged', () => {
    const action = priceActionForCharge([
      rec({ model: 'gpt-imaginary', inputTokens: 2000, outputTokens: 500, costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }),
    ]);
    expect(action.calls[0]).toMatchObject({ basis: 'conservative_fallback', reason: 'unpriced', kind: 'text' });
    expect(action.costUsd).toBeCloseTo(2 * OPENAI_TEXT_IN.value + 0.5 * OPENAI_TEXT_OUT.value, 12);
    expect(action.isFallbackPriced).toBe(true);
    expect(action.fallbackCallCount).toBe(1);
  });

  it('rule 3, embedding: the embedding maximum on input tokens', () => {
    const action = priceActionForCharge([
      rec({ model: 'text-embedding-imaginary', inputTokens: 3000, outputTokens: 0, costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }),
    ]);
    expect(action.calls[0].kind).toBe('embedding');
    expect(action.costUsd).toBeCloseTo(3 * OPENAI_EMBED_IN.value, 12);
  });

  it('rule 3, image: the image maximum, never 0', () => {
    const action = priceActionForCharge([
      rec({ model: 'gpt-image-1', inputTokens: 0, outputTokens: 0, costUsd: 0, pricing: { status: 'unpriced', unit: 'image' } }),
    ]);
    expect(action.costUsd).toBe(IMAGE_MAX.value);
    expect(action.costUsd).toBeGreaterThan(0);
  });

  it('rule 4: the priced-but-zero backstop is charged the conservative rate', () => {
    const action = priceActionForCharge([rec({ inputTokens: 1000, outputTokens: 0, costUsd: 0, pricing: { status: 'priced', unit: 'token' } })]);
    expect(action.calls[0].reason).toBe('priced_but_zero');
    expect(action.costUsd).toBeCloseTo(OPENAI_TEXT_IN.value, 12);
  });

  it("rule 7 + C-1: a priced model's $0 for real tokens is charged conservatively (the provider's own maximum)", () => {
    const anthropicText = find('text', 'anthropic');
    const action = priceActionForCharge([
      rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 1000, costUsd: 0 }),
    ]);
    expect(action.calls[0]).toMatchObject({ basis: 'conservative_fallback', reason: 'zero_cost_with_tokens' });
    expect(action.costUsd).toBeCloseTo((anthropicText.inputPer1k ?? 0) + (anthropicText.outputPer1k ?? 0), 12);
  });

  it('rule 7: zero tokens re-checked priced is measured 0; re-checked unpriced is 0 but flagged', () => {
    const priced = priceActionForCharge([rec({ provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0, costUsd: 0 })]);
    expect(priced.calls[0]).toEqual({ basis: 'measured', kind: 'text', costUsd: 0 });
    expect(priced.isFallbackPriced).toBe(false);
    const unpriced = priceActionForCharge([rec({ provider: 'anthropic', model: 'claude-imaginary', inputTokens: 0, outputTokens: 0, costUsd: 0 })]);
    expect(unpriced.calls[0]).toMatchObject({ reason: 'unpriced_on_recheck', costUsd: 0 });
    expect(unpriced.isFallbackPriced).toBe(true);
  });

  it('a provider absent from the table (groq) is charged the all-providers rate', () => {
    const action = priceActionForCharge([rec({ provider: 'groq', model: 'llama-3.3-70b-versatile', inputTokens: 1000, outputTokens: 1000, costUsd: 0 })]);
    expect(action.costUsd).toBeCloseTo(ALL_TEXT_IN.value + ALL_TEXT_OUT.value, 12);
  });

  it('rule 1: malformed is flagged and never throws; a usable count still prices, a bad one counts as 0', () => {
    const nanCost = priceActionForCharge([rec({ inputTokens: 1000, outputTokens: 0, costUsd: NaN })]);
    expect(nanCost.calls[0]).toMatchObject({ reason: 'malformed' });
    expect(nanCost.costUsd).toBeCloseTo(OPENAI_TEXT_IN.value, 12);
    const negative = priceActionForCharge([rec({ inputTokens: -5, outputTokens: 1000, costUsd: 0.01 })]);
    expect(negative.costUsd).toBeCloseTo(OPENAI_TEXT_OUT.value, 12);
    expect(Number.isFinite(priceActionForCharge([rec({ inputTokens: NaN, outputTokens: NaN, costUsd: NaN })]).costUsd)).toBe(true);
  });

  it('mixes: the flag and the count follow the fallback calls only', () => {
    const action = priceActionForCharge([
      rec({ pricing: { status: 'priced', unit: 'token' } }),
      rec({ model: 'gpt-imaginary', costUsd: 0, pricing: { status: 'unpriced', unit: 'token' } }),
      rec({ success: false, inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    ]);
    expect(action.fallbackCallCount).toBe(1);
    expect(action.isFallbackPriced).toBe(true);
    expect(action.calls.map((c) => c.basis)).toEqual(['measured', 'conservative_fallback', 'failed_call']);
  });

  it('an empty action costs 0 and is not flagged', () => {
    expect(priceActionForCharge([])).toEqual({ costUsd: 0, isFallbackPriced: false, fallbackCallCount: 0, calls: [] });
  });
});
