/**
 * Unit tests for UserSubscriptionRepository (S-6 free-tier grant).
 *
 * Workplan §6.3 (U1–U3) plus SA additions U2b / U3b and the strengthened
 * payload assertions (exact key allow-list, session id is the only user_id).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { UserSubscriptionRepository } from '@/lib/repositories/UserSubscriptionRepository';
import type { FreeTierGrantPatch } from '@/lib/repositories/types';

type Filter = [op: string, col: string, ...args: unknown[]];

function mockSupabase(result: { data: unknown; error: unknown }) {
  const calls: {
    table?: string;
    select?: string;
    insert?: Record<string, unknown>;
    update?: Record<string, unknown>;
    filters: Filter[];
    terminal?: string;
  } = { filters: [] };

  const builder: Record<string, jest.Mock> & { then?: unknown } = {} as never;
  Object.assign(builder, {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    insert: jest.fn((payload: Record<string, unknown>) => { calls.insert = payload; return builder; }),
    update: jest.fn((payload: Record<string, unknown>) => { calls.update = payload; return builder; }),
    eq: jest.fn((col: string, val: unknown) => { calls.filters.push(['eq', col, val]); return builder; }),
    is: jest.fn((col: string, val: unknown) => { calls.filters.push(['is', col, val]); return builder; }),
    not: jest.fn((col: string, op: string, val: unknown) => { calls.filters.push(['not', col, op, val]); return builder; }),
    maybeSingle: jest.fn(() => { calls.terminal = 'maybeSingle'; return Promise.resolve(result); }),
    single: jest.fn(() => { calls.terminal = 'single'; return Promise.resolve(result); }),
  });
  // Chains that end at `.select(...)` are awaited directly.
  builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onF, onR);

  const client = {
    from: jest.fn((t: string) => { calls.table = t; return builder; }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const USER = '11111111-1111-4111-8111-111111111111';

const NEW_ROW_KEYS = [
  'account_frozen',
  'balance',
  'created_at',
  'executions_quota',
  'executions_used',
  'free_tier_expires_at',
  'free_tier_granted_at',
  'free_tier_initial_amount',
  'status',
  'storage_quota_mb',
  'storage_used_mb',
  'total_earned',
  'updated_at',
  'user_id',
];

const VALUES = {
  rawTokens: 208340,
  storageMb: 1000,
  executionsQuota: null,
  grantedAt: '2026-09-19T10:00:00.000Z',
  expiresAt: '2026-10-19T10:00:00.000Z',
};

const PATCH: FreeTierGrantPatch = {
  balance: 300,
  total_earned: 500,
  storage_quota_mb: 5000,
  executions_quota: null,
  free_tier_granted_at: '2026-09-19T10:00:00.000Z',
  free_tier_initial_amount: 200,
  updated_at: '2026-09-19T10:00:00.000Z',
};

describe('UserSubscriptionRepository.findGrantStateByUserId (U1)', () => {
  it('scopes by user_id, reads allow-listed columns, and uses maybeSingle', async () => {
    const row = { user_id: USER, balance: 5, total_earned: 5, storage_quota_mb: 1, executions_quota: null, account_frozen: false, free_tier_granted_at: null };
    const { client, calls } = mockSupabase({ data: row, error: null });
    const res = await new UserSubscriptionRepository(client).findGrantStateByUserId(USER);

    expect(calls.table).toBe('user_subscriptions');
    expect(calls.select).not.toContain('*');
    expect(calls.select).toContain('free_tier_granted_at');
    expect(calls.select).toContain('account_frozen');
    expect(calls.filters).toEqual([['eq', 'user_id', USER]]);
    expect(calls.terminal).toBe('maybeSingle');
    expect(res).toEqual({ data: row, error: null });
  });

  it('returns data: null when there is no row', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const res = await new UserSubscriptionRepository(client).findGrantStateByUserId(USER);
    expect(res).toEqual({ data: null, error: null });
  });

  it('returns { error } on a DB error (e.g. duplicate rows) and never throws', async () => {
    const dbErr = { code: 'PGRST116', message: 'multiple rows' };
    const { client } = mockSupabase({ data: null, error: dbErr });
    const res = await new UserSubscriptionRepository(client).findGrantStateByUserId(USER);
    expect(res.data).toBeNull();
    expect(res.error).toBe(dbErr);
  });
});

describe('UserSubscriptionRepository.insertFreeTierRow (U2)', () => {
  it('inserts exactly the allow-listed keys, with the session id as user_id', async () => {
    const { client, calls } = mockSupabase({ data: [{ user_id: USER }], error: null });
    const res = await new UserSubscriptionRepository(client).insertFreeTierRow(USER, VALUES);

    expect(res).toEqual({ data: { inserted: true, conflict: false }, error: null });
    expect(Object.keys(calls.insert!).sort()).toEqual(NEW_ROW_KEYS);
    expect(calls.insert).toEqual({
      user_id: USER,
      balance: 208340,
      total_earned: 208340,
      storage_quota_mb: 1000,
      storage_used_mb: 0,
      executions_quota: null,
      executions_used: 0,
      status: 'active',
      free_tier_granted_at: VALUES.grantedAt,
      free_tier_expires_at: VALUES.expiresAt,
      free_tier_initial_amount: 208340,
      account_frozen: false,
      created_at: VALUES.grantedAt,
      updated_at: VALUES.grantedAt,
    });
    expect(calls.select).toBe('user_id');
  });

  it('maps a 23505 unique violation to { inserted: false, conflict: true }', async () => {
    const { client } = mockSupabase({ data: null, error: { code: '23505', message: 'duplicate key value' } });
    const res = await new UserSubscriptionRepository(client).insertFreeTierRow(USER, VALUES);
    expect(res).toEqual({ data: { inserted: false, conflict: true }, error: null });
  });

  it('QA-U1: no error but no row returned → { inserted: false, conflict: false } (the service then throws, S7d)', async () => {
    const { client } = mockSupabase({ data: [], error: null });
    const res = await new UserSubscriptionRepository(client).insertFreeTierRow(USER, VALUES);
    expect(res).toEqual({ data: { inserted: false, conflict: false }, error: null });
  });

  it('U2b: a non-23505 error mentioning "duplicate" is an error, not a conflict (RC-2)', async () => {
    const dbErr = { code: '23502', message: 'duplicate-looking message: null value in column' };
    const { client } = mockSupabase({ data: null, error: dbErr });
    const res = await new UserSubscriptionRepository(client).insertFreeTierRow(USER, VALUES);
    expect(res.data).toBeNull();
    expect(res.error).toBe(dbErr);
  });
});

describe('UserSubscriptionRepository.applyFreeTierGrant (U3)', () => {
  const EXPECTED_UPDATE_KEYS = [
    'balance',
    'executions_quota',
    'free_tier_granted_at',
    'free_tier_initial_amount',
    'storage_quota_mb',
    'total_earned',
    'updated_at',
  ];

  it('writes exactly the allow-listed keys and chains the once-only, not-frozen and balance guards', async () => {
    const { client, calls } = mockSupabase({ data: [{ user_id: USER }], error: null });
    const res = await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 100, PATCH);

    expect(res).toEqual({ data: { updated: true }, error: null });
    expect(Object.keys(calls.update!).sort()).toEqual(EXPECTED_UPDATE_KEYS);
    for (const forbidden of ['account_frozen', 'user_id', 'id', 'status']) {
      expect(calls.update).not.toHaveProperty(forbidden);
    }
    expect(calls.filters).toEqual([
      ['eq', 'user_id', USER],
      ['is', 'free_tier_granted_at', null],
      ['not', 'account_frozen', 'is', true], // U3b (RC-1)
      ['eq', 'balance', 100],
    ]);
    // The session id is the only user_id anywhere in the chain.
    expect(calls.filters.filter((f) => f[1] === 'user_id')).toEqual([['eq', 'user_id', USER]]);
  });

  it('includes free_tier_expires_at only when the patch carries it', async () => {
    const { client, calls } = mockSupabase({ data: [{ user_id: USER }], error: null });
    await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 0, {
      ...PATCH,
      free_tier_expires_at: '2026-10-19T10:00:00.000Z',
    });
    expect(Object.keys(calls.update!).sort()).toEqual([...EXPECTED_UPDATE_KEYS, 'free_tier_expires_at'].sort());
  });

  it('drops keys a caller smuggles in through a wider object', async () => {
    const { client, calls } = mockSupabase({ data: [{ user_id: USER }], error: null });
    const smuggled = { ...PATCH, account_frozen: false, user_id: 'ATTACKER', status: 'active' } as unknown as FreeTierGrantPatch;
    await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 100, smuggled);
    expect(Object.keys(calls.update!).sort()).toEqual(EXPECTED_UPDATE_KEYS);
  });

  it('uses IS NULL for a null expected balance', async () => {
    const { client, calls } = mockSupabase({ data: [{ user_id: USER }], error: null });
    await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, null, PATCH);
    expect(calls.filters).toContainEqual(['is', 'balance', null]);
    expect(calls.filters.find((f) => f[0] === 'eq' && f[1] === 'balance')).toBeUndefined();
  });

  it('reports updated: false when no row matched', async () => {
    const { client } = mockSupabase({ data: [], error: null });
    const res = await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 100, PATCH);
    expect(res).toEqual({ data: { updated: false }, error: null });
  });

  it('RF-1 / F-2: more than one row updated is an error, not a clean updated: false', async () => {
    const { client } = mockSupabase({ data: [{ user_id: USER }, { user_id: USER }], error: null });
    const res = await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 100, PATCH);
    expect(res.data).toBeNull();
    expect(res.error).toBeInstanceOf(Error);
    expect(res.error!.message).toMatch(/updated 2 rows/);
  });

  it('returns { error } on a DB error', async () => {
    const dbErr = { code: '42P01', message: 'boom' };
    const { client } = mockSupabase({ data: null, error: dbErr });
    const res = await new UserSubscriptionRepository(client).applyFreeTierGrant(USER, 100, PATCH);
    expect(res.data).toBeNull();
    expect(res.error).toBe(dbErr);
  });
});
