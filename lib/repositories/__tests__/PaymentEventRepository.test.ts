/**
 * Unit tests for PaymentEventRepository (append-only `payment_events`).
 *
 * Verifies user_id scoping on the scoped methods, key filters, the { data, error }
 * shape, that NO method writes `updated_at` (table has no such column), and that
 * the ⟨unscoped-by-design⟩ findByIdUnscoped is the only method without a user_id filter.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentEventRepository } from '@/lib/repositories/PaymentEventRepository';

interface QueryCall {
  table: string;
  insert?: any;
  eqs: Array<[string, any]>;
}

function mockSupabase(results: { data: any; error: any } | Array<{ data: any; error: any }>) {
  const queue = Array.isArray(results) ? [...results] : [results];
  const nextResult = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const calls: QueryCall[] = [];
  let current: QueryCall;

  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn((v: any) => { current.insert = v; return builder; }),
    eq: jest.fn((col: string, val: any) => { current.eqs.push([col, val]); return builder; }),
    in: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    range: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(nextResult())),
    maybeSingle: jest.fn(() => Promise.resolve(nextResult())),
    then: (res: any, rej: any) => Promise.resolve(nextResult()).then(res, rej),
  };

  const client = {
    from: jest.fn((t: string) => {
      current = { table: t, eqs: [] };
      calls.push(current);
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const eqCols = (c: QueryCall) => c.eqs.map(e => e[0]);

describe('PaymentEventRepository', () => {
  it('create injects user_id, never writes updated_at', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'e1' }, error: null });
    const repo = new PaymentEventRepository(client);

    const { data, error } = await repo.create('u1', {
      event_type: 'invoice.created',
      entity_type: 'invoice',
      entity_id: 'i1',
    });

    expect(error).toBeNull();
    expect(data).toEqual({ id: 'e1' });
    expect(calls[0].table).toBe('payment_events');
    expect(calls[0].insert).toMatchObject({ user_id: 'u1', event_type: 'invoice.created' });
    expect(calls[0].insert).not.toHaveProperty('updated_at');
  });

  it('createMany short-circuits on empty input', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentEventRepository(client);

    const { data, error } = await repo.createMany('u1', []);

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(calls).toHaveLength(0); // no query issued
  });

  it('createMany injects user_id into every row', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'e1' }], error: null });
    const repo = new PaymentEventRepository(client);

    await repo.createMany('u1', [
      { event_type: 'invoice.created', entity_type: 'invoice', entity_id: 'i1' },
      { event_type: 'invoice.paid', entity_type: 'invoice', entity_id: 'i2' },
    ]);

    expect(calls[0].insert).toHaveLength(2);
    expect(calls[0].insert.every((r: any) => r.user_id === 'u1')).toBe(true);
  });

  it('list scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentEventRepository(client);

    await repo.list('u1', { eventType: 'invoice.paid' });

    expect(eqCols(calls[0])).toContain('user_id');
    expect(calls[0].eqs).toEqual(expect.arrayContaining([['user_id', 'u1'], ['event_type', 'invoice.paid']]));
  });

  it('listEventTypes scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [{ event_type: 'invoice.paid' }], error: null });
    const repo = new PaymentEventRepository(client);

    await repo.listEventTypes('u1', {});

    expect(calls[0].eqs).toEqual([['user_id', 'u1']]);
  });

  it('findRecentByTypes scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentEventRepository(client);

    await repo.findRecentByTypes('u1', ['payment.failed'], 10);

    expect(eqCols(calls[0])).toContain('user_id');
  });

  it('existsRecent scopes by user_id + entity and returns a boolean', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'e1' }], error: null });
    const repo = new PaymentEventRepository(client);

    const { data } = await repo.existsRecent('u1', {
      eventType: 'payment.failed',
      entityType: 'invoice',
      entityId: 'i1',
      since: '2026-01-01T00:00:00.000Z',
    });

    expect(data).toBe(true);
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([
        ['user_id', 'u1'],
        ['event_type', 'payment.failed'],
        ['entity_type', 'invoice'],
        ['entity_id', 'i1'],
      ])
    );
  });

  it('findByIdUnscoped is ⟨unscoped-by-design⟩ — no user_id filter', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'e1' }, error: null });
    const repo = new PaymentEventRepository(client);

    await repo.findByIdUnscoped('e1');

    expect(eqCols(calls[0])).toEqual(['id']);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('returns { data: null, error } on query error (never throws)', async () => {
    const boom = new Error('db down');
    const { client } = mockSupabase({ data: null, error: boom });
    const repo = new PaymentEventRepository(client);

    const { data, error } = await repo.list('u1');

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});
