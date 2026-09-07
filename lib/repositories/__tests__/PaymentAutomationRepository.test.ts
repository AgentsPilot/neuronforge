/**
 * Unit tests for PaymentAutomationRuleRepository (`payment_automation_rules`).
 *
 * Verifies user_id scoping on the scoped methods, key filters, manual updated_at
 * on update (column exists, no trigger), the { data, error } shape, and that the
 * ⟨unscoped-by-design⟩ findByIdUnscoped is the only method without a user_id filter.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentAutomationRuleRepository } from '@/lib/repositories/PaymentAutomationRepository';

interface QueryCall {
  table: string;
  insert?: any;
  update?: any;
  deleted?: boolean;
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
    update: jest.fn((v: any) => { current.update = v; return builder; }),
    delete: jest.fn(() => { current.deleted = true; return builder; }),
    eq: jest.fn((col: string, val: any) => { current.eqs.push([col, val]); return builder; }),
    order: jest.fn(() => builder),
    range: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(nextResult())),
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

describe('PaymentAutomationRuleRepository', () => {
  it('findActiveForEvent scopes by user_id + trigger_event + is_active', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.findActiveForEvent('u1', 'payment.failed');

    expect(calls[0].table).toBe('payment_automation_rules');
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['user_id', 'u1'], ['trigger_event', 'payment.failed'], ['is_active', true]])
    );
  });

  it('list scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.list('u1', { isActive: true });

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['user_id', 'u1'], ['is_active', true]]));
  });

  it('create injects user_id', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'rule1' }, error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.create('u1', { name: 'r' } as any);

    expect(calls[0].insert).toMatchObject({ user_id: 'u1', name: 'r' });
  });

  it('update scopes by id + user_id and sets updated_at manually', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'rule1' }, error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.update('rule1', 'u1', { is_active: false });

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'rule1'], ['user_id', 'u1']]));
    expect(calls[0].update).toHaveProperty('updated_at');
  });

  it('delete scopes by id + user_id', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.delete('rule1', 'u1');

    expect(calls[0].deleted).toBe(true);
    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'rule1'], ['user_id', 'u1']]));
  });

  it('findByIdUnscoped is ⟨unscoped-by-design⟩ — no user_id filter', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'rule1' }, error: null });
    const repo = new PaymentAutomationRuleRepository(client);

    await repo.findByIdUnscoped('rule1');

    expect(eqCols(calls[0])).toEqual(['id']);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('returns { data: null, error } on query error (never throws)', async () => {
    const boom = new Error('db down');
    const { client } = mockSupabase({ data: null, error: boom });
    const repo = new PaymentAutomationRuleRepository(client);

    const { data, error } = await repo.list('u1');

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});
