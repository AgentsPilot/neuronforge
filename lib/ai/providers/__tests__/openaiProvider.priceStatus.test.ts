/**
 * Deduction layer slice 2: the price signal OpenAIProvider puts on each call's
 * usage-scope record (chat, embeddings, images), and proof that the ledger row
 * is unchanged.
 *
 * The OpenAI SDK is replaced; `trackAICall` is observed directly. The ledger
 * payloads are LITERALS captured from the unmodified code at T0 (call_id and
 * latency_ms stripped, undefined fields omitted): P-1 never compares the new
 * code with itself.
 */

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

import { OpenAIProvider, type ImageGenerationParams } from '@/lib/ai/providers/openaiProvider';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import { calculateCostSync } from '@/lib/ai/pricing';
import { withUsageScope, type UsageCallRecord } from '@/lib/ai/usageScope';
import type { AICallData } from '@/lib/analytics/aiAnalytics';

const trackAICall = jest.fn();
const analytics = { trackAICall: (data: AICallData) => trackAICall(data) };

const USER = '2f734ed5-3681-4049-880d-3de7b096bea3';
const GROUP = '33333333-3333-4333-8333-333333333333';
const CHAT: CallContext = { userId: USER, sessionId: GROUP, feature: 'business-os-chat', component: 'planner' };
const EMBED: CallContext = { ...CHAT, component: 'plan_cache_lookup_embedding' };
const IMAGE: CallContext = { ...CHAT, feature: 'business-os-images', component: 'image_generation' };
const IMAGE_PARAMS: ImageGenerationParams = { model: 'gpt-image-1', prompt: 'p', size: '1024x1024', quality: 'auto', n: 1 };
const WARN_TEXT = 'No pricing found; recording $0 for this call';

const CHAT_USAGE = {
  prompt_tokens: 1200,
  completion_tokens: 300,
  total_tokens: 1500,
  prompt_tokens_details: { cached_tokens: 200 },
};

/** Captured at T0 from the unmodified code. */
const CAPTURED = {
  openaiChatPriced: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'gpt-4o', endpoint: 'chat/completions',
    feature: 'business-os-chat', component: 'planner', category: 'general', input_tokens: 1200, output_tokens: 300,
    cost_usd: 0.00575, response_size_bytes: 163, success: true, request_type: 'chat', metadata: { cached_input_tokens: 200 },
  },
  openaiChatUnpriced: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'gpt-imaginary', endpoint: 'chat/completions',
    feature: 'business-os-chat', component: 'planner', category: 'general', input_tokens: 1200, output_tokens: 300,
    cost_usd: 0, response_size_bytes: 163, success: true, request_type: 'chat', metadata: { cached_input_tokens: 200 },
  },
  openaiEmbedding: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'text-embedding-3-small', endpoint: 'embeddings',
    feature: 'business-os-chat', component: 'plan_cache_lookup_embedding', category: 'general', input_tokens: 10,
    output_tokens: 0, cost_usd: 2.0000000000000002e-7, response_size_bytes: 0, success: true, request_type: 'chat',
  },
  openaiImagePriced: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'gpt-image-1', endpoint: 'images/generate',
    feature: 'business-os-images', component: 'image_generation', category: 'general', input_tokens: 0, output_tokens: 0,
    cost_usd: 0.063, response_size_bytes: 0, success: true, request_type: 'image_generation',
  },
  openaiImageUnpriced: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'gpt-image-1', endpoint: 'images/generate',
    feature: 'business-os-images', component: 'image_generation', category: 'general', input_tokens: 0, output_tokens: 0,
    cost_usd: 0, response_size_bytes: 0, success: true, request_type: 'image_generation',
  },
  openaiChatFailure: {
    user_id: USER, session_id: GROUP, provider: 'openai', model_name: 'gpt-4o', endpoint: 'chat/completions',
    feature: 'business-os-chat', component: 'planner', category: 'general', input_tokens: 0, output_tokens: 0,
    cost_usd: 0, success: false, error_code: 'model_not_found', error_message: 'bad', request_type: 'chat',
  },
};

function provider(): OpenAIProvider {
  return new OpenAIProvider('test-key', analytics);
}

function row(): Record<string, unknown> {
  expect(trackAICall).toHaveBeenCalledTimes(1);
  const { call_id: _c, latency_ms: _l, ...rest } = trackAICall.mock.calls[0][0] as Record<string, unknown>;
  return rest;
}

async function inScope(fn: () => Promise<unknown>): Promise<UsageCallRecord[]> {
  const outcome = await withUsageScope(GROUP, fn);
  return outcome.usage.calls;
}

const chat = (model: string) =>
  provider().chatCompletion({ model, messages: [{ role: 'user', content: 'hi' }] }, CHAT);

