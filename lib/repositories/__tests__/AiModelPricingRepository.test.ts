/**
 * T0-8 (Layer 2 Step 0, SA addendum §G) for `AiModelPricingRepository`.
 *
 * Every case runs against an INJECTED Supabase double, so this is a real unit
 * test of the repository's own contract: the "no such row" results the routes
 * turn into 404s, the empty-update guard, the never-throws rule, and the sync
 * semantics the pricing table depends on — match on `(provider, model_name)`
 * only, take the NEWEST row, and never `upsert` (the unique constraint includes
 * `effective_date`, which every sync run re-stamps, so an upsert would grow the
 * table without bound).
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

describe('findById', () => {
  it('returns { null, null } for a missing row rather than an error', async () => {
    recorder.results.push({ data: null, error: null });

    const { data, error } = await repo.findById(ROW.id);

    expect(data).toBeNull();
    expect(error).toBeNull();
    expect(methodsOf(recorder.queries[0])).toContain('maybeSingle');
  });

  it('returns the row when it exists', async () => {
    recorder.results.push({ data: ROW, error: null });

    const { data, error } = await repo.findById(ROW.id);

    expect(data).toEqual(ROW);
    expect(error).toBeNull();
  });
});

describe('create', () => {
  it('inserts and returns the created row', async () => {
    recorder.results.push({ data: ROW, error: null });

    const { data, error } = await repo.create({
      provider: ROW.provider,
      model_name: ROW.model_name,
      input_cost_per_token: 1,
      output_cost_per_token: 2,
      effective_date: ROW.effective_date,
    });

    expect(error).toBeNull();
    expect(data).toEqual(ROW);
    expect(methodsOf(recorder.queries[0])).toEqual(['insert', 'select', 'single']);
  });
});

describe('updateCosts', () => {
  it('returns { null, null } when no row matched, so the route can answer 404', async () => {
    recorder.results.push({ data: null, error: null });

    const { data, error } = await repo.updateCosts(ROW.id, { input_cost_per_token: 1 });

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('sends only the cost fields that were provided', async () => {
    recorder.results.push({ data: ROW, error: null });

    await repo.updateCosts(ROW.id, { output_cost_per_token: 5 });

    const update = recorder.queries[0].calls.find((c) => c.method === 'update');
    expect(update?.args[0]).toEqual({ output_cost_per_token: 5 });
  });

  it('refuses an empty update without touching the database', async () => {
    const { data, error } = await repo.updateCosts(ROW.id, {});

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(recorder.queries).toHaveLength(0);
  });
});

describe('deleteById', () => {
  it('reports true when a row was deleted', async () => {
    recorder.results.push({ data: [{ id: ROW.id }], error: null });

    const { data, error } = await repo.deleteById(ROW.id);

    expect(data).toBe(true);
    expect(error).toBeNull();
  });

  it('reports false when nothing matched, so the route can answer 404', async () => {
    recorder.results.push({ data: [], error: null });

    const { data, error } = await repo.deleteById(ROW.id);

    expect(data).toBe(false);
    expect(error).toBeNull();
  });
});

describe('syncMany', () => {
  const entry = {
    provider: 'openai',
    model_name: 'gpt-4o-mini',
    input_cost_per_token: 1,
    output_cost_per_token: 2,
    effective_date: '2026-09-20T00:00:00.000Z',
  };

  it('updates the existing row in place', async () => {
    recorder.results.push({ data: { id: ROW.id }, error: null }, { data: null, error: null });

    const { data, error } = await repo.syncMany([entry]);

    expect(error).toBeNull();
    expect(data).toEqual({ updated: ['gpt-4o-mini'], created: [], failed: [] });
    expect(methodsOf(recorder.queries[1])).toEqual(['update', 'eq']);
  });

  it('inserts when there is no row for that provider/model', async () => {
    recorder.results.push({ data: null, error: null }, { data: null, error: null });

    const { data } = await repo.syncMany([entry]);

    expect(data).toEqual({ updated: [], created: ['gpt-4o-mini'], failed: [] });
    expect(methodsOf(recorder.queries[1])).toEqual(['insert']);
  });

  it('matches on (provider, model_name) only and takes the newest row', async () => {
    recorder.results.push({ data: { id: ROW.id }, error: null }, { data: null, error: null });

    await repo.syncMany([entry]);

    const lookup = recorder.queries[0];
    expect(lookup.calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['provider', 'openai'],
      ['model_name', 'gpt-4o-mini'],
    ]);
    expect(lookup.calls.find((c) => c.method === 'order')?.args).toEqual([
      'effective_date',
      { ascending: false },
    ]);
    expect(lookup.calls.find((c) => c.method === 'limit')?.args).toEqual([1]);
    expect(methodsOf(lookup)).toContain('maybeSingle');
  });

  it('NEVER issues an upsert — that would add a row per model on every run', async () => {
    recorder.results.push(
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ROW.id }, error: null },
      { data: null, error: null }
    );

    await repo.syncMany([entry, { ...entry, model_name: 'gpt-4o' }]);

    expect(allMethods(recorder)).not.toContain('upsert');
  });

  it('records a failed row and carries on with the rest of the catalogue', async () => {
    recorder.results.push(
      { data: null, error: new Error('lookup failed') },
      { data: null, error: null },
      { data: null, error: null }
    );

    const { data, error } = await repo.syncMany([entry, { ...entry, model_name: 'gpt-4o' }]);

    expect(error).toBeNull();
    expect(data).toEqual({ updated: [], created: ['gpt-4o'], failed: ['gpt-4o-mini'] });
  });
});

describe('never throws', () => {
  it('turns a thrown client error into { data: null, error } on every method', async () => {
    recorder.throwOnFrom = new Error('client exploded');

    const results = await Promise.all([
      repo.listAll(),
      repo.findById(ROW.id),
      repo.create({
        provider: 'openai',
        model_name: 'm',
        input_cost_per_token: 1,
        output_cost_per_token: 1,
        effective_date: ROW.effective_date,
      }),
      repo.updateCosts(ROW.id, { input_cost_per_token: 1 }),
      repo.deleteById(ROW.id),
      repo.syncMany([]),
    ]);

    // syncMany with an empty catalogue never calls `from`, so it succeeds.
    expect(results.slice(0, 5).every((r) => r.data === null && r.error instanceof Error)).toBe(true);
    expect(results[5].error).toBeNull();
  });
});
