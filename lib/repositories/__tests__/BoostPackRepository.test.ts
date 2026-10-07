/**
 * Unit tests for `BoostPackRepository` — one block per method, against an
 * INJECTED Supabase double. They pin the query each method builds (the route's
 * historic behaviour: list ordered by `price_usd` ascending, update and delete
 * keyed by `id` only, no `updated_at` stamp) and the never-throws contract.
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

import { BoostPackRepository } from '../BoostPackRepository';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoostPackWriteInput } from '../types';

type QueryResult = { data: unknown; error: unknown };
type Call = { method: string; args: unknown[] };

interface Recorder {
  queries: Array<{ table: string; calls: Call[] }>;
  results: QueryResult[];
  throwOnFrom?: Error;
}

/** Every chained call is recorded; awaiting a builder takes the next queued result. */
function makeClient(recorder: Recorder): SupabaseClient {
  const CHAIN = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single'];

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

const PACK = {
  id: '11111111-1111-4111-8111-111111111111',
  pack_key: 'boost_quick',
  pack_name: 'Quick Boost',
  display_name: 'Quick Boost',
  description: 'Perfect for a quick credit refill',
  price_usd: 5,
  bonus_percentage: 0,
  credits_amount: 10417,
  bonus_credits: 0,
  badge_text: null,
  is_active: false,
};

function setup(results: QueryResult[] = [], throwOnFrom?: Error) {
  const recorder: Recorder = { queries: [], results: [...results], throwOnFrom };
  return { repo: new BoostPackRepository(makeClient(recorder)), recorder };
}

const methods = (recorder: Recorder) => recorder.queries[0]?.calls.map((c) => c.method);

describe('BoostPackRepository.listAll', () => {
  it('selects every row from boost_packs ordered by price_usd ascending', async () => {
    const { repo, recorder } = setup([{ data: [PACK], error: null }]);

    const result = await repo.listAll();

    expect(result).toEqual({ data: [PACK], error: null });
    expect(recorder.queries[0].table).toBe('boost_packs');
    expect(recorder.queries[0].calls).toEqual([
      { method: 'select', args: ['*'] },
      { method: 'order', args: ['price_usd', { ascending: true }] },
    ]);
  });

  it('returns [] when the table is empty', async () => {
    const { repo } = setup([{ data: null, error: null }]);
    expect(await repo.listAll()).toEqual({ data: [], error: null });
  });

  it('returns the error instead of throwing', async () => {
    const dbError = new Error('db down');
    const { repo } = setup([{ data: null, error: dbError }]);
    expect(await repo.listAll()).toEqual({ data: null, error: dbError });
  });
});

describe('BoostPackRepository.create', () => {
  it('inserts exactly the given fields and returns the stored row', async () => {
    const { repo, recorder } = setup([{ data: PACK, error: null }]);
    const input = Object.fromEntries(Object.entries(PACK).filter(([key]) => key !== 'id')) as BoostPackWriteInput;

    const result = await repo.create(input);

    expect(result).toEqual({ data: PACK, error: null });
    expect(methods(recorder)).toEqual(['insert', 'select', 'single']);
    expect(recorder.queries[0].calls[0].args[0]).toEqual(input);
  });

  it('returns the error instead of throwing (e.g. duplicate pack_key)', async () => {
    const dbError = { message: 'duplicate key value', code: '23505' };
    const { repo } = setup([{ data: null, error: dbError }]);
    expect(await repo.create({ pack_key: 'boost_quick' })).toEqual({ data: null, error: dbError });
  });
});

describe('BoostPackRepository.update', () => {
  it('updates by id only, without stamping updated_at, and returns the row', async () => {
    const { repo, recorder } = setup([{ data: PACK, error: null }]);

    const result = await repo.update(PACK.id, { is_active: false });

    expect(result).toEqual({ data: PACK, error: null });
    expect(recorder.queries[0].calls).toEqual([
      { method: 'update', args: [{ is_active: false }] },
      { method: 'eq', args: ['id', PACK.id] },
      { method: 'select', args: [] },
      { method: 'single', args: [] },
    ]);
  });

  it('returns the error when no row matched (PostgREST .single())', async () => {
    const dbError = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' };
    const { repo } = setup([{ data: null, error: dbError }]);
    expect(await repo.update('missing', { pack_name: 'x' })).toEqual({ data: null, error: dbError });
  });
});

describe('BoostPackRepository.deleteById', () => {
  it('hard-deletes by id and returns true', async () => {
    const { repo, recorder } = setup([{ data: null, error: null }]);

    const result = await repo.deleteById(PACK.id);

    expect(result).toEqual({ data: true, error: null });
    expect(recorder.queries[0].calls).toEqual([
      { method: 'delete', args: [] },
      { method: 'eq', args: ['id', PACK.id] },
    ]);
  });

  it('returns the error instead of throwing, even when the client itself throws', async () => {
    const thrown = new Error('client exploded');
    const { repo } = setup([], thrown);
    expect(await repo.deleteById(PACK.id)).toEqual({ data: null, error: thrown });
  });
});
