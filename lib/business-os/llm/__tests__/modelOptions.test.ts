/**
 * S1-T7 / AC-7 — the model picker's options.
 *
 * The property under test is ONE sentence: **the picker offers exactly what
 * the validator accepts.** Every case here is a way that could stop being
 * true, and two of them are mistakes that were actually made and caught in
 * review:
 *
 *   - narrowing on the GLOBAL provider list instead of the call's own;
 *   - asking a function that skips the four model SHAPE rules, so an
 *     operator-editable `ai_model_pricing` row with a stray space would be
 *     offered here and refused on save.
 *
 * Both made the picker WIDER than the validator, which is worse than a picker
 * that is too narrow: it turns a refusal into a surprise at save time.
 *
 * `listPricedModels` is mocked (its own behaviour is S1-T13), but the
 * guardrails are NOT — the point is that the real ones answer.
 */

const mockListPricedModels = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  ...jest.requireActual('@/lib/ai/pricing'),
  listPricedModels: () => mockListPricedModels(),
  getPricing: (...a: unknown[]) => mockGetPricing(...a),
}));

const mockGetPricing = jest.fn();

const mockGetImageGenerationConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => ({
  ...jest.requireActual('@/lib/repositories/SystemConfigRepository'),
  systemConfigRepository: {
    getImageGenerationConfig: () => mockGetImageGenerationConfig(),
  },
}));

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  buildAreaModelOptions,
  newModelOptionsContext,
} from '@/lib/business-os/llm/modelOptions';
import { checkModelForCall } from '@/lib/business-os/llm/modelSettings';
import {
  getBosLlmCallPolicy,
  bosLlmSettingsCallNames,
  MAX_MODEL_NAME_LENGTH,
} from '@/lib/business-os/llm/modelSettingsPolicy';
import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';

const PRICED = { input: 0.0025, output: 0.01 };

function priced(provider: string, model: string, extra: Partial<{ inputPer1kTokens: number; outputPer1kTokens: number }> = {}) {
  return {
    provider,
    model,
    inputPer1kTokens: 0.0025,
    outputPer1kTokens: 0.01,
    source: 'database' as const,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPricing.mockResolvedValue(PRICED);
  mockGetImageGenerationConfig.mockResolvedValue({
    ...IMAGE_GENERATION_CONFIG_DEFAULTS,
    sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
    pricesUsd: {},
  });
  mockListPricedModels.mockResolvedValue({
    models: [priced('openai', 'gpt-4o'), priced('openai', 'gpt-4o-mini')],
    cacheAgeMs: 1_000,
    cacheTtlMs: 3_600_000,
  });
});

