/**
 * AI image generation through the provider layer (Layer 1.5 FR-8 to FR-16,
 * AC-6 to AC-9, AC-11).
 *
 * The real OpenAIProvider runs against a mocked SDK, so `trackAICall` receives
 * exactly the row the ledger would store. Storage and the media repository are
 * mocked to drive every edge of FR-9.
 */

const mockGenerate = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({ images: { generate: (...a: unknown[]) => mockGenerate(...a) } }))
);

const logged: Array<{ level: string; args: unknown[] }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => logged.push({ level, args });
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockUpload = jest.fn();
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => mockUpload(...a),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
      }),
    },
  },
}));

const mockMedia = { findBySourceRef: jest.fn(), countGeneratedSince: jest.fn(), record: jest.fn() };
jest.mock('@/lib/repositories/UserMediaRepository', () => ({ userMediaRepository: mockMedia }));

const mockGetImageConfig = jest.fn();
jest.mock('@/lib/repositories/SystemConfigRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/SystemConfigRepository');
  return { ...actual, systemConfigRepository: { getImageGenerationConfig: () => mockGetImageConfig() } };
});

import * as fs from 'fs';
import * as path from 'path';
import {
  generateImage,
  imagePriceResolver,
  resolveImagePrice,
  DAILY_GENERATION_LIMIT,
  UNREPORTED_QUALITY_PRICED_AS,
} from '../GeneratedImageService';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { IMAGE_GENERATION_REQUEST_TYPE, OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import {
  IMAGE_FALLBACK_PRICING,
  IMAGE_GENERATION_CONFIG_DEFAULTS,
  type ImageGenerationConfig,
} from '@/lib/repositories/SystemConfigRepository';
import { AIAnalyticsService, type AICallData } from '@/lib/analytics/aiAnalytics';
import type { BosLlmOwner } from '@/lib/business-os/llm/callCatalog';

const OWNER: BosLlmOwner = {
  userId: '2f734ed5-3681-4049-880d-3de7b096bea3',
  groupId: '33333333-3333-4333-8333-333333333333',
};
const PROMPT = 'An oak reception desk in soft morning light';

const trackAICall = jest.fn();

function defaults(): ImageGenerationConfig {
  return {
    ...IMAGE_GENERATION_CONFIG_DEFAULTS,
    sizes: { ...IMAGE_GENERATION_CONFIG_DEFAULTS.sizes },
    pricesUsd: {},
  };
}

function rows(): AICallData[] {
  return trackAICall.mock.calls.map((c) => c[0] as AICallData);
}

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

beforeEach(() => {
  logged.length = 0;
  mockGenerate.mockReset();
  mockUpload.mockReset();
  trackAICall.mockReset();
  trackAICall.mockResolvedValue(undefined);
  Object.values(mockMedia).forEach((fn) => fn.mockReset());

  process.env.OPENAI_API_KEY = 'test-key';
  mockMedia.findBySourceRef.mockResolvedValue(null);
  mockMedia.countGeneratedSince.mockResolvedValue(0);
  mockMedia.record.mockResolvedValue({ id: 'm1' });
  mockUpload.mockResolvedValue({ error: null });
  mockGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: Buffer.from('png').toString('base64') }] });
  mockGetImageConfig.mockResolvedValue(defaults());

  jest
    .spyOn(ProviderFactory, 'getOpenAI')
    .mockReturnValue(new OpenAIProvider('test-key', { trackAICall: (d: AICallData) => trackAICall(d) }));
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe('a successful generation (AC-6)', () => {
  it('writes exactly one row: the owner, images / image_generation, the group, zero tokens, a cost', async () => {
    const outcome = await generateImage(OWNER, PROMPT, 'wide', 'hero');

    expect(outcome).toMatchObject({ ok: true });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      user_id: OWNER.userId,
      session_id: OWNER.groupId,
      feature: 'business-os-images',
      component: 'image_generation',
      request_type: IMAGE_GENERATION_REQUEST_TYPE,
      model_name: IMAGE_GENERATION_CONFIG_DEFAULTS.model,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: IMAGE_FALLBACK_PRICING[`${IMAGE_GENERATION_CONFIG_DEFAULTS.model}:1536x1024:high`],
      success: true,
    });
  });

  it('asks for one image at the configured size, sending quality auto by default (AC-8, AC-9, CR-1 C)', async () => {
    await generateImage(OWNER, PROMPT, 'portrait', 'about');
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({
      model: IMAGE_GENERATION_CONFIG_DEFAULTS.model,
      size: '1024x1536',
      quality: 'auto',
      n: 1,
    });
  });

  it('keeps the prompt out of the ledger row and out of the logs (WC-4)', async () => {
    await generateImage(OWNER, PROMPT, 'wide', 'hero');
    expect(rows()[0].request_payload).toBeUndefined();
    expect(JSON.stringify(rows()[0])).not.toContain(PROMPT);
    expect(JSON.stringify(logged)).not.toContain(PROMPT);
  });

  it('constructs no OpenAI client of its own and names no image model (AC-6, AC-8)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GeneratedImageService.ts'), 'utf8');
    expect(source).not.toMatch(/from 'openai'/);
    expect(source).not.toMatch(/new OpenAI\(/);
    expect(source).not.toContain('OPENAI_API_KEY');
    expect(source).not.toMatch(/gpt-image/);
  });
});

