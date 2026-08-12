/**
 * Unit tests for PaymentReminderRepository.
 *
 * Focus: the two folded-in bug fixes —
 *   B1: updateStatus MUST include .eq('user_id', userId) (was id-only → cross-tenant gap).
 *   B2: NONE of the reminder update methods may write `updated_at` (no such column).
 * Plus user_id scoping on scoped methods and the ⟨unscoped-by-design⟩ cron methods.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { PaymentReminderRepository } from '@/lib/repositories/PaymentReminderRepository';

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

describe('PaymentReminderRepository — scoped methods', () => {
  it('create injects the row (with user_id) and never writes updated_at', async () => {
    const { client, calls } = mockSupabase({ data: { id: 'r1' }, error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.create({
      user_id: 'u1',
      contact_id: 'c1',
      reminder_type: 'upcoming_due',
      scheduled_at: '2026-01-01T00:00:00.000Z',
      channel: 'email',
    });

    expect(calls[0].table).toBe('payment_reminders');
    expect(calls[0].insert).toMatchObject({ user_id: 'u1', contact_id: 'c1' });
    expect(calls[0].insert).not.toHaveProperty('updated_at');
  });

  // B1
  it('updateStatus scopes by BOTH id AND user_id (B1 cross-tenant fix)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.updateStatus('r1', 'u1', { status: 'sent', sent_at: '2026-01-01T00:00:00.000Z' });

    expect(calls[0].eqs).toEqual(expect.arrayContaining([['id', 'r1'], ['user_id', 'u1']]));
    expect(eqCols(calls[0])).toContain('user_id');
  });

  // B2
  it('updateStatus does NOT send updated_at (B2 phantom column)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.updateStatus('r1', 'u1', { status: 'failed', error_message: 'boom' });

    expect(calls[0].update).toMatchObject({ status: 'failed', error_message: 'boom' });
    expect(calls[0].update).not.toHaveProperty('updated_at');
  });

  it('cancel scopes by id + user_id + pending, no updated_at, returns count', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'r1' }], error: null });
    const repo = new PaymentReminderRepository(client);

    const { data } = await repo.cancel('r1', 'u1');

    expect(data).toBe(1);
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['id', 'r1'], ['user_id', 'u1'], ['status', 'pending']])
    );
    expect(calls[0].update).not.toHaveProperty('updated_at');
  });

  it('cancelByInvoice scopes by invoice_id + user_id + pending, no updated_at', async () => {
    const { client, calls } = mockSupabase({ data: [{ id: 'r1' }, { id: 'r2' }], error: null });
    const repo = new PaymentReminderRepository(client);

    const { data } = await repo.cancelByInvoice('inv1', 'u1');

    expect(data).toBe(2);
    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['invoice_id', 'inv1'], ['user_id', 'u1'], ['status', 'pending']])
    );
    expect(calls[0].update).not.toHaveProperty('updated_at');
  });

  it('cancelByInstallment scopes by installment_id + user_id + pending, no updated_at', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.cancelByInstallment('ins1', 'u1');

    expect(calls[0].eqs).toEqual(
      expect.arrayContaining([['installment_id', 'ins1'], ['user_id', 'u1'], ['status', 'pending']])
    );
    expect(calls[0].update).not.toHaveProperty('updated_at');
  });

  it('list scopes by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.list('u1', { status: 'pending' });

    expect(eqCols(calls[0])).toContain('user_id');
  });
});

describe('PaymentReminderRepository — ⟨unscoped-by-design⟩ cron methods', () => {
  it('findDue does not filter by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.findDue('2026-01-01T00:00:00.000Z', 100);

    expect(eqCols(calls[0])).not.toContain('user_id');
    expect(calls[0].eqs).toEqual(expect.arrayContaining([['status', 'pending']]));
  });

  it('deleteById does not filter by user_id', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.deleteById('r1');

    expect(calls[0].deleted).toBe(true);
    expect(eqCols(calls[0])).toEqual(['id']);
    expect(eqCols(calls[0])).not.toContain('user_id');
  });

  it('markFailedById does not filter by user_id and never writes updated_at (B2)', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.markFailedById('r1', 'boom');

    expect(eqCols(calls[0])).toEqual(['id']);
    expect(eqCols(calls[0])).not.toContain('user_id');
    expect(calls[0].update).toMatchObject({ status: 'failed', error_message: 'boom' });
    expect(calls[0].update).not.toHaveProperty('updated_at');
  });

  it('findRecentByInvoice / findRecentByInstallment do not filter by user_id', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const repo = new PaymentReminderRepository(client);

    await repo.findRecentByInvoice('inv1', 'overdue', '2026-01-01T00:00:00.000Z');
    await repo.findRecentByInstallment('ins1', 'overdue', '2026-01-01T00:00:00.000Z');

    expect(eqCols(calls[0])).not.toContain('user_id');
    expect(eqCols(calls[0])).toContain('invoice_id');
    expect(eqCols(calls[1])).not.toContain('user_id');
    expect(eqCols(calls[1])).toContain('installment_id');
  });
});
