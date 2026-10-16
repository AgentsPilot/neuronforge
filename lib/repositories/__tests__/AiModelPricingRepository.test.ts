/**
 * T0-8 (Layer 2 Step 0, SA addendum §G) for `AiModelPricingRepository`.
 *
 * Every case runs against an INJECTED Supabase double, so this is a real unit
 * test of the repository's own contract: the read filters and ordering, and the
 * never-throws rule. Since AI model price review slice 6 the repository is
 * read-only; the write and sync cases went with the methods.
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

import { AiModelPricingRepository } from '../AiModelPricingRepository';
import type { SupabaseClient } from '@supabase/supabase-js';

type QueryResult = { data: unknown; error: unknown };
type Call = { method: string; args: unknown[] };

interface Recorder {
  queries: Array<{ table: string; calls: Call[] }>;
  results: QueryResult[];
  throwOnFrom?: Error;
}

/** Every chained call is recorded; awaiting a builder takes the next queued result. */
function makeClient(recorder: Recorder): SupabaseClient {
  const CHAIN = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    // `is` and `lte` are how `listActive` filters out retired and not-yet-effective rows.
    'is',
    'lte',
    'order',
    'limit',
    'maybeSingle',
    'single',
  ];

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
        Promise.resolve(recorder.results.shift() ?? { data: null, error: null }).then(
          resolve,
          reject
        );
      return builder;
    },
  } as unknown as SupabaseClient;
}

function methodsOf(query: { calls: Call[] }): string[] {
  return query.calls.map((c) => c.method);
}

function allMethods(recorder: Recorder): string[] {
  return recorder.queries.flatMap(methodsOf);
}

let recorder: Recorder;
let repo: AiModelPricingRepository;

beforeEach(() => {
  recorder = { queries: [], results: [] };
  repo = new AiModelPricingRepository(makeClient(recorder));
});

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'openai',
  model_name: 'gpt-4o-mini',
  input_cost_per_token: 0.00000015,
  output_cost_per_token: 0.0000006,
  effective_date: '2026-09-20T00:00:00.000Z',
  retired_date: null,
  created_at: '2026-09-20T00:00:00.000Z',
};

describe('listAll', () => {
  it('orders by provider then model_name and returns the rows', async () => {
    recorder.results.push({ data: [ROW], error: null });

    const { data, error } = await repo.listAll();

    expect(error).toBeNull();
    expect(data).toEqual([ROW]);
    expect(recorder.queries[0].table).toBe('ai_model_pricing');
    expect(recorder.queries[0].calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual(
      [
        ['provider', { ascending: true }],
        ['model_name', { ascending: true }],
      ]
    );
  });

  it('returns [] — never null — when there are no rows', async () => {
    recorder.results.push({ data: null, error: null });

    const { data, error } = await repo.listAll();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('includes retired rows (no retired_date filter), so the admin screen keeps them', async () => {
    recorder.results.push({ data: [ROW], error: null });

    await repo.listAll();

    expect(allMethods(recorder)).not.toContain('is');
  });
});

describe('listActive (the billing reader, Step 1)', () => {
  it('returns only rows that are not retired, newest effective_date first', async () => {
    recorder.results.push({ data: [ROW], error: null });

    const { data, error } = await repo.listActive();

    expect(error).toBeNull();
    expect(data).toEqual([ROW]);
    expect(recorder.queries[0].table).toBe('ai_model_pricing');
    expect(recorder.queries[0].calls.filter((c) => c.method === 'is').map((c) => c.args)).toEqual([
      ['retired_date', null],
    ]);
    // ORDERING IS LOAD-BEARING: the caller keeps the FIRST row per
    // provider:model, so DESC is what makes the current price win. The
    // secondary sort keeps that deterministic if two rows ever share a date.
    expect(recorder.queries[0].calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['effective_date', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
  });

  // S1-5: a price entered ahead of time must not start charging when it is
  // saved — only when its date arrives.
  it('excludes rows whose effective_date is in the future', async () => {
    recorder.results.push({ data: [ROW], error: null });

    await repo.listActive();

    const lte = recorder.queries[0].calls.filter((c) => c.method === 'lte');
    expect(lte).toHaveLength(1);
    expect(lte[0].args[0]).toBe('effective_date');
    expect(lte[0].args[1]).toBe(new Date().toISOString().slice(0, 10));
  });

  it('returns [] — never null — when nothing matches', async () => {
    recorder.results.push({ data: null, error: null });

    const { data, error } = await repo.listActive();

    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it('returns the error instead of throwing', async () => {
    recorder.results.push({ data: null, error: new Error('boom') });

    const { data, error } = await repo.listActive();

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

// AI model price review slice 3 (SA O-10): additive. listActive above is unchanged.
describe('listActiveExact (admin price comparison, exact text)', () => {
  it('selects the prices cast to text, with the same filter and order as listActive', async () => {
    recorder.results.push({ data: [], error: null });

    await repo.listActiveExact();

    const query = recorder.queries[0];
    expect(query.table).toBe('ai_model_pricing');
    expect(query.calls.find((c) => c.method === 'select')?.args[0]).toBe(
      'id, provider, model_name, input_cost_per_token::text, output_cost_per_token::text, cached_input_cost_per_token::text, effective_date, created_at'
    );
    expect(query.calls.filter((c) => c.method === 'is').map((c) => c.args)).toEqual([['retired_date', null]]);
    expect(query.calls.filter((c) => c.method === 'lte').map((c) => c.args)).toEqual([
      ['effective_date', new Date().toISOString().slice(0, 10)],
    ]);
    expect(query.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['effective_date', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(methodsOf(query)).not.toEqual(expect.arrayContaining(['insert']));
  });

  it('returns the text values untouched, [] for none, and the error instead of throwing', async () => {
    const exact = { id: 'x', provider: 'openai', model_name: 'm', input_cost_per_token: '0.000000075', output_cost_per_token: '0.0000003', cached_input_cost_per_token: null, effective_date: '2026-10-11', created_at: 'x' };
    recorder.results.push({ data: [exact], error: null }, { data: null, error: null }, { data: null, error: new Error('boom') });

    expect((await repo.listActiveExact()).data).toEqual([exact]);
    expect((await repo.listActiveExact()).data).toEqual([]);
    const failed = await repo.listActiveExact();
    expect(failed.data).toBeNull();
    expect(failed.error).toBeInstanceOf(Error);
  });
});

describe('never throws', () => {
  it('turns a thrown client error into { data: null, error } on every method', async () => {
    recorder.throwOnFrom = new Error('client exploded');

    const results = await Promise.all([repo.listAll(), repo.listActive(), repo.listActiveExact()]);

    expect(results.every((r) => r.data === null && r.error instanceof Error)).toBe(true);
  });
});

// AI model price review slice 6 (MP-FR-11): the repository is read-only. The
// write methods went with Sync and the single-row edit (see the header).
describe('read-only (slice 6)', () => {
  it('has exactly the three read methods', () => {
    const methods = Object.getOwnPropertyNames(AiModelPricingRepository.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(['listActive', 'listActiveExact', 'listAll']);
  });
});
