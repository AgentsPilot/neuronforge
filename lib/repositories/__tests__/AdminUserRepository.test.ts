/**
 * Unit tests for AdminUserRepository.
 *
 * Verifies query shape (table, columns, filters), email normalization
 * (trim + lowercase), the upsert payload/onConflict, and error propagation
 * through the { data, error } result shape (methods never throw).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AdminUserRepository } from '@/lib/repositories/AdminUserRepository';

/**
 * Mock the Supabase query builder. The builder is thenable so chains that end at
 * `.eq(...)` (deactivateByEmail) resolve when awaited, while terminal `.maybeSingle()`
 * / `.single()` / `.order()` resolve to the same result. Records calls for assertions.
 */
function mockSupabase(result: { data: any; error: any }) {
  const calls: {
    table?: string;
    select?: string;
    eqs: Array<[string, any]>;
    order?: [string, any];
    update?: any;
    upsert?: any;
    upsertOpts?: any;
  } = { eqs: [] };

  const builder: any = {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    eq: jest.fn((col: string, val: any) => { calls.eqs.push([col, val]); return builder; }),
    order: jest.fn((col: string, opts: any) => { calls.order = [col, opts]; return Promise.resolve(result); }),
    update: jest.fn((payload: any) => { calls.update = payload; return builder; }),
    upsert: jest.fn((payload: any, opts: any) => { calls.upsert = payload; calls.upsertOpts = opts; return builder; }),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    single: jest.fn(() => Promise.resolve(result)),
    // Make the builder awaitable for chains that terminate at `.eq()`.
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };

  const client = {
    from: jest.fn((t: string) => { calls.table = t; return builder; }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const ROW = {
  id: 'r1',
  user_id: 'u1',
  email: 'admin@example.com',
  granted_by: null,
  notes: null,
  is_active: true,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

describe('AdminUserRepository.findByUserId', () => {
  it('returns the row and filters by user_id + is_active on admin_users', async () => {
    const { client, calls } = mockSupabase({ data: ROW, error: null });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.findByUserId('u1');

    expect(error).toBeNull();
    expect(data).toEqual(ROW);
    expect(calls.table).toBe('admin_users');
    expect(calls.eqs).toEqual([['user_id', 'u1'], ['is_active', true]]);
  });

  it('returns { data: null, error: null } when the user is not an admin (no row)', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.findByUserId('nobody');

    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('propagates a DB error without throwing', async () => {
    const { client } = mockSupabase({ data: null, error: new Error('db down') });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.findByUserId('u1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('AdminUserRepository.findByEmail', () => {
  it('normalizes the email (trim + lowercase) in the filter', async () => {
    const { client, calls } = mockSupabase({ data: ROW, error: null });
    const repo = new AdminUserRepository(client);

    await repo.findByEmail('  Admin@Example.COM ');

    expect(calls.eqs).toEqual([['email', 'admin@example.com'], ['is_active', true]]);
  });
});

describe('AdminUserRepository.listActive', () => {
  it('returns active rows ordered by created_at', async () => {
    const { client, calls } = mockSupabase({ data: [ROW], error: null });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.listActive();

    expect(error).toBeNull();
    expect(data).toEqual([ROW]);
    expect(calls.eqs).toEqual([['is_active', true]]);
    expect(calls.order).toEqual(['created_at', { ascending: true }]);
  });

  it('returns [] (not null) when there are no admins', async () => {
    const { client } = mockSupabase({ data: [], error: null });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.listActive();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('AdminUserRepository.upsertByEmail', () => {
  it('upserts a normalized, active row with onConflict: email', async () => {
    const { client, calls } = mockSupabase({ data: ROW, error: null });
    const repo = new AdminUserRepository(client);

    await repo.upsertByEmail({ email: 'NEW@Example.com', userId: 'u9', notes: 'seed' });

    expect(calls.upsert).toEqual({
      email: 'new@example.com',
      user_id: 'u9',
      granted_by: null,
      notes: 'seed',
      is_active: true,
    });
    expect(calls.upsertOpts).toEqual({ onConflict: 'email' });
  });

  it('defaults user_id/granted_by/notes to null when omitted', async () => {
    const { client, calls } = mockSupabase({ data: ROW, error: null });
    const repo = new AdminUserRepository(client);

    await repo.upsertByEmail({ email: 'x@example.com' });

    expect(calls.upsert.user_id).toBeNull();
    expect(calls.upsert.granted_by).toBeNull();
    expect(calls.upsert.notes).toBeNull();
  });
});

describe('AdminUserRepository.bindUserId', () => {
  it('updates user_id filtered by normalized email', async () => {
    const { client, calls } = mockSupabase({ data: ROW, error: null });
    const repo = new AdminUserRepository(client);

    await repo.bindUserId('Admin@Example.com', 'u1');

    expect(calls.update).toEqual({ user_id: 'u1' });
    expect(calls.eqs).toEqual([['email', 'admin@example.com']]);
  });
});

describe('AdminUserRepository.deactivateByEmail', () => {
  it('soft-revokes by setting is_active=false on the normalized email', async () => {
    const { client, calls } = mockSupabase({ data: null, error: null });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.deactivateByEmail('Admin@Example.com');

    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(calls.update).toEqual({ is_active: false });
    expect(calls.eqs).toEqual([['email', 'admin@example.com']]);
  });

  it('propagates a DB error without throwing', async () => {
    const { client } = mockSupabase({ data: null, error: new Error('db down') });
    const repo = new AdminUserRepository(client);

    const { data, error } = await repo.deactivateByEmail('a@example.com');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