describe('no row for anything refused before the provider call (AC-7 a)', () => {
  it('provider unavailable', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(trackAICall).not.toHaveBeenCalled();
  });

  it('a request for people', async () => {
    await expect(generateImage(OWNER, 'a portrait of our team', 'wide', 'hero')).resolves.toEqual({
      ok: false,
      reason: 'depicts_people',
    });
    expect(trackAICall).not.toHaveBeenCalled();
  });

  it('a reuse-cache hit', async () => {
    mockMedia.findBySourceRef.mockResolvedValue({ public_url: 'https://cdn.example/x.png', description: 'x' });
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toMatchObject({ ok: true });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(trackAICall).not.toHaveBeenCalled();
  });

  it('an unreadable daily count (still fails closed, FR-16)', async () => {
    mockMedia.countGeneratedSince.mockResolvedValue(null);
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(trackAICall).not.toHaveBeenCalled();
  });

  it('the daily cap reached (unchanged, FR-16)', async () => {
    mockMedia.countGeneratedSince.mockResolvedValue(DAILY_GENERATION_LIMIT);
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({
      ok: false,
      reason: 'limit_reached',
      used: DAILY_GENERATION_LIMIT,
      limit: DAILY_GENERATION_LIMIT,
    });
    expect(trackAICall).not.toHaveBeenCalled();
  });
});

describe('rows for what reached the provider (AC-7 b-d)', () => {
  it('a thrown provider call writes the failure row and the service still returns failed', async () => {
    mockGenerate.mockRejectedValue(Object.assign(new Error('The model does-not-exist does not exist'), { code: 'model_not_found' }));

    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'failed' });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      success: false,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      feature: 'business-os-images',
      component: 'image_generation',
      session_id: OWNER.groupId,
    });
  });

  it('a 200 with no image data keeps its priced row and returns failed', async () => {
    mockGenerate.mockResolvedValue({ created: 1, data: [] });
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ success: true, cost_usd: expect.any(Number) });
    expect(rows()[0].cost_usd).toBeGreaterThan(0);
  });

  it('a storage failure after generation keeps the row', async () => {
    mockUpload.mockResolvedValue({ error: new Error('bucket full') });
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].success).toBe(true);
  });

  it('a media-record failure after generation keeps the row', async () => {
    mockMedia.record.mockRejectedValue(new Error('insert failed'));
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].success).toBe(true);
  });
});