beforeEach(() => {
  mockGenerate.mockReset();
  mockChatCreate.mockReset();
  mockEmbeddingsCreate.mockReset();
  trackAICall.mockReset();
  trackAICall.mockResolvedValue(undefined);
  mockLogged.length = 0;
  mockChatCreate.mockResolvedValue({ choices: [{ message: { content: 'hi' } }], usage: CHAT_USAGE });
  mockEmbeddingsCreate.mockResolvedValue({
    data: [],
    model: 'text-embedding-3-small',
    object: 'list',
    usage: { prompt_tokens: 10, total_tokens: 10 },
  });
  mockGenerate.mockResolvedValue({ created: 1, quality: 'medium', data: [{ b64_json: 'aGVsbG8=' }] });
});

describe('chat', () => {
  it('a priced model: { priced, token }, the cost calculateCostSync gives, and the captured ledger row', async () => {
    const [call] = await inScope(() => chat('gpt-4o'));
    expect(call.pricing).toEqual({ status: 'priced', unit: 'token' });
    // Cached input at half rate, exactly as the private calculateCost does it.
    expect(call.costUsd).toBe(calculateCostSync('openai', 'gpt-4o', 1000 + 100, 300));
    expect(row()).toEqual(CAPTURED.openaiChatPriced);
  });

  it('an unpriced model: { unpriced, token }, cost 0, the missing-price warn exactly once, the captured row', async () => {
    const [call] = await inScope(() => chat('gpt-imaginary'));
    expect(call.pricing).toEqual({ status: 'unpriced', unit: 'token' });
    expect(call.costUsd).toBe(0);
    expect(mockLogged.filter((l) => l.msg === WARN_TEXT)).toHaveLength(1);
    expect(mockLogged.filter((l) => l.level === 'error')).toHaveLength(0);
    expect(row()).toEqual(CAPTURED.openaiChatUnpriced);
  });

  it('a thrown call: no signal on the record, and the captured failure row', async () => {
    mockChatCreate.mockRejectedValue(Object.assign(new Error('bad'), { code: 'model_not_found' }));
    const calls = await inScope(() => chat('gpt-4o').catch(() => undefined));
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('pricing');
    expect(row()).toEqual(CAPTURED.openaiChatFailure);
  });

  it('outside a scope: the ledger row is the same captured literal', async () => {
    await chat('gpt-4o');
    expect(row()).toEqual(CAPTURED.openaiChatPriced);
  });
});

describe('embeddings', () => {
  it('{ priced, token }, the non-zero sub-micro-dollar cost, and the captured row', async () => {
    const [call] = await inScope(() =>
      provider().createEmbedding({ model: 'text-embedding-3-small', input: 'x' }, EMBED)
    );
    expect(call.pricing).toEqual({ status: 'priced', unit: 'token' });
    expect(call.costUsd).toBe(2.0000000000000002e-7);
    expect(row()).toEqual(CAPTURED.openaiEmbedding);
  });

  it('an unpriced embedding model: { unpriced, token }', async () => {
    const [call] = await inScope(() =>
      provider().createEmbedding({ model: 'text-embedding-imaginary', input: 'x' }, EMBED)
    );
    expect(call.pricing).toEqual({ status: 'unpriced', unit: 'token' });
    expect(call.costUsd).toBe(0);
  });
});

describe('images', () => {
  it('a price > 0: { priced, image }, priceFor called once, and the captured row', async () => {
    const priceFor = jest.fn().mockReturnValue(0.063);
    const [call] = await inScope(() => provider().generateImage(IMAGE_PARAMS, IMAGE, priceFor));
    expect(priceFor).toHaveBeenCalledTimes(1);
    expect(call.pricing).toEqual({ status: 'priced', unit: 'image' });
    expect(call.costUsd).toBe(0.063);
    expect(row()).toEqual(CAPTURED.openaiImagePriced);
  });

  it('a resolver that gives 0: { unpriced, image }, priceFor called once, and the captured row', async () => {
    const priceFor = jest.fn().mockReturnValue(0);
    const [call] = await inScope(() => provider().generateImage(IMAGE_PARAMS, IMAGE, priceFor));
    expect(priceFor).toHaveBeenCalledTimes(1);
    expect(call.pricing).toEqual({ status: 'unpriced', unit: 'image' });
    expect(call.costUsd).toBe(0);
    expect(row()).toEqual(CAPTURED.openaiImageUnpriced);
  });

  it('a thrown call: no signal, and priceFor is never called', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));
    const priceFor = jest.fn().mockReturnValue(0.25);
    const calls = await inScope(() => provider().generateImage(IMAGE_PARAMS, IMAGE, priceFor).catch(() => undefined));
    expect(priceFor).not.toHaveBeenCalled();
    expect(calls[0]).not.toHaveProperty('pricing');
  });
});