describe('the picker offers exactly what the validator accepts', () => {
  it('offers a model the guardrail accepts', async () => {
    const options = await buildAreaModelOptions('leads');

    const call = bosLlmSettingsCallNames('leads')[0];
    expect(options.byCall[call].map((o) => o.model)).toContain('gpt-4o');
  });

  /**
   * DIRECTION B, and the one the suite was blind to (QA DEF-3).
   *
   * Direction A below quantifies over **candidates**: for each thing we asked
   * about, is it offered iff the guardrail said yes. That cannot see a picker
   * which asks about one value and offers a *different* one — QA's mutation
   * M2 changed `candidate.model` to `candidate.model.trim().toLowerCase()` at
   * the push, left the ask intact, and the suite stayed **15/15 green** while
   * offering models a save refuses.
   *
   * So this quantifies over what is **offered**: every option in the payload,
   * exactly as the screen would submit it, must be acceptable to the
   * guardrail. Nothing can reach the list without having been vouched for.
   */
  it('DIRECTION B: every OFFERED option is one the guardrail accepts', async () => {
    // The fixture has to be able to TELL the two apart, or the assertion is
    // as blind as the one it replaces. `getPricing` is an EXACT-match lookup
    // in production, so the mock must be too: then a candidate that is priced
    // as written becomes UNPRICED the moment anything normalises it, and a
    // picker that offers a value it never asked about is caught.
    const PRICED_EXACTLY = new Set(['gpt-4o', 'gpt-4o-mini', 'GPT-4o-Uniq']);
    mockGetPricing.mockImplementation(async (_provider: string, model: string) =>
      PRICED_EXACTLY.has(model) ? PRICED : null
    );

    mockListPricedModels.mockResolvedValue({
      models: [
        priced('openai', 'gpt-4o'),
        priced('openai', 'gpt-4o-mini'),
        // Priced under this exact casing only. `.toLowerCase()` makes it
        // unpriced; `.trim()` alone would not — so this one catches the
        // normalising mutation.
        priced('openai', 'GPT-4o-Uniq'),
        priced('anthropic', 'claude-sonnet-4-6'),
        priced('openai', 'x'.repeat(MAX_MODEL_NAME_LENGTH + 1)),
      ],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    // Every area, not just one: a normalising bug at the push would show up
    // on all of them, and the default-injection path differs per call.
    for (const area of ['leads', 'insights', 'chat', 'images'] as const) {
      const options = await buildAreaModelOptions(area);

      for (const callName of bosLlmSettingsCallNames(area)) {
        for (const offered of options.byCall[callName]) {
          const verdict = await checkModelForCall(
            area,
            callName,
            offered.provider,
            offered.model
          );
          expect({
            area,
            callName,
            offered: `${offered.provider}:${offered.model}`,
            acceptable: verdict.ok,
          }).toEqual({
            area,
            callName,
            offered: `${offered.provider}:${offered.model}`,
            acceptable: true,
          });
        }
      }
    }
  });

  it('DIRECTION A: agrees with `checkModelForCall` on EVERY candidate and call', async () => {
    mockListPricedModels.mockResolvedValue({
      models: [
        priced('openai', 'gpt-4o'),
        priced('openai', 'gpt-4o-mini'),
        priced('anthropic', 'claude-sonnet-4-6'),
        priced('openai', ' gpt-4o '),
        priced('openai', 'x'.repeat(MAX_MODEL_NAME_LENGTH + 1)),
      ],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('leads');

    for (const callName of bosLlmSettingsCallNames('leads')) {
      const policy = getBosLlmCallPolicy('leads', callName)!;
      const offered = options.byCall[callName];

      for (const candidate of [
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'openai', model: 'gpt-4o-mini' },
        { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        { provider: 'openai', model: ' gpt-4o ' },
        { provider: 'openai', model: 'x'.repeat(MAX_MODEL_NAME_LENGTH + 1) },
      ]) {
        const verdict = await checkModelForCall('leads', callName, candidate.provider, candidate.model);
        const isOffered = offered.some(
          (o) => o.model === candidate.model && o.provider === candidate.provider
        );
        // The code default is always offered (below), so exclude it from the
        // strict correspondence.
        const isDefault =
          candidate.model === policy.default.model && candidate.provider === policy.default.provider;
        if (!isDefault) expect(isOffered).toBe(verdict.ok);
      }
    }
  });

  it('refuses a model whose SHAPE is wrong, even though it is priced', async () => {
    // `ai_model_pricing` is operator-editable, so a `model_name` carrying
    // whitespace is a real row, not a hypothetical. It must not be offered and
    // then refused on save.
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', ' gpt-4o '), priced('openai', 'x'.repeat(MAX_MODEL_NAME_LENGTH + 1))],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('leads');
    const call = bosLlmSettingsCallNames('leads')[0];

    expect(options.byCall[call].map((o) => o.model)).not.toContain(' gpt-4o ');
    expect(options.byCall[call].some((o) => o.model.length > MAX_MODEL_NAME_LENGTH)).toBe(false);
  });

  it('refuses an unpriced and a zero-priced model', async () => {
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', 'gpt-free', { inputPer1kTokens: 0, outputPer1kTokens: 0 })],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });
    // The guardrail asks `getPricing`, not the list's own numbers.
    mockGetPricing.mockResolvedValue({ input: 0, output: 0 });

    const options = await buildAreaModelOptions('leads');
    const call = bosLlmSettingsCallNames('leads')[0];

    expect(options.byCall[call].map((o) => o.model)).not.toContain('gpt-free');
  });

  it('refuses a provider the CALL does not allow', async () => {
    mockListPricedModels.mockResolvedValue({
      models: [priced('anthropic', 'claude-sonnet-4-6')],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('leads');
    const call = bosLlmSettingsCallNames('leads')[0];

    expect(options.byCall[call].some((o) => o.provider === 'anthropic')).toBe(false);
  });

  it('reports the providers from the CALL policy, not a global list', async () => {
    const options = await buildAreaModelOptions('leads');

    for (const callName of bosLlmSettingsCallNames('leads')) {
      const policy = getBosLlmCallPolicy('leads', callName)!;
      // The two coincide today (every call is `['openai']`). Reading it from
      // the policy is what keeps them in step when one call narrows.
      expect(options.allowedProvidersByCall[callName]).toBe(policy.allowedProviders);
    }
  });
});

describe('D-3: acceptability is per CALL, not per area', () => {
  it('can offer a model for one call of an area and not another', async () => {
    // A reasoning model is refused for a call that sends a sampling penalty or
    // carries a locked temperature, and accepted for one that does not. The
    // chat area has both kinds.
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', 'o3')],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('chat');

    const verdicts = await Promise.all(
      bosLlmSettingsCallNames('chat').map(async (callName) => ({
        callName,
        offered: options.byCall[callName].some((o) => o.model === 'o3'),
        accepted: (await checkModelForCall('chat', callName, 'openai', 'o3')).ok,
      }))
    );

    for (const v of verdicts) {
      const policy = getBosLlmCallPolicy('chat', v.callName)!;
      const isDefault = policy.default.model === 'o3';
      if (!isDefault) expect(v.offered).toBe(v.accepted);
    }
  });

  it('answers the image call with the image check, not the token check', async () => {
    // No image prices configured, so every image model fails
    // `image_price_missing` — and a token model fails `image_model_on_token_call`
    // in the other direction.
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', 'gpt-4o'), priced('openai', 'gpt-image-1')],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('images');
    const offered = options.byCall.image_generation.map((o) => o.model);

    expect(offered).not.toContain('gpt-4o');
  });
});

describe('D-4: the code default is always offered', () => {
  it('offers it even when the pricing snapshot has never heard of it', async () => {
    mockListPricedModels.mockResolvedValue({ models: [], cacheAgeMs: 0, cacheTtlMs: 3_600_000 });

    const options = await buildAreaModelOptions('leads');

    for (const callName of bosLlmSettingsCallNames('leads')) {
      const policy = getBosLlmCallPolicy('leads', callName)!;
      // The resolver accepts the default unconditionally — it is what runs
      // today — so an operator must always have a way back to it.
      expect(options.byCall[callName]).toContainEqual({
        provider: policy.default.provider,
        model: policy.default.model,
      });
    }
  });

  it('does not offer it twice when it is also priced', async () => {
    const call = bosLlmSettingsCallNames('leads')[0];
    const policy = getBosLlmCallPolicy('leads', call)!;
    mockListPricedModels.mockResolvedValue({
      models: [priced(policy.default.provider, policy.default.model)],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('leads');

    expect(options.byCall[call].filter((o) => o.model === policy.default.model)).toHaveLength(1);
  });
});

describe('the advisory label has real numbers behind it', () => {
  it('passes the cache age and TTL through', async () => {
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', 'gpt-4o')],
      cacheAgeMs: 42_000,
      cacheTtlMs: 3_600_000,
    });

    const options = await buildAreaModelOptions('leads');

    expect(options.cacheAgeMs).toBe(42_000);
    expect(options.cacheTtlMs).toBe(3_600_000);
  });
});

describe('the shared per-request context', () => {
  it('reads the pricing snapshot once for many areas, not once per area', async () => {
    const shared = await newModelOptionsContext();
    expect(mockListPricedModels).toHaveBeenCalledTimes(1);

    await buildAreaModelOptions('leads', shared);
    await buildAreaModelOptions('insights', shared);
    await buildAreaModelOptions('images', shared);

    expect(mockListPricedModels).toHaveBeenCalledTimes(1);
  });

  it('reads the image configuration once across areas, not once per area', async () => {
    // A NON-default image model: `checkModel` returns early for a value equal
    // to the code default, so `gpt-image-1` would never reach the image check
    // at all and this test would prove nothing.
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', 'dall-e-3')],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });
    const shared = await newModelOptionsContext();

    await buildAreaModelOptions('images', shared);
    await buildAreaModelOptions('images', shared);

    expect(mockGetImageGenerationConfig).toHaveBeenCalledTimes(1);
  });

  it('does not touch the image configuration at all for the code default', async () => {
    // The corollary, worth pinning: the default costs no repository read,
    // which is why a settings row that changes nothing is nearly free.
    mockListPricedModels.mockResolvedValue({
      models: [priced('openai', IMAGE_GENERATION_CONFIG_DEFAULTS.model)],
      cacheAgeMs: 0,
      cacheTtlMs: 3_600_000,
    });

    await buildAreaModelOptions('images');

    expect(mockGetImageGenerationConfig).not.toHaveBeenCalled();
  });

  it('still works standalone, so a single-area caller needs no ceremony', async () => {
    const options = await buildAreaModelOptions('leads');
    expect(Object.keys(options.byCall).length).toBeGreaterThan(0);
  });
});