describe('a failed ledger write never fails the image (AC-11, FR-15)', () => {
  it('returns the image when the tracker cannot insert', async () => {
    const failingDb = {
      from: () => ({ insert: () => ({ select: () => Promise.resolve({ data: null, error: new Error('db down') }) }) }),
    };
    // The real tracker: it logs and swallows its own failures.
    const tracker = new AIAnalyticsService(failingDb);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(ProviderFactory, 'getOpenAI').mockReturnValue(new OpenAIProvider('test-key', tracker));

    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toMatchObject({ ok: true });
  });
});

describe('price resolution (AC-8, FR-13)', () => {
  it('uses the configured price first', async () => {
    const config = defaults();
    config.pricesUsd = { [`${config.model}:1536x1024:high`]: 0.3 };
    mockGetImageConfig.mockResolvedValue(config);
    await generateImage(OWNER, PROMPT, 'wide', 'hero');
    expect(rows()[0].cost_usd).toBe(0.3);
  });

  it('then the documented fallback', () => {
    const { model } = IMAGE_GENERATION_CONFIG_DEFAULTS;
    expect(resolveImagePrice({}, model, '1024x1024', 'medium')).toEqual({
      usdPerImage: IMAGE_FALLBACK_PRICING[`${model}:1024x1024:medium`],
      source: 'fallback',
    });
  });

  it('then 0, with an error log naming model, size and quality only — and the row is still written', async () => {
    const config = defaults();
    config.model = 'unpriced-model';
    mockGetImageConfig.mockResolvedValue(config);

    await expect(generateImage(OWNER, PROMPT, 'square', 'hero')).resolves.toMatchObject({ ok: true });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ cost_usd: 0, model_name: 'unpriced-model' });
    const error = logged.find((l) => l.level === 'error' && String(l.args[1]).includes('No price'));
    expect(error?.args[0]).toEqual({ model: 'unpriced-model', size: '1024x1024', quality: 'high' });
  });

  it('keys the price on model, size and quality', () => {
    const prices = { 'm:1024x1024:low': 0.01, 'm:1024x1024:high': 0.2 };
    expect(resolveImagePrice(prices, 'm', '1024x1024', 'low').usdPerImage).toBe(0.01);
    expect(resolveImagePrice(prices, 'm', '1024x1024', 'high').usdPerImage).toBe(0.2);
  });

  it('falls back to the default size and quality when configuration names unsupported ones', async () => {
    const config = defaults();
    config.sizes.wide = '9999x9999';
    config.quality = 'ultra';
    mockGetImageConfig.mockResolvedValue(config);
    await generateImage(OWNER, PROMPT, 'wide', 'hero');
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({ size: '1536x1024', quality: 'auto' });
  });
});

/*
 * CR-1 option C (user decision 2026-09-18) and CR-5: the request keeps `auto`,
 * and each image is priced by the quality the provider REPORTS it used, keyed
 * on model + size + reported quality. This is the pricing path, not a warning.
 */
