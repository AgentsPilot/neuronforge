/**
 * `getProviderFactory().complete()` gained an optional usage context.
 * Callers that pass one are recorded against it; callers that don't (the
 * onboarding conversation) keep the exact old default.
 */

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

jest.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}));

import { ProviderFactory, getProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider, CallContext } from '@/lib/ai/providers/baseProvider';
import { buildBosCallContext } from '@/lib/business-os/llm/callCatalog';

const U1 = '11111111-1111-4111-8111-111111111111';
const G1 = '33333333-3333-4333-8333-333333333333';

const chatCompletion = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'hello' } }] });
  jest
    .spyOn(ProviderFactory, 'getProvider')
    .mockReturnValue({ chatCompletion } as unknown as BaseAIProvider);
});

afterAll(() => {
  jest.restoreAllMocks();
});

const params = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0.3,
};

describe('getProviderFactory().complete', () => {
  it('passes a supplied context to the provider unchanged', async () => {
    const context: CallContext = buildBosCallContext({
      userId: U1,
      area: 'intake',
      callName: 'form_generation',
      groupId: G1,
    });

    await getProviderFactory().complete(params, context);

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(chatCompletion.mock.calls[0][1]).toBe(context);
    expect(chatCompletion.mock.calls[0][1]).toStrictEqual({
      userId: U1,
      feature: 'business-os-intake',
      component: 'form_generation',
      sessionId: G1,
    });
  });

  it('keeps the exact platform default when no context is given', async () => {
    await getProviderFactory().complete(params);

    expect(chatCompletion.mock.calls[0][1]).toStrictEqual({
      userId: 'system',
      feature: 'onboarding',
      component: 'simple-complete',
    });
  });

  it('still returns the content for a one-argument caller', async () => {
    const result = await getProviderFactory().complete({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    });

    expect(result).toEqual({ content: 'hello' });
    expect(chatCompletion.mock.calls[0][0]).toEqual({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      response_format: { type: 'json_object' },
    });
  });

  it('completes and calls the provider exactly once with an invalid account', async () => {
    const context = buildBosCallContext({
      userId: 'system',
      area: 'website',
      callName: 'full_site',
      groupId: G1,
      correlationId: 'corr-1',
    });

    const result = await getProviderFactory().complete(params, context);

    expect(result).toEqual({ content: 'hello' });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({
      area: 'website',
      callName: 'full_site',
      correlationId: 'corr-1',
    });
  });
});
