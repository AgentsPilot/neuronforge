/**
 * `AiModelImagePricingRepository` (AI model price review slice 7, RC7-12).
 *
 * Every case runs against an INJECTED Supabase double: the read filter and
 * order of both methods, the exact-text cast, and the never-throws rule.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = () => undefined;
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// The repository's default client must never be constructed in a unit test.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: undefined }));

import { AiModelImagePricingRepository } from '../AiModelImagePricingRepository';
import type { SupabaseClient } from '@supabase/supabase-js';

type QueryResult = { data: unknown; error: unknown };
type Call = { method: string; args: unknown[] };

interface Recorder {
  queries: Array<{ table: string; calls: Call[] }>;
  results: QueryResult[];
  throwOnFrom?: Error;
}

function makeClient(recorder: Recorder): SupabaseClient {
  const CHAIN = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'lte', 'order', 'limit', 'maybeSingle', 'single'];
  return {
    from(table: string) {
      if (recorder.throwOnFrom) throw recorder.throwOnFrom;
      const query = { table, calls: [] as Call[] };
      recorder.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of CHAIN) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (resolve: (r: QueryResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(recorder.results.shift() ?? { data: null, error: null }).then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const TODAY = new Date().toISOString().slice(0, 10);

const ROW = {
  id: 'i1',
  provider: 'openai',
  model_name: 'gpt-image-2.5-flare',
  size: '1024x1024',
  quality: 'high',
  cost_per_image: 0.054,
  effective_date: '2026-10-16',
  created_at: '2026-10-16T00:00:00+00:00',
};

describe.each([
  ['listActive', 'id, provider, model_name, size, quality, cost_per_image, effective_date, created_at'],
  ['listActiveExact', 'id, provider, model_name, size, quality, cost_per_image::text, effective_date, created_at'],
] as const)('%s', (method, select) => {
  it('reads active, in-effect rows of the image table, newest first', async () => {
    const recorder: Recorder = { queries: [], results: [{ data: [ROW], error: null }] };
    const repo = new AiModelImagePricingRepository(makeClient(recorder));

    const result = await repo[method]();

    expect(result).toEqual({ data: [ROW], error: null });
    expect(recorder.queries).toHaveLength(1);
    expect(recorder.queries[0].table).toBe('ai_model_image_pricing');
    expect(recorder.queries[0].calls).toEqual([
      { method: 'select', args: [select] },
      { method: 'is', args: ['retired_date', null] },
      { method: 'lte', args: ['effective_date', TODAY] },
      { method: 'order', args: ['effective_date', { ascending: false }] },
      { method: 'order', args: ['created_at', { ascending: false }] },
    ]);
  });

  it('an empty table is an empty list, not an error', async () => {
    const recorder: Recorder = { queries: [], results: [{ data: [], error: null }] };
    const repo = new AiModelImagePricingRepository(makeClient(recorder));
    expect(await repo[method]()).toEqual({ data: [], error: null });
  });

  it('a null data with no error is an empty list', async () => {
    const recorder: Recorder = { queries: [], results: [{ data: null, error: null }] };
    const repo = new AiModelImagePricingRepository(makeClient(recorder));
    expect(await repo[method]()).toEqual({ data: [], error: null });
  });

  it('a query error comes back as { data: null, error }, never thrown', async () => {
    const failure = { message: 'boom', code: '42P01' };
    const recorder: Recorder = { queries: [], results: [{ data: null, error: failure }] };
    const repo = new AiModelImagePricingRepository(makeClient(recorder));
    expect(await repo[method]()).toEqual({ data: null, error: failure });
  });

  it('a thrown client error comes back as { data: null, error }', async () => {
    const failure = new Error('network');
    const recorder: Recorder = { queries: [], results: [], throwOnFrom: failure };
    const repo = new AiModelImagePricingRepository(makeClient(recorder));
    expect(await repo[method]()).toEqual({ data: null, error: failure });
  });
});

// Slice 9: the admin history read is the third (LW-2 lists it too; its callers are pinned by adminReadMethods.guard).
it('has no method besides the three reads', () => {
  const methods = Object.getOwnPropertyNames(AiModelImagePricingRepository.prototype).filter((name) => name !== 'constructor');
  expect(methods.sort()).toEqual(['listActive', 'listActiveExact', 'listHistoryExact']);
});