describe('pricing by the reported quality (CR-1 option C, CR-5)', () => {
  const MODEL = IMAGE_GENERATION_CONFIG_DEFAULTS.model;

  function respondWith(quality: string | undefined) {
    mockGenerate.mockResolvedValue({
      created: 1,
      ...(quality ? { quality } : {}),
      data: [{ b64_json: Buffer.from('png').toString('base64') }],
    });
  }

  function warnings(): Array<{ fields: Record<string, unknown>; msg: string }> {
    return logged
      .filter((l) => l.level === 'warn')
      .map((l) => ({ fields: l.args[0] as Record<string, unknown>, msg: String(l.args[1]) }));
  }

  it.each([
    ['medium', '1536x1024'],
    ['high', '1536x1024'],
    ['low', '1536x1024'],
  ])('reported %s → the row carries the %s price at that size, with no warning', async (reported, size) => {
    respondWith(reported);
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toMatchObject({ ok: true });

    expect(rows()).toHaveLength(1);
    expect(rows()[0].cost_usd).toBe(IMAGE_FALLBACK_PRICING[`${MODEL}:${size}:${reported}`]);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({ quality: 'auto' });
    expect(warnings()).toEqual([]);
  });

  it('uses a configured price for the reported quality before the fallback', async () => {
    const config = defaults();
    config.pricesUsd = { [`${MODEL}:1024x1024:medium`]: 0.05 };
    mockGetImageConfig.mockResolvedValue(config);
    respondWith('medium');

    await generateImage(OWNER, PROMPT, 'square', 'hero');
    expect(rows()[0].cost_usd).toBe(0.05);
  });

  it('no reported quality → priced at high, with a warning that names no prompt', async () => {
    respondWith(undefined);
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toMatchObject({ ok: true });

    expect(rows()[0].cost_usd).toBe(IMAGE_FALLBACK_PRICING[`${MODEL}:1536x1024:${UNREPORTED_QUALITY_PRICED_AS}`]);
    expect(UNREPORTED_QUALITY_PRICED_AS).toBe('high');
    const warning = warnings().find((w) => w.msg.includes('reported no image quality'));
    expect(warning?.fields).toEqual({ model: MODEL, size: '1536x1024', requestedQuality: 'auto', pricedAs: 'high' });
    expect(JSON.stringify(logged)).not.toContain(PROMPT);
  });

  it('a pinned quality that differs from the reported one is priced by the reported one, with a warning', async () => {
    const config = defaults();
    config.quality = 'high';
    mockGetImageConfig.mockResolvedValue(config);
    respondWith('medium');

    await generateImage(OWNER, PROMPT, 'wide', 'hero');

    expect(mockGenerate.mock.calls[0][0]).toMatchObject({ quality: 'high' });
    expect(rows()[0].cost_usd).toBe(IMAGE_FALLBACK_PRICING[`${MODEL}:1536x1024:medium`]);
    const warning = warnings().find((w) => w.msg.includes('different quality than requested'));
    expect(warning?.fields).toEqual({ model: MODEL, size: '1536x1024', requestedQuality: 'high', reportedQuality: 'medium' });
  });

  it('an unknown reported quality → $0 with an error naming model, size and quality, and the row is still written', async () => {
    respondWith('ultra');
    await expect(generateImage(OWNER, PROMPT, 'wide', 'hero')).resolves.toMatchObject({ ok: true });

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ cost_usd: 0, success: true });
    const error = logged.find((l) => l.level === 'error' && String(l.args[1]).includes('No price'));
    expect(error?.args[0]).toEqual({ model: MODEL, size: '1536x1024', quality: 'ultra' });
  });

  it('an unknown size (configured model with no fallback prices) → $0 with the same error', async () => {
    const config = defaults();
    config.model = 'unpriced-model';
    mockGetImageConfig.mockResolvedValue(config);
    respondWith('medium');

    await generateImage(OWNER, PROMPT, 'portrait', 'hero');

    expect(rows()[0].cost_usd).toBe(0);
    const error = logged.find((l) => l.level === 'error' && String(l.args[1]).includes('No price'));
    expect(error?.args[0]).toEqual({ model: 'unpriced-model', size: '1024x1536', quality: 'medium' });
  });

  it('the resolver never throws: a pricing error records $0 and keeps the image a success', () => {
    const throwingPrices = new Proxy({} as Record<string, number>, {
      get: () => {
        throw new Error('bad price table');
      },
    });
    const resolver = imagePriceResolver(throwingPrices, MODEL, '1024x1024', 'auto');
    expect(resolver.priceFor('medium')).toBe(0);
    expect(logged.some((l) => l.level === 'error' && String(l.args[1]).includes('Could not price'))).toBe(true);
  });

  it('last() reports what was priced and on what basis', () => {
    const resolver = imagePriceResolver({}, MODEL, '1024x1024', 'auto');
    expect(resolver.last()).toBeNull();
    resolver.priceFor('low');
    expect(resolver.last()).toEqual({
      usdPerImage: IMAGE_FALLBACK_PRICING[`${MODEL}:1024x1024:low`],
      source: 'fallback',
      pricedQuality: 'low',
      qualityReported: true,
    });
  });
});
