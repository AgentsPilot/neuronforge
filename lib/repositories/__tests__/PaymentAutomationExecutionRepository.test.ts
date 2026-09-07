/**
 * Unit tests for PaymentAutomationExecutionRepository (`payment_automation_executions`).
 *
 * Verifies:
 *  - user_id scoping on `enqueue` (embeds user_id).
 *  - the ⟨unscoped-by-design⟩ set = exactly {claimDue, reapStale, complete, fail,
 *    countCompletedForEntity, hasRecentForEntity} — none carries a user_id filter.
 *  - M3: countCompletedForEntity filters status='completed' AND .neq('id', excludeId).
 *  - the { data, error } shape (never throws).
 *  - claim/reap route through .rpc() with the right args.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentAutomationExecutionRepository } from '@/lib/repositories/PaymentAutomationRepository';

interface QueryCall {
  table: string;
  insert?: any;
  update?: any;
  eqs: Array<[string, any]>;
  neqs: Array<[string, any]>;
  ins: Array<[string, any]>;
  countHead?: boolean;
}

interface RpcCall {
  fn: string;
  args: any;
}

function mockSupabase(results: { data: any; error: any; count?: number } | Array<{ data: any; error: any; count?: number }>) {
  const queue = Array.isArray(results) ? [...results] : [results];
  const nextResult = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const calls: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];
  let current: QueryCall;

  const builder: any = {
    select: jest.fn((_cols?: any, opts?: any) => { if (opts?.head) current.countHead = true; return builder; }),
    insert: jest.fn((v: any) => { current.insert = v; return builder; }),
    update: jest.fn((v: any) => { current.update = v; return builder; }),
    eq: jest.fn((col: string, val: any) => { current.eqs.push([col, val]); return builder; }),
    neq: jest.fn((col: string, val: any) => { current.neqs.push([col, val]); return builder; }),
    in: jest.fn((col: string, val: any) => { current.ins.push([col, val]); return builder; }),
    gte: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    order: jest.fn(() => builder),
    single: jest.fn(() => Promise.resolve(nextResult())),
    then: (res: any, rej: any) => Promise.resolve(nextResult()).then(res, rej),
  };

  const client = {
    from: jest.fn((t: string) => {
      current = { table: t, eqs: [], neqs: [], ins: [] };
      calls.push(current);
      return builder;
    }),
    rpc: jest.fn((fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(nextResult());
    }),
  } as unknown as SupabaseClient;

  return { client, calls, rpcCalls };
}

const eqCols = (c: QueryCall) => c.eqs.map(e => e[0]);

describe('PaymentAutomationExecutionRepository — scoped', () => {
  it('enqueue embeds user_id and defaults status to pending', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'e1' }, error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    await repo.enqueue({
      user_id: 'u1',
      rule_id: 'rule1',
      entity_type: 'invoice',
      entity_id: 'inv1',
      trigger_event_id: 'evt1',
      scheduled_at: '2026-01-01T00:00:00.000Z',
    });

    expect(calls[0].table).toBe('payment_automation_executions');
    expect(calls[0].insert).toMatchObject({
      user_id: 'u1',
      rule_id: 'rule1',
      trigger_event_id: 'evt1',
      status: 'pending',
    });
  });
});

describe('PaymentAutomationExecutionRepository — ⟨unscoped-by-design⟩', () => {
  it('countCompletedForEntity filters status=completed AND excludes self, no user_id (M3)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null, count: 2 });
    const repo = new PaymentAutomationExecutionRepository(client);

    const { data } = await repo.countCompletedForEntity('rule1', 'invoice', 'inv1', 'self-id');

    expect(data).toBe(2);
    expect(calls[0].countHead).toBe(true);
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['rule_id', 'rule1'], ['entity_type', 'invoice'], ['entity_id', 'inv1'], ['status', 'completed']])
    );
    expect(calls[0].neqs).toEqual([['id', 'self-id']]);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('hasRecentForEntity filters completed/running, excludes self, no user_id (M3)', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'x' }], error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    const { data } = await repo.hasRecentForEntity('rule1', 'invoice', 'inv1', '2026-01-01T00:00:00.000Z', 'self-id');

    expect(data).toBe(true);
    expect(calls[0].ins).toEqual([['status', ['completed', 'running']]]);
    expect(calls[0].neqs).toEqual([['id', 'self-id']]);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('claimDue routes through the claim RPC (no user_id)', async () => {
    const { client, calls, rpcCalls } = mockSupabase({ data: [{ id: 'e1' }], error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    const { data } = await repo.claimDue('runner-1', 100);

    expect(calls).toHaveLength(0);
    expect(rpcCalls[0].fn).toBe('claim_due_payment_automation_executions');
    expect(rpcCalls[0].args).toEqual({ p_runner: 'runner-1', p_batch: 100 });
    expect(data).toEqual([{ id: 'e1' }]);
  });

  it('reapStale routes through the reaper RPC', async () => {
    const { client, rpcCalls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    await repo.reapStale(90, 5);

    expect(rpcCalls[0].fn).toBe('reap_stale_payment_automation_executions');
    expect(rpcCalls[0].args).toEqual({ p_lease_seconds: 90, p_max_attempts: 5 });
  });

  it('complete marks completed by id only (no user_id)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    await repo.complete('e1', { ok: true });

    expect(calls[0].update).toMatchObject({ status: 'completed', result: { ok: true } });
    expect(eqCols(calls[0])).toEqual(['id']);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('fail marks failed by id only (no user_id)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentAutomationExecutionRepository(client);

    await repo.fail('e1', 'boom');

    expect(calls[0].update).toMatchObject({ status: 'failed', error_message: 'boom' });
    expect(eqCols(calls[0])).toEqual(['id']);
  });

  it('returns { data: null, error } on failure (never throws)', async () => {
    const boom = new Error('db down');
    const { client } = mockSupabase({ data: null, error: boom });
    const repo = new PaymentAutomationExecutionRepository(client);

    const { data, error } = await repo.enqueue({
      user_id: 'u1', rule_id: 'r', entity_type: 'invoice', entity_id: 'i',
      trigger_event_id: 'e', scheduled_at: '2026-01-01T00:00:00.000Z',
    });

    expect(data).toBeNull();
    expect(error).toBe(boom);
  });
});
