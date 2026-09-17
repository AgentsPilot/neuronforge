/**
 * Business OS callers now name their embedding calls. The help bot callers and
 * the batch path must keep recording exactly what they recorded before.
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/services/SystemConfigService', () => ({
  SystemConfigService: {
    getString: jest.fn(async (_supabase: unknown, _key: string, fallback: string) => fallback),
    getNumber: jest.fn(async (_supabase: unknown, _key: string, fallback: number) => fallback),
  },
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { BaseAIProvider } from '@/lib/ai/providers/baseProvider';
import { EmbeddingService } from '@/lib/services/EmbeddingService';

const U1 = '11111111-1111-4111-8111-111111111111';
const T1 = '44444444-4444-4444-8444-444444444444';

const createEmbedding = jest.fn();

function service(): EmbeddingService {
  return new EmbeddingService('unused', {} as unknown as SupabaseClient);
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SYSTEM_ADMIN_USER_ID;
  createEmbedding.mockImplementation(async (params: { input: string | string[] }) => ({
    data: (Array.isArray(params.input) ? params.input : [params.input]).map(() => ({ embedding: [0.1, 0.2] })),
    usage: { total_tokens: 7 },
  }));
  jest
    .spyOn(ProviderFactory, 'getProvider')
    .mockReturnValue({ createEmbedding } as unknown as BaseAIProvider);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('EmbeddingService attribution', () => {
  it('keeps the help bot default context byte-for-byte when no attribution is given', async () => {
    await service().generateEmbedding('How do I reset my password?');

    expect(createEmbedding.mock.calls[0][1]).toStrictEqual({
      userId: '00000000-0000-0000-0000-000000000000',
      feature: 'helpbot',
      component: 'EmbeddingService',
      category: 'embedding_generation',
      activity_type: 'embedding',
      activity_name: 'generate_embedding',
      sessionId: undefined,
    });
  });

  it('uses SYSTEM_ADMIN_USER_ID for the default when set', async () => {
    process.env.SYSTEM_ADMIN_USER_ID = U1;

    await service().generateEmbedding('text');

    expect(createEmbedding.mock.calls[0][1].userId).toBe(U1);
  });

  it('keeps the batch context unchanged', async () => {
    await service().generateBatchEmbeddings(['a', 'b']);

    expect(createEmbedding.mock.calls[0][1]).toStrictEqual({
      userId: '00000000-0000-0000-0000-000000000000',
      feature: 'helpbot',
      component: 'EmbeddingService',
      category: 'embedding_generation',
      activity_type: 'batch_embedding',
      activity_name: 'generate_batch_embeddings',
    });
  });

  it('records a supplied call name as the component, keeping category and activity', async () => {
    await service().generateEmbedding('text', {
      userId: U1,
      feature: 'business-os-chat',
      turnId: T1,
      callName: 'plan_cache_store_embedding',
    });

    expect(createEmbedding.mock.calls[0][1]).toStrictEqual({
      userId: U1,
      feature: 'business-os-chat',
      component: 'plan_cache_store_embedding',
      category: 'embedding_generation',
      activity_type: 'embedding',
      activity_name: 'generate_embedding',
      sessionId: T1,
    });
  });

  it('keeps component EmbeddingService when attribution has no call name', async () => {
    await service().generateEmbedding('text', { userId: U1, feature: 'business-os-chat', turnId: T1 });

    expect(createEmbedding.mock.calls[0][1].component).toBe('EmbeddingService');
  });
});
