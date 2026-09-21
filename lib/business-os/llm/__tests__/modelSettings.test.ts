/**
 * T1-4 … T1-8, T1-10, T1-12 (Layer 2 Step 1) — the resolver.
 *
 * Everything here runs against a mocked repository and a mocked price lookup,
 * so each case is exactly one rule: precedence, fallback, a guardrail, a lock,
 * the cache window, or the change log. The one rule that is never mocked is
 * "the resolver never throws": several cases feed it a broken row or a broken
 * repository and assert it still answers.
 *
 * AC-3, AC-4, AC-5, AC-6, AC-7, AC-15, FR-17.
 */

const logged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(
                JSON.stringify(first, (_key, value) =>
                  value instanceof Error ? { name: value.name, message: value.message } : value
                )
              )
            : {};
        logged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockGetPricing = jest.fn();
jest.mock('@/lib/ai/pricing', () => ({
  getPricing: (...args: unknown[]) => mockGetPricing(...args),
  calculateCostSync: () => 0,
  calculateCost: async () => 0,
  hasPricing: async () => true,
}));

const mockGetByKeys = jest.fn();
const mockGetByCategory = jest.fn();
const mockGetImageGenerationConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return {
    ...actual,
    systemConfigRepository: {
      getByKeys: (...args: unknown[]) => mockGetByKeys(...args),
      getByCategory: (...args: unknown[]) => mockGetByCategory(...args),
      getImageGenerationConfig: (...args: unknown[]) => mockGetImageGenerationConfig(...args),
    },
  };
});

import {
  __bosLlmSettingsCacheStateForTests,
  __resetBosLlmSettingsForTests,
  BOS_LLM_SETTINGS_CACHE_MS,
  BOS_LLM_SETTINGS_ERROR_RETRY_MS,
  BOS_LLM_SETTINGS_READ_TIMEOUT_MS,
  isBosLlmAreaEnabled,
  resolveBosLlmSettings,
} from '../modelSettings';
import { BOS_LLM_AREA_KEYS, bosLlmAreaKey } from '../modelSettingsPolicy';
import { IMAGE_GENERATION_CONFIG_DEFAULTS } from '@/lib/repositories/SystemConfigRepository';

const PRICED = { input: 0.0025, output: 0.01 };

/** A repository answer holding the given area rows. */
function rows(byArea: Record<string, unknown>, updatedAt = '2026-09-20T10:00:00.000Z') {
  return {
    data: Object.entries(byArea).map(([area, value]) => ({
      key: bosLlmAreaKey(area as never),
      value,
      category: 'business_os_llm',
      updated_at: updatedAt,
    })),
    error: null,
  };
}

function issuesLogged(level: 'warn' | 'error' | 'info' | 'debug') {
  return logged.filter((line) => line.level === level);
}

beforeEach(() => {
  logged.length = 0;
  mockGetPricing.mockReset().mockResolvedValue(PRICED);
  mockGetByKeys.mockReset().mockResolvedValue({ data: [], error: null });
  mockGetByCategory.mockReset();
  mockGetImageGenerationConfig.mockReset().mockResolvedValue({
    ...IMAGE_GENERATION_CONFIG_DEFAULTS,
    sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
    pricesUsd: {},
  });
  __resetBosLlmSettingsForTests();
});

// ---------------------------------------------------------------------------
// T1-4 — precedence (AC-3)
// ---------------------------------------------------------------------------

