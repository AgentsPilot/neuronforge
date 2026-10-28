/**
 * BusinessOsAccountPlanRepository — the after-plan move methods (account
 * deletion lifecycle D3.1 / SX-2b; workplan §6.3; SA S-9, DR-5).
 *
 * Query SHAPE only, through an injected client: the `user_id` filter on every
 * call, explicit columns (never `*`), the write payload as an allow-list with
 * `updated_by_admin_id: null`, the compare-and-set on `updated_at` and
 * `after_plan_moves` with `{ count: 'exact' }`, no `.or()` / `.select()` on the
 * write, and `count === 0` read as `stale`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessOsAccountPlanRepository, type ApplyAfterPlanMoveInput } from '@/lib/repositories/BusinessOsAccountPlanRepository';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const UPDATED_AT = '2026-10-27T10:00:00.123456+00:00';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  update?: Record<string, unknown>;
  updateOptions?: Record<string, unknown>;
  or: number;
  selectAfterUpdate: number;
}

function mockSupabase(result: { data?: unknown; error: unknown; count?: number | null }) {
  const calls: Calls = { eqs: [], or: 0, selectAfterUpdate: 0 };
  // `any` is unavoidable here (CLAUDE.md rule 6): a chainable PostgREST stub, as in BusinessOsAccountPlanRepository.test.ts.
  const builder: any = {
    select: jest.fn((cols: string) => {
      if (calls.update) calls.selectAfterUpdate += 1;
      calls.select = cols;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => { calls.eqs.push([col, val]); return builder; }),
    or: jest.fn(() => { calls.or += 1; return builder; }),
    update: jest.fn((payload: Record<string, unknown>, options: Record<string, unknown>) => {
      calls.update = payload;
      calls.updateOptions = options;
      return builder;
    }),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (onF: any, onR: any) => Promise.resolve(result).then(onF, onR),
  };
  const client = { from: jest.fn((t: string) => { calls.table = t; return builder; }) } as unknown as SupabaseClient;
  return { client, calls, builder };
}

const PLAN_ROW = {
  user_id: ACCOUNT, tier: 'x', plan_version: 0, tier_expires_at: '2026-11-26T10:00:00+00:00', cohort: null, cohort_expires_at: null,
  onboarding_started_at: null, profile_created_at: null, trial_started_at: null, trial_ends_at: null, grace_ends_at: null,
  period_anchor: '2026-10-26T10:00:00+00:00', origin: 'admin', updated_by_admin_id: null,
  created_at: '2026-01-01T00:00:00+00:00', updated_at: UPDATED_AT,
};

const WRITE: ApplyAfterPlanMoveInput = {
  accountId: ACCOUNT,
  expected: { updatedAt: UPDATED_AT, moves: 2 },
  cohort: 'some_cohort',
  trialStartedAt: '2026-11-27T10:00:00.000Z',
  trialEndsAt: '2026-12-01T10:00:00.000Z',
  clearGraceEndsAt: false,
  periodAnchor: '2026-11-26T10:00:00.000Z',
  subscriptionId: 'sub_ABC123',
};

describe('findAfterPlanMoveInputs', () => {
  it('reads the plan columns plus the two after-plan columns, scoped by user_id, and splits them', async () => {
    const { client, calls } = mockSupabase({ data: { ...PLAN_ROW, after_plan_moves: 1, after_plan_last_subscription_id: 'sub_OLD' }, error: null });
    const result = await new BusinessOsAccountPlanRepository(client).findAfterPlanMoveInputs(ACCOUNT);
    expect(calls.table).toBe('business_os_account_plans');
    expect(calls.select).not.toContain('*');
    expect(calls.select).toContain('updated_at');
    expect(calls.select).toContain('after_plan_moves, after_plan_last_subscription_id');
    expect(calls.eqs).toEqual([['user_id', ACCOUNT]]);
    expect(result).toEqual({ data: { plan: PLAN_ROW, moves: 1, lastSubscriptionId: 'sub_OLD' }, error: null });
    // `updated_at` verbatim (the compare-and-set value): microseconds kept.
    expect(result.data!.plan.updated_at).toBe(UPDATED_AT);
  });

  it('no row: data null, no error', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    await expect(new BusinessOsAccountPlanRepository(client).findAfterPlanMoveInputs(ACCOUNT)).resolves.toEqual({ data: null, error: null });
  });

  it('a database error, or an unreadable count, is an error (never "no moves")', async () => {
    const failing = mockSupabase({ data: null, error: new Error('column does not exist') });
    const read = await new BusinessOsAccountPlanRepository(failing.client).findAfterPlanMoveInputs(ACCOUNT);
    expect(read.data).toBeNull();
    expect(read.error).toBeInstanceOf(Error);

    const bad = mockSupabase({ data: { ...PLAN_ROW, after_plan_moves: null, after_plan_last_subscription_id: null }, error: null });
    const unreadable = await new BusinessOsAccountPlanRepository(bad.client).findAfterPlanMoveInputs(ACCOUNT);
    expect(unreadable.data).toBeNull();
    expect(unreadable.error?.message).toMatch(/move count/);
  });
});

describe('findAfterPlanMoveState', () => {
  it('reads the two columns only, scoped by user_id', async () => {
    const { client, calls } = mockSupabase({ data: { after_plan_moves: 3, after_plan_last_subscription_id: 'sub_X' }, error: null });
    const result = await new BusinessOsAccountPlanRepository(client).findAfterPlanMoveState(ACCOUNT);
    expect(calls.select).toBe('after_plan_moves, after_plan_last_subscription_id');
    expect(calls.eqs).toEqual([['user_id', ACCOUNT]]);
    expect(result).toEqual({ data: { moves: 3, lastSubscriptionId: 'sub_X' }, error: null });
  });

  it('no row → null; error → error; a negative count → error', async () => {
    const none = mockSupabase({ data: null, error: null });
    await expect(new BusinessOsAccountPlanRepository(none.client).findAfterPlanMoveState(ACCOUNT)).resolves.toEqual({ data: null, error: null });
    const failing = mockSupabase({ data: null, error: new Error('boom') });
    expect((await new BusinessOsAccountPlanRepository(failing.client).findAfterPlanMoveState(ACCOUNT)).error).toBeInstanceOf(Error);
    const negative = mockSupabase({ data: { after_plan_moves: -1, after_plan_last_subscription_id: null }, error: null });
    expect((await new BusinessOsAccountPlanRepository(negative.client).findAfterPlanMoveState(ACCOUNT)).error).toBeInstanceOf(Error);
  });
});

describe('applyAfterPlanMove (SA S-9, DR-5)', () => {
  it('one conditional UPDATE: allow-listed payload, admin id NULL, count + 1, compare-and-set, count exact, no or / select', async () => {
    const { client, calls } = mockSupabase({ error: null, count: 1 });
    const result = await new BusinessOsAccountPlanRepository(client).applyAfterPlanMove(WRITE);

    expect(result).toEqual({ data: { outcome: 'applied', moves: 3 }, error: null });
    expect(calls.table).toBe('business_os_account_plans');
    expect(Object.keys(calls.update!).sort()).toEqual(
      [
        'after_plan_last_subscription_id',
        'after_plan_moves',
        'cohort',
        'period_anchor',
        'trial_ends_at',
        'trial_started_at',
        'updated_at',
        'updated_by_admin_id',
      ].sort()
    );
    expect(calls.update).toMatchObject({
      cohort: 'some_cohort',
      trial_started_at: WRITE.trialStartedAt,
      trial_ends_at: WRITE.trialEndsAt,
      period_anchor: WRITE.periodAnchor,
      after_plan_moves: 3,
      after_plan_last_subscription_id: 'sub_ABC123',
      updated_by_admin_id: null,
    });
    // Never the paid tier (S-11 replacement).
    expect(calls.update).not.toHaveProperty('tier_expires_at');
    expect(calls.update).not.toHaveProperty('tier');
    expect(calls.updateOptions).toEqual({ count: 'exact' });
    expect(calls.eqs).toEqual([
      ['user_id', ACCOUNT],
      ['updated_at', UPDATED_AT],
      ['after_plan_moves', 2],
    ]);
    expect(calls.or).toBe(0);
    expect(calls.selectAfterUpdate).toBe(0);
  });

  it('clears grace_ends_at only when asked (S-4)', async () => {
    const { client, calls } = mockSupabase({ error: null, count: 1 });
    await new BusinessOsAccountPlanRepository(client).applyAfterPlanMove({ ...WRITE, clearGraceEndsAt: true });
    expect(calls.update).toHaveProperty('grace_ends_at', null);
  });

  it('count 0 → stale (the row changed since it was read)', async () => {
    const { client } = mockSupabase({ error: null, count: 0 });
    await expect(new BusinessOsAccountPlanRepository(client).applyAfterPlanMove(WRITE)).resolves.toEqual({
      data: { outcome: 'stale' },
      error: null,
    });
  });

  it('a database error, or an unexpected count, is { data: null, error }', async () => {
    const failing = mockSupabase({ error: new Error('check violation'), count: null });
    const result = await new BusinessOsAccountPlanRepository(failing.client).applyAfterPlanMove(WRITE);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);

    const odd = mockSupabase({ error: null, count: null });
    expect((await new BusinessOsAccountPlanRepository(odd.client).applyAfterPlanMove(WRITE)).error).toBeInstanceOf(Error);
  });

  it.each([
    ['a non-UUID account id', { ...WRITE, accountId: 'acct-1' }],
    ['a non-Stripe subscription id', { ...WRITE, subscriptionId: 'cus_123' }],
    ['a negative expected count', { ...WRITE, expected: { updatedAt: UPDATED_AT, moves: -1 } }],
  ])('refuses %s with no query', async (_label, input) => {
    const { client } = mockSupabase({ error: null, count: 1 });
    const result = await new BusinessOsAccountPlanRepository(client).applyAfterPlanMove(input as ApplyAfterPlanMoveInput);
    expect(result.error).toBeInstanceOf(Error);
    expect((client as unknown as { from: jest.Mock }).from).not.toHaveBeenCalled();
  });
});
