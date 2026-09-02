/**
 * Unit tests for PaymentProcessorRepository + SavedPaymentMethodRepository.
 *
 * Verifies user_id scoping, key filters, the { data, error } shape, the M1
 * graceful not-found semantics (findByType / findDefault), and manual updated_at
 * on the tables that have the column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PaymentProcessorRepository,
  SavedPaymentMethodRepository,
} from '@/lib/repositories/PaymentProcessorRepository';

interface QueryCall {
  table: string;
  select?: string;
  insert?: any;
  update?: any;
  deleted?: boolean;
  eqs: Array<[string, any]>;
  orders: Array<[string, any]>;
}

/**
 * Mock Supabase builder. `results` is consumed in order by terminal resolutions
 * (single / maybeSingle / awaiting the builder). Records one call entry per from().
 */
function mockSupabase(results: { data: any; error: any } | Array<{ data: any; error: any }>) {
  const queue = Array.isArray(results) ? [...results] : [results];
  const nextResult = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const calls: QueryCall[] = [];
  let current: QueryCall;

  const builder: any = {
    select: jest.fn((c: string) => { current.select = c; return builder; }),
    insert: jest.fn((v: any) => { current.insert = v; return builder; }),
    update: jest.fn((v: any) => { current.update = v; return builder; }),
    delete: jest.fn(() => { current.deleted = true; return builder; }),
    eq: jest.fn((col: string, val: any) => { current.eqs.push([col, val]); return builder; }),
    in: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    order: jest.fn((col: string, opts: any) => { current.orders.push([col, opts]); return builder; }),
    limit: jest.fn(() => builder),
    range: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(nextResult())),
    maybeSingle: jest.fn(() => Promise.resolve(nextResult())),
    then: (res: any, rej: any) => Promise.resolve(nextResult()).then(res, rej),
  };

  const client = {
    from: jest.fn((t: string) => {
      current = { table: t, eqs: [], orders: [] };
      calls.push(current);
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const eqCols = (c: QueryCall) => c.eqs.map(e => e[0]);

describe('PaymentProcessorRepository', () => {
  it('findConnected scopes by user_id + active + connected', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'p1' }], error: null });
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findConnected('u1');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 'p1' }]);
    expect(calls[0].table).toBe('payment_processors');
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['is_active', true], ['connection_status', 'connected']])
    );
  });

  it('findDefault returns the default row when present (user-scoped)', async () => {
    const proc = { id: 'p1', is_default: true };
    const { client, calls } = mockSupabase({ data: proc, error: null });
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findDefault('u1');

    expect(error).toBeNull();
    expect(data).toEqual(proc);
    expect(calls[0].eqs).toEqual(expect.arrayContaining([['user_id', 'u1'], ['is_default', true]]));
  });

  it('findDefault falls back to any connected processor (M2)', async () => {
    const anyProc = { id: 'p2', is_default: false };
    const { client, calls } = mockSupabase([
      { data: null, error: null }, // no explicit default
      { data: anyProc, error: null }, // fallback
    ]);
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findDefault('u1');

    expect(error).toBeNull();
    expect(data).toEqual(anyProc);
    expect(calls).toHaveLength(2); // two queries issued
  });

  it('findDefault returns { data: null, error: null } when no processor (M1 — never throws)', async () => {
    const { client } = mockSupabase([
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findDefault('u1');

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('findByType returns graceful null on no-row (M1) and scopes by user_id + type', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findByType('u1', 'stripe');

    expect(data).toBeNull();
    expect(error).toBeNull();
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['processor_type', 'stripe']])
    );
  });

  it('update scopes by id + user_id and sets updated_at manually', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'p1' }, error: null });
    const repo = new PaymentProcessorRepository(client);

    await repo.update('p1', 'u1', { is_active: false });

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'p1'], ['user_id', 'u1']]));
    expect(calls[0].update).toHaveProperty('updated_at');
  });

  it('updateByType scopes by user_id + type and sets updated_at', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentProcessorRepository(client);

    await repo.updateByType('u1', 'stripe', { is_active: false });

    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['processor_type', 'stripe']])
    );
    expect(calls[0].update).toHaveProperty('updated_at');
  });

  it('clearDefault scopes by user_id + is_default', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentProcessorRepository(client);

    await repo.clearDefault('u1');

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['user_id', 'u1'], ['is_default', true]]));
    expect(calls[0].update).toMatchObject({ is_default: false });
  });

  it('setDefaultByType scopes by user_id + type', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentProcessorRepository(client);

    await repo.setDefaultByType('u1', 'stripe');

    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['processor_type', 'stripe']])
    );
    expect(calls[0].update).toMatchObject({ is_default: true });
  });

  it('create inserts into payment_processors and returns the created row', async () => {
    const row = { user_id: 'u1', processor_type: 'stripe', is_active: true };
    const created = { id: 'p1', ...row };
    const { client, calls } = mockSupabase({ data: created, error: null });
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.create(row as any);

    expect(error).toBeNull();
    expect(data).toEqual(created);
    expect(calls[0].table).toBe('payment_processors');
    expect(calls[0].insert).toMatchObject({ user_id: 'u1', processor_type: 'stripe' });
  });

  it('returns { data: null, error } on query error (never throws)', async () => {
    const boom = new Error('db down');
    const { client } = mockSupabase({ data: null, error: boom });
    const repo = new PaymentProcessorRepository(client);

    const { data, error } = await repo.findConnected('u1');

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});

describe('SavedPaymentMethodRepository', () => {
  it('findById scopes by id + user_id', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'm1' }, error: null });
    const repo = new SavedPaymentMethodRepository(client);

    await repo.findById('m1', 'u1');

    expect(calls[0].table).toBe('saved_payment_methods');
    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'm1'], ['user_id', 'u1']]));
  });

  it('findValidByContact scopes by user_id + contact_id + is_valid', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new SavedPaymentMethodRepository(client);

    await repo.findValidByContact('u1', 'c1');

    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['contact_id', 'c1'], ['is_valid', true]])
    );
  });

  it('clearContactDefaults scopes by user_id + contact_id + is_default and sets updated_at', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new SavedPaymentMethodRepository(client);

    await repo.clearContactDefaults('u1', 'c1');

    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['contact_id', 'c1'], ['is_default', true]])
    );
    expect(calls[0].update).toHaveProperty('updated_at');
  });

  it('invalidate scopes by id + user_id and sets updated_at', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new SavedPaymentMethodRepository(client);

    await repo.invalidate('m1', 'u1');

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'm1'], ['user_id', 'u1']]));
    expect(calls[0].update).toMatchObject({ is_valid: false });
    expect(calls[0].update).toHaveProperty('updated_at');
  });

  it('create inserts into saved_payment_methods and returns the created row', async () => {
    const row = { user_id: 'u1', contact_id: 'c1', processor_type: 'stripe', processor_method_id: 'pm_1', method_type: 'card' };
    const created = { id: 'm1', ...row };
    const { client, calls } = mockSupabase({ data: created, error: null });
    const repo = new SavedPaymentMethodRepository(client);

    const { data, error } = await repo.create(row as any);

    expect(error).toBeNull();
    expect(data).toEqual(created);
    expect(calls[0].table).toBe('saved_payment_methods');
    expect(calls[0].insert).toMatchObject({ user_id: 'u1', contact_id: 'c1' });
  });
});