describe('precedence: call override → area → code default (T1-4, AC-3)', () => {
  it('prefers a call override, then the area value, then the code default', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({
        insights: {
          model: 'gpt-4o',
          temperature: 0.9,
          calls: { health_summary: { temperature: 0.1 } },
        },
      })
    );

    const health = await resolveBosLlmSettings('insights', 'health_summary');
    expect(health).toMatchObject({ model: 'gpt-4o', temperature: 0.1, provider: 'openai', enabled: true });

    // No call override → the area value.
    const content = await resolveBosLlmSettings('insights', 'insight_content');
    expect(content).toMatchObject({ model: 'gpt-4o', temperature: 0.9 });

    // No row at all → the code default, untouched.
    const briefing = await resolveBosLlmSettings('briefing', 'daily_narration');
    expect(briefing).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.3, enabled: true });
  });

  it('inherits an absent field and sends no temperature for null (FR-4, DEC-2)', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({ insights: { temperature: 0.9, calls: { health_summary: { model: 'gpt-4o' } } } })
    );

    const health = await resolveBosLlmSettings('insights', 'health_summary');
    // model from the call, temperature inherited from the area
    expect(health).toMatchObject({ model: 'gpt-4o', temperature: 0.9 });

    __resetBosLlmSettingsForTests();
    mockGetByKeys.mockResolvedValue(rows({ insights: { calls: { health_summary: { temperature: null } } } }));
    const none = await resolveBosLlmSettings('insights', 'health_summary');
    expect(none.temperature).toBeUndefined();
  });

  it('carries the code default model for the retry, whatever is configured', async () => {
    mockGetByKeys.mockResolvedValue(rows({ intake: { model: 'gpt-4o-mini' } }));
    const settings = await resolveBosLlmSettings('intake', 'form_generation');
    expect(settings).toMatchObject({ model: 'gpt-4o-mini', defaultModel: 'gpt-4o' });
  });

  it('ignores an unknown call name and an unknown top-level key, with a warning', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({ insights: { modle: 'gpt-4o', calls: { insight_contnet: { model: 'gpt-4o' } } } })
    );

    const settings = await resolveBosLlmSettings('insights', 'insight_content');
    expect(settings.model).toBe('gpt-4o-mini');

    const warned = issuesLogged('warn').map((line) => line.fields.reason);
    expect(warned).toContain('unknown_field');
    expect(warned).toContain('unknown_call_name');
  });

  it('reads the eight rows by fixed key and never by category (RC-3)', async () => {
    await resolveBosLlmSettings('leads', 'reply_recommendation');
    expect(mockGetByKeys).toHaveBeenCalledTimes(1);
    expect(mockGetByKeys).toHaveBeenCalledWith([...BOS_LLM_AREA_KEYS]);
    expect(mockGetByKeys.mock.calls[0][0]).toHaveLength(8);
    expect(mockGetByCategory).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T1-5 — fallback (AC-4)
// ---------------------------------------------------------------------------

describe('fallback: a fault is never worse than today (T1-5, AC-4, FR-6)', () => {
  it('uses the code defaults for a missing row, and says so at debug', async () => {
    const settings = await resolveBosLlmSettings('website', 'full_site');
    expect(settings).toMatchObject({ model: 'gpt-4o', temperature: 0.7, enabled: true });
    expect(issuesLogged('debug').some((line) => line.fields.area === 'website')).toBe(true);
  });

  it.each([['a string', 'x'], ['an array', [1, 2]], ['a number', 5]])(
    'uses the code defaults for a row that is %s, with an error log',
    async (_label, value) => {
      mockGetByKeys.mockResolvedValue(rows({ intake: value }));
      const settings = await resolveBosLlmSettings('intake', 'form_generation');
      expect(settings).toMatchObject({ model: 'gpt-4o', temperature: 0.3 });
      expect(issuesLogged('error').some((line) => line.fields.reason === 'row_not_an_object')).toBe(true);
    }
  );

  it('falls back on the bad field alone', async () => {
    mockGetByKeys.mockResolvedValue(rows({ intake: { model: 'gpt-4o-mini', temperature: 4 } }));
    const settings = await resolveBosLlmSettings('intake', 'form_generation');
    expect(settings).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.3 });
  });

  it('serves the last good settings when the repository fails, then the defaults when there are none', async () => {
    mockGetByKeys.mockResolvedValue(rows({ leads: { model: 'gpt-4o' } }));
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o');

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_CACHE_MS + 1);
    mockGetByKeys.mockResolvedValue({ data: null, error: new Error('unreachable') });
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o');
    expect(issuesLogged('warn').some((line) => line.fields.servingLastGood === true)).toBe(true);
    jest.useRealTimers();

    __resetBosLlmSettingsForTests();
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o-mini');
  });

  it('never rejects, even when the repository throws', async () => {
    mockGetByKeys.mockRejectedValue(new Error('socket hang up'));
    await expect(resolveBosLlmSettings('chat', 'analysis')).resolves.toMatchObject({
      model: 'gpt-4o-mini',
      temperature: 0,
    });
    await expect(isBosLlmAreaEnabled('chat')).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1-6 — guardrails (AC-5)
// ---------------------------------------------------------------------------

describe('guardrails: one bad field, one fallback, one error log (T1-6, AC-5, DEC-7)', () => {
  it('refuses a model with no price', async () => {
    mockGetPricing.mockResolvedValue(null);
    mockGetByKeys.mockResolvedValue(rows({ briefing: { model: 'gpt-4o-unreleased' } }));

    const settings = await resolveBosLlmSettings('briefing', 'daily_narration');
    expect(settings.model).toBe('gpt-4o-mini');
    const error = issuesLogged('error').find((line) => line.fields.field === 'model');
    expect(error?.fields).toMatchObject({
      area: 'briefing',
      callName: 'daily_narration',
      field: 'model',
      reason: 'unpriced_model',
      value: 'gpt-4o-unreleased',
    });
  });

  it('refuses a model priced at zero — hasPricing would have said yes (SA §F.5)', async () => {
    mockGetPricing.mockResolvedValue({ input: 0, output: 0 });
    mockGetByKeys.mockResolvedValue(rows({ briefing: { model: 'gpt-free' } }));

    expect((await resolveBosLlmSettings('briefing', 'daily_narration')).model).toBe('gpt-4o-mini');
    expect(issuesLogged('error').some((line) => line.fields.reason === 'zero_price')).toBe(true);
  });

  it('refuses a model priced on input only, and keeps that rule local to Layer 2 (D-14)', async () => {
    // `output: 0` is legitimate for embedding models, which is exactly why the
    // rule lives here and not in `hasPricing` / `calculateCost`. Embeddings are
    // excluded from these settings altogether (DEC-3).
    mockGetPricing.mockResolvedValue({ input: 0.00002, output: 0 });
    mockGetByKeys.mockResolvedValue(rows({ briefing: { model: 'text-embedding-3-small' } }));

    expect((await resolveBosLlmSettings('briefing', 'daily_narration')).model).toBe('gpt-4o-mini');
    expect(issuesLogged('error').some((line) => line.fields.reason === 'zero_price')).toBe(true);
  });

  it('refuses an image model that is not priced for every size at low, medium and high', async () => {
    mockGetImageGenerationConfig.mockResolvedValue({
      ...IMAGE_GENERATION_CONFIG_DEFAULTS,
      sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
      // Only one of the nine combinations is priced.
      pricesUsd: { 'gpt-image-2:1024x1024:high': 0.2 },
    });
    mockGetByKeys.mockResolvedValue(rows({ images: { model: 'gpt-image-2' } }));

    expect((await resolveBosLlmSettings('images', 'image_generation')).model).toBe(
      IMAGE_GENERATION_CONFIG_DEFAULTS.model
    );
    expect(issuesLogged('error').some((line) => line.fields.reason === 'image_price_missing')).toBe(true);
  });

  it('accepts an image model priced for every configured size and quality', async () => {
    const sizes = { wide: '1536x1024', portrait: '1024x1536', square: '1024x1024' };
    const pricesUsd: Record<string, number> = {};
    for (const size of Object.values(sizes)) {
      for (const quality of ['low', 'medium', 'high']) pricesUsd[`gpt-image-2:${size}:${quality}`] = 0.2;
    }
    mockGetImageGenerationConfig.mockResolvedValue({ ...IMAGE_GENERATION_CONFIG_DEFAULTS, sizes, pricesUsd });
    mockGetByKeys.mockResolvedValue(rows({ images: { model: 'gpt-image-2' } }));

    expect((await resolveBosLlmSettings('images', 'image_generation')).model).toBe('gpt-image-2');
  });

  it('refuses a provider that is not on the call list (DEC-4)', async () => {
    mockGetByKeys.mockResolvedValue(rows({ leads: { provider: 'anthropic' } }));
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).provider).toBe('openai');
    expect(issuesLogged('error').some((line) => line.fields.reason === 'provider_not_allowed')).toBe(true);
  });

  it.each([1.5, -0.1, 'warm', NaN])('refuses the temperature %p', async (value) => {
    mockGetByKeys.mockResolvedValue(rows({ insights: { temperature: value } }));
    expect((await resolveBosLlmSettings('insights', 'insight_content')).temperature).toBe(0.3);
    expect(issuesLogged('error').some((line) => line.fields.field === 'temperature')).toBe(true);
  });

  it('accepts 0 for any call, including analysis (RC-2)', async () => {
    mockGetByKeys.mockResolvedValue(rows({ chat: { temperature: 0 }, insights: { temperature: 0 } }));
    expect((await resolveBosLlmSettings('chat', 'analysis')).temperature).toBe(0);
    expect((await resolveBosLlmSettings('insights', 'insight_content')).temperature).toBe(0);
    expect(issuesLogged('error')).toHaveLength(0);
  });

  it('refuses a non-boolean enabled', async () => {
    mockGetByKeys.mockResolvedValue(rows({ leads: { enabled: 'false' } }));
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).enabled).toBe(true);
    expect(issuesLogged('error').some((line) => line.fields.reason === 'enabled_not_a_boolean')).toBe(true);
  });

  it('prices each distinct model once per refill, and not at all on a warm call (RC-W7c)', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({
        website: {
          model: 'gpt-4o-2026',
          calls: {
            landing_page: { model: 'gpt-4o-2026' },
            field_regenerate: { model: 'gpt-4o-2026' },
          },
        },
      })
    );

    await resolveBosLlmSettings('website', 'hero_content');
    // Eight website calls name the same model at up to two levels; one lookup.
    expect(mockGetPricing).toHaveBeenCalledTimes(1);

    await resolveBosLlmSettings('website', 'landing_page');
    await resolveBosLlmSettings('website', 'testimonial_enhance');
    expect(mockGetPricing).toHaveBeenCalledTimes(1);
    expect(mockGetByKeys).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T1-7 — reasoning models, resolver half (AC-15)
// ---------------------------------------------------------------------------

describe('reasoning models (T1-7, AC-15, RC-11, RC-W5)', () => {
  it('sends no temperature for a model that rejects sampling parameters, with a warning', async () => {
    mockGetByKeys.mockResolvedValue(rows({ insights: { model: 'gpt-5.4-mini' } }));
    const settings = await resolveBosLlmSettings('insights', 'insight_content');
    expect(settings).toMatchObject({ model: 'gpt-5.4-mini', temperature: undefined });
    const warning = issuesLogged('warn').find(
      (line) => line.fields.reason === 'model_rejects_sampling_parameters'
    );
    // S1-10: reported against the call, which is what decided it.
    expect(warning?.fields).toMatchObject({ level: 'call', callName: 'insight_content' });
  });

  it.each(['planner', 'analysis'] as const)(
    'refuses such a model for %s, which sends frequency_penalty (N-1)',
    async (callName) => {
      mockGetByKeys.mockResolvedValue(rows({ chat: { model: 'gpt-5.4-mini' } }));
      const settings = await resolveBosLlmSettings('chat', callName);
      expect(settings.model).toBe('gpt-4o-mini');
      expect(
        issuesLogged('error').some(
          (line) => line.fields.callName === callName && line.fields.reason === 'model_rejects_sampling_parameters'
        )
      ).toBe(true);
    }
  );

  it('refuses o1 on any token call: it would be sent max_tokens and 400 (RC-W5)', async () => {
    mockGetByKeys.mockResolvedValue(rows({ insights: { model: 'o1-preview' } }));
    expect((await resolveBosLlmSettings('insights', 'insight_content')).model).toBe('gpt-4o-mini');
    expect(
      issuesLogged('error').some((line) => line.fields.reason === 'reasoning_model_sent_max_tokens')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1-8 — locks (AC-6)
// ---------------------------------------------------------------------------

describe('locks are applied after resolution (T1-8, AC-6, FR-8, DEC-5)', () => {
  it('will not switch onboarding off, at either level', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({ onboarding: { enabled: false, calls: { business_story_extraction: { enabled: false } } } })
    );

    expect((await resolveBosLlmSettings('onboarding', 'business_story_extraction')).enabled).toBe(true);
    expect((await resolveBosLlmSettings('onboarding', 'adjustment_intent_extraction')).enabled).toBe(true);
    expect(await isBosLlmAreaEnabled('onboarding')).toBe(true);
    expect(issuesLogged('warn').some((line) => line.fields.reason === 'area_not_switchable')).toBe(true);
  });

  it('will not switch the planner off on its own, and keeps its temperature at 0 (F-6)', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({ chat: { calls: { planner: { enabled: false, temperature: 0.5 } } } })
    );

    const planner = await resolveBosLlmSettings('chat', 'planner');
    expect(planner).toMatchObject({ enabled: true, temperature: 0 });
    const reasons = issuesLogged('warn').map((line) => line.fields.reason);
    expect(reasons).toContain('call_not_switchable');
    expect(reasons).toContain('temperature_locked');
  });

  // S1-9: the area value is legitimate for the area's OTHER calls, so it is not
  // a rejection — but the operator must still see that half of it did not land.
  it('reports an area temperature that a locked call cannot take, without blocking', async () => {
    mockGetByKeys.mockResolvedValue(rows({ chat: { temperature: 0.7 } }));

    expect((await resolveBosLlmSettings('chat', 'planner')).temperature).toBe(0);
    expect((await resolveBosLlmSettings('chat', 'analysis')).temperature).toBe(0.7);

    const adjusted = issuesLogged('warn').find(
      (line) => line.fields.callName === 'planner' && line.fields.reason === 'temperature_locked'
    );
    expect(adjusted?.fields).toMatchObject({ level: 'area', value: 0.7 });
  });

  it('stays silent when the area temperature equals the lock, as the seed writes it', async () => {
    mockGetByKeys.mockResolvedValue(rows({ chat: { temperature: 0 } }));

    expect((await resolveBosLlmSettings('chat', 'planner')).temperature).toBe(0);
    expect(
      issuesLogged('warn').some((line) => line.fields.reason === 'temperature_locked')
    ).toBe(false);
  });

  it('ignores a temperature on images, which take none', async () => {
    mockGetByKeys.mockResolvedValue(rows({ images: { temperature: 0.5 } }));
    expect((await resolveBosLlmSettings('images', 'image_generation')).temperature).toBeUndefined();
    expect(issuesLogged('warn').some((line) => line.fields.reason === 'temperature_not_applicable')).toBe(true);
  });

  it('turns every switchable call of an area off with one area-level switch', async () => {
    mockGetByKeys.mockResolvedValue(rows({ insights: { enabled: false } }));
    for (const callName of ['insight_content', 'correlated_insight', 'health_summary'] as const) {
      expect((await resolveBosLlmSettings('insights', callName)).enabled).toBe(false);
    }
    expect(await isBosLlmAreaEnabled('insights')).toBe(false);
  });

  it('lets a call override keep itself on while its area is off', async () => {
    mockGetByKeys.mockResolvedValue(
      rows({ insights: { enabled: false, calls: { health_summary: { enabled: true } } } })
    );
    expect((await resolveBosLlmSettings('insights', 'health_summary')).enabled).toBe(true);
    expect((await resolveBosLlmSettings('insights', 'insight_content')).enabled).toBe(false);
  });

  it('keeps a locked call truthful: it reports enabled even when its area is off (§3.1)', async () => {
    // The chat area switch is enforced at route entry by isBosLlmAreaEnabled,
    // not through the planner's own flag; and the three website calls whose off
    // paths ship in Step 3 must not report themselves off before then.
    mockGetByKeys.mockResolvedValue(rows({ chat: { enabled: false }, website: { enabled: false } }));

    expect((await resolveBosLlmSettings('chat', 'planner')).enabled).toBe(true);
    expect((await resolveBosLlmSettings('chat', 'analysis')).enabled).toBe(false);
    expect(await isBosLlmAreaEnabled('chat')).toBe(false);

    expect((await resolveBosLlmSettings('website', 'full_site')).enabled).toBe(true);
    expect((await resolveBosLlmSettings('website', 'field_regenerate')).enabled).toBe(true);
    expect((await resolveBosLlmSettings('website', 'landing_page')).enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T1-10 — the cache window (AC-7)
// ---------------------------------------------------------------------------

describe('provider and model never decohere (S1-8)', () => {
  it('takes the default provider with the default model when a configured model is refused', async () => {
    mockGetPricing.mockResolvedValue(null);
    mockGetByKeys.mockResolvedValue(rows({ leads: { model: 'gpt-4o-imaginary' } }));

    const settings = await resolveBosLlmSettings('leads', 'reply_recommendation');
    expect(settings).toMatchObject({ model: 'gpt-4o-mini', provider: 'openai' });
  });

  it('keeps a configured provider when the configured model is accepted', async () => {
    mockGetByKeys.mockResolvedValue(rows({ leads: { provider: 'openai', model: 'gpt-4o' } }));
    expect(await resolveBosLlmSettings('leads', 'reply_recommendation')).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
    });
  });
});

describe('cache: one read a minute, ten seconds after a failure (T1-10, AC-7, DEC-8)', () => {
  afterEach(() => jest.useRealTimers());

  it('does not see a changed row at 59 s and does see it at 60 s', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    mockGetByKeys.mockResolvedValue(rows({ leads: { model: 'gpt-4o' } }));
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o');

    mockGetByKeys.mockResolvedValue(rows({ leads: { model: 'gpt-4o-mini' } }));
    jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_CACHE_MS - 1_000);
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o');
    expect(mockGetByKeys).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 1_000);
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o-mini');
    expect(mockGetByKeys).toHaveBeenCalledTimes(2);
  });

  it('retries ten seconds after a failed read, not on every call', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    mockGetByKeys.mockResolvedValue({ data: null, error: new Error('down') });

    await resolveBosLlmSettings('leads', 'reply_recommendation');
    await resolveBosLlmSettings('leads', 'reply_recommendation');
    await resolveBosLlmSettings('briefing', 'daily_narration');
    expect(mockGetByKeys).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_ERROR_RETRY_MS - 1);
    await resolveBosLlmSettings('leads', 'reply_recommendation');
    expect(mockGetByKeys).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 1);
    mockGetByKeys.mockResolvedValue(rows({ leads: { model: 'gpt-4o' } }));
    expect((await resolveBosLlmSettings('leads', 'reply_recommendation')).model).toBe('gpt-4o');
    expect(mockGetByKeys).toHaveBeenCalledTimes(2);
    expect(__bosLlmSettingsCacheStateForTests().fromFailedRead).toBe(false);
  });

  // D-Q2 / R-1: a read that never settles is the failure mode that matters
  // most, because it is the one that used to strand every caller for ever.
  it.each([
    [
      'the row read hangs',
      () => {
        mockGetByKeys.mockReturnValue(new Promise(() => undefined));
      },
    ],
    [
      // R-1: the same refill also awaits the price lookup, behind the SAME
      // in-flight promise. Bounding only the row read left this one unbounded.
      'the price lookup hangs',
      () => {
        mockGetByKeys.mockResolvedValue(rows({ insights: { model: 'gpt-4o-2026' } }));
        mockGetPricing.mockReturnValue(new Promise(() => undefined));
      },
    ],
  ])('falls back to today when %s, instead of waiting for ever', async (_label, arrange) => {
    jest.useFakeTimers();
    arrange();

    const pending = resolveBosLlmSettings('insights', 'insight_content');
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(BOS_LLM_SETTINGS_READ_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await jest.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toMatchObject({ model: 'gpt-4o-mini', temperature: 0.3 });
    expect(
      issuesLogged('warn').some((line) => /Could not read Business OS LLM settings/.test(line.msg))
    ).toBe(true);
  });

  it('serves the last good settings when a later refill hangs (R-1)', async () => {
    mockGetByKeys.mockResolvedValue(rows({ insights: { model: 'gpt-4o' } }));
    expect((await resolveBosLlmSettings('insights', 'insight_content')).model).toBe('gpt-4o');

    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_CACHE_MS + 1);
    mockGetByKeys.mockReturnValue(new Promise(() => undefined));

    const pending = resolveBosLlmSettings('insights', 'insight_content');
    await jest.advanceTimersByTimeAsync(BOS_LLM_SETTINGS_READ_TIMEOUT_MS + 1);
    await expect(pending).resolves.toMatchObject({ model: 'gpt-4o' });
  });

  it('shares one in-flight read between concurrent callers', async () => {
    let release!: (value: unknown) => void;
    mockGetByKeys.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const pending = Promise.all([
      resolveBosLlmSettings('leads', 'reply_recommendation'),
      resolveBosLlmSettings('insights', 'insight_content'),
      isBosLlmAreaEnabled('chat'),
    ]);
    release(rows({ leads: { model: 'gpt-4o' } }));
    await pending;

    expect(mockGetByKeys).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T1-12 — the change log (FR-17, DEC-10.2)
// ---------------------------------------------------------------------------

describe('change log: labels only, never content (T1-12, FR-17)', () => {
  afterEach(() => jest.useRealTimers());

  it('logs nothing on the first load and the change on the next refill', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-20T12:00:00.000Z'));
    mockGetByKeys.mockResolvedValue(rows({ leads: { enabled: true } }));
    await resolveBosLlmSettings('leads', 'reply_recommendation');
    expect(issuesLogged('info')).toHaveLength(0);

    mockGetByKeys.mockResolvedValue(rows({ leads: { enabled: false } }, '2026-09-20T12:01:00.000Z'));
    jest.setSystemTime(Date.now() + BOS_LLM_SETTINGS_CACHE_MS);
    await resolveBosLlmSettings('leads', 'reply_recommendation');

    const change = issuesLogged('info').find((line) => line.fields.area === 'leads');
    expect(change?.fields).toMatchObject({ area: 'leads', rowUpdatedAt: '2026-09-20T12:01:00.000Z' });
    expect(change?.fields.changes).toEqual(
      expect.arrayContaining([
        { field: 'enabled', from: true, to: false },
        { callName: 'reply_recommendation', field: 'enabled', from: true, to: false },
      ])
    );
  });

  it('never logs a value that is not a platform label', async () => {
    const SENTINEL = 'OWNER-TEXT-MARKER-layer2';
    mockGetByKeys.mockResolvedValue(rows({ leads: { model: SENTINEL, note: SENTINEL } }));
    mockGetPricing.mockResolvedValue(null);
    await resolveBosLlmSettings('leads', 'reply_recommendation');

    // The rejected MODEL NAME is logged — it is a platform label, and DEC-7
    // requires naming the value that was refused. That is the only line the
    // sentinel may appear in: the unknown top-level key is reported by its KEY
    // name (`note`), never by the value stored under it.
    const withSentinel = logged.filter((line) => JSON.stringify(line).includes(SENTINEL));
    expect(withSentinel).toHaveLength(1);
    expect(withSentinel[0].fields).toMatchObject({ field: 'model', reason: 'unpriced_model' });
    expect(
      issuesLogged('warn').find((line) => line.fields.reason === 'unknown_field')?.fields.value
    ).toBe('note');
  });
});
