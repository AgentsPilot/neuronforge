/**
 * OpenAIProvider.generateImage (Layer 1.5 FR-8, FR-9, AC-6, AC-7) and the
 * request-type default in callWithTracking.
 *
 * The OpenAI SDK is replaced; `trackAICall` is observed directly, since what it
 * receives is exactly what the ledger row will contain.
 */

const mockGenerate = jest.fn();
const mockChatCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    images: { generate: (...args: unknown[]) => mockGenerate(...args) },
    chat: { completions: { create: (...args: unknown[]) => mockChatCreate(...args) } },
  }));
});

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  IMAGE_GENERATION_REQUEST_TYPE,
  OpenAIProvider,
  type ImageGenerationParams,
} from '@/lib/ai/providers/openaiProvider';
import type { CallContext } from '@/lib/ai/providers/baseProvider';
import type { AICallData } from '@/lib/analytics/aiAnalytics';

const trackAICall = jest.fn();
const analytics = { trackAICall: (data: AICallData) => trackAICall(data) };

const CONTEXT: CallContext = {
  userId: '2f734ed5-3681-4049-880d-3de7b096bea3',
  feature: 'business-os-images',
  component: 'image_generation',
  sessionId: '33333333-3333-4333-8333-333333333333',
};

const PROMPT = 'A quiet treatment room with oak shelves';
const PARAMS: ImageGenerationParams = {
  model: 'gpt-image-1',
  prompt: PROMPT,
  size: '1536x1024',
  quality: 'high',
  n: 1,
};

/** A resolver that prices every image at $0.25, whatever quality is reported. */
const PRICE_025 = () => 0.25;

function provider(): OpenAIProvider {
  return new OpenAIProvider('test-key', analytics);
}

function tracked(): AICallData {
  expect(trackAICall).toHaveBeenCalledTimes(1);
  return trackAICall.mock.calls[0][0] as AICallData;
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockChatCreate.mockReset();
  trackAICall.mockReset();
  trackAICall.mockResolvedValue(undefined);
});

describe('OpenAIProvider.generateImage', () => {
  it('writes one row: zero tokens, the per-image cost, the image request type, success', async () => {
    mockGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });

    await provider().generateImage(PARAMS, CONTEXT, PRICE_025);

    const row = tracked();
    expect(row).toMatchObject({
      user_id: CONTEXT.userId,
      session_id: CONTEXT.sessionId,
      feature: 'business-os-images',
      component: 'image_generation',
      provider: 'openai',
      model_name: 'gpt-image-1',
      endpoint: 'images/generate',
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0.25,
      success: true,
      request_type: IMAGE_GENERATION_REQUEST_TYPE,
    });
    expect(IMAGE_GENERATION_REQUEST_TYPE).toBe('image_generation');
  });

  it('asks the provider for exactly one image, with the explicit size and quality', async () => {
    mockGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });
    await provider().generateImage(PARAMS, CONTEXT, PRICE_025);
    expect(mockGenerate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: PROMPT,
      size: '1536x1024',
      quality: 'high',
      n: 1,
    });
  });

  it('a thrown call writes the failure row (zero tokens, zero cost) and re-throws', async () => {
    mockGenerate.mockRejectedValue(Object.assign(new Error('model not found'), { code: 'model_not_found' }));

    await expect(provider().generateImage(PARAMS, CONTEXT, PRICE_025)).rejects.toThrow('model not found');

    expect(tracked()).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      success: false,
      error_code: 'model_not_found',
      request_type: IMAGE_GENERATION_REQUEST_TYPE,
      feature: 'business-os-images',
      component: 'image_generation',
      session_id: CONTEXT.sessionId,
    });
  });

  it('never puts the prompt into the ledger row (WC-4)', async () => {
    mockGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });
    await provider().generateImage(PARAMS, CONTEXT, PRICE_025);
    const row = tracked();
    expect(row.request_payload).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(PROMPT);
  });

  it('refuses n other than 1, before any call or row (WC-3)', async () => {
    const bad = { ...PARAMS, n: 2 } as unknown as ImageGenerationParams;
    await expect(provider().generateImage(bad, CONTEXT, PRICE_025)).rejects.toThrow('n must be 1');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(trackAICall).not.toHaveBeenCalled();
  });
});

describe('callWithTracking request type', () => {
  it("still records 'chat' for a call that names no request type", async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    await provider().chatCompletion({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }, CONTEXT);
    expect(tracked().request_type).toBe('chat');
  });

  it('records the request type a caller names', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    await provider().chatCompletion(
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      { ...CONTEXT, requestType: 'custom_kind' }
    );
    expect(tracked().request_type).toBe('custom_kind');
  });
});

describe('pricing after the call (CR-1 option C)', () => {
  it('hands the reported quality to the resolver and records its price in the same row', async () => {
    mockGenerate.mockResolvedValue({ created: 1, quality: 'medium', data: [{ b64_json: 'aGVsbG8=' }] });
    const priceFor = jest.fn().mockReturnValue(0.063);

    await provider().generateImage({ ...PARAMS, quality: 'auto' }, CONTEXT, priceFor);

    expect(priceFor).toHaveBeenCalledTimes(1);
    expect(priceFor).toHaveBeenCalledWith('medium');
    expect(tracked().cost_usd).toBe(0.063);
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({ quality: 'auto' });
  });

  it('passes undefined when the provider reports no quality', async () => {
    mockGenerate.mockResolvedValue({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });
    const priceFor = jest.fn().mockReturnValue(0.25);
    await provider().generateImage(PARAMS, CONTEXT, priceFor);
    expect(priceFor).toHaveBeenCalledWith(undefined);
  });

  it('does not price a failed call: the failure row costs 0', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));
    const priceFor = jest.fn().mockReturnValue(0.25);
    await expect(provider().generateImage(PARAMS, CONTEXT, priceFor)).rejects.toThrow('boom');
    expect(priceFor).not.toHaveBeenCalled();
    expect(tracked()).toMatchObject({ success: false, cost_usd: 0 });
  });
});
