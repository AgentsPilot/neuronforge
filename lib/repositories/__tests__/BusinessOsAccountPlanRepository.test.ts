/**
 * Unit tests for BusinessOsAccountPlanRepository (entitlements component 1).
 *
 * These assert the QUERY SHAPE, because that is where the safety properties
 * live: every read and write is scoped by `user_id`, write payloads are built
 * from an allow-list rather than spread from a caller object, `updated_at` is
 * always maintained (SA M-5), ending an override never deletes it (M-2), and an
 * oversized batch fails instead of silently truncating.
 *
 * The Supabase client is injected, so nothing here touches a database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BusinessOsAccountPlanRepository,
  BOS_ENTITLEMENT_BATCH_LIMIT,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  gt: Array<[string, unknown]>;
  in?: [string, unknown[]];
  order?: [string, unknown];
  limit?: number;
  insert?: Record<string, unknown>;
  upsert?: Record<string, unknown>;
  upsertOptions?: Record<string, unknown>;
  update?: Record<string, unknown>;
  rpc?: [string, Record<string, unknown>];
}

/** A thenable query-builder stub that records what the repository asked for. */
function mockSupabase(result: { data: unknown; error: unknown } | Array<{ data: unknown; error: unknown }>) {
  const results = Array.isArray(result) ? [...result] : [result];
  const next = () => (results.length > 1 ? results.shift()! : results[0]);

  const calls: Calls = { eqs: [], is: [], gt: [] };

  // `any` is unavoidable here (CLAUDE.md rule 6): this stub models PostgREST's
  // chainable builder, where every method returns the builder itself and the
  // chain is also a thenable. Typing that faithfully would mean reproducing
  // supabase-js's generic filter-builder types, which the assertions below do
  // not need — they only look at what the repository asked for.
  const builder: any = {
    select: jest.fn((cols: string) => { calls.select = cols; return builder; }),
    eq: jest.fn((col: string, val: unknown) => { calls.eqs.push([col, val]); return builder; }),
    is: jest.fn((col: string, val: unknown) => { calls.is.push([col, val]); return builder; }),
    gt: jest.fn((col: string, val: unknown) => { calls.gt.push([col, val]); return builder; }),
    in: jest.fn((col: string, vals: unknown[]) => { calls.in = [col, vals]; return builder; }),
    order: jest.fn((col: string, opts: unknown) => { calls.order = [col, opts]; return builder; }),
    limit: jest.fn((n: number) => { calls.limit = n; return builder; }),
    insert: jest.fn((payload: Record<string, unknown>) => { calls.insert = payload; return builder; }),
    upsert: jest.fn((payload: Record<string, unknown>, opts: Record<string, unknown>) => {
      calls.upsert = payload;
      calls.upsertOptions = opts;
      return builder;
    }),
    update: jest.fn((payload: Record<string, unknown>) => { calls.update = payload; return builder; }),
    // Defined on purpose (QA Q-8): asserting that an UNDEFINED `delete` was not
    // called proves nothing about the repository. A stub that HAS the method
    // makes "never deletes" a real assertion.
    delete: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(next())),
    single: jest.fn(() => Promise.resolve(next())),
    // The chain is awaited directly when it ends at a filter (e.g. `.limit()`).
    then: (onF: any, onR: any) => Promise.resolve(next()).then(onF, onR),
  };

  const client = {
    from: jest.fn((t: string) => { calls.table = t; return builder; }),
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      calls.rpc = [fn, args];
      return Promise.resolve(next());
    }),
  } as unknown as SupabaseClient;

  return { client, calls, builder };
}

const PLAN_ROW = {
  user_id: 'acct-1',
  tier: null,
  plan_version: 0,
  tier_expires_at: null,
  cohort: 'champion',
  cohort_expires_at: null,
  onboarding_started_at: '2026-09-01T00:00:00Z',
  profile_created_at: '2026-09-02T00:00:00Z',
  trial_started_at: null,
  trial_ends_at: null,
  grace_ends_at: null,
  period_anchor: '2026-09-01T00:00:00Z',
  origin: 'backfill',
  updated_by_admin_id: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

const OVERRIDE_ROW = {
  id: 'ovr-1',
  user_id: 'acct-1',
  capability: 'chat.search',
  op: 'set' as const,
  value: true,
  reason: 'design partner',
  expires_at: null,
  actor_admin_id: 'admin-1',
  created_at: '2026-09-03T00:00:00Z',
  ended_at: null,
  ended_by_admin_id: null,
  ended_reason: null,
};

describe('findEntitlementInputs', () => {
  it('reads the plan and its overrides in one query, scoped by user_id', async () => {
    const { client, calls } = mockSupabase({
      data: { ...PLAN_ROW, business_os_entitlement_overrides: [OVERRIDE_ROW] },
      error: null,
    });

    const repo = new BusinessOsAccountPlanRepository(client);
    const { data, error } = await repo.findEntitlementInputs('acct-1');

    expect(error).toBeNull();
    expect(calls.table).toBe('business_os_account_plans');
    expect(calls.eqs).toEqual([['user_id', 'acct-1']]);
    // The embed is what makes it one round trip.
    expect(calls.select).toContain('business_os_entitlement_overrides(');
    expect(data!.plan!.user_id).toBe('acct-1');
    expect(data!.overrides).toHaveLength(1);
    // The embedded array must not leak into the plan object. (`as unknown as`
    // because the two types deliberately do not overlap — QA Q-7.)
    expect((data!.plan as unknown as Record<string, unknown>).business_os_entitlement_overrides).toBeUndefined();
  });

  it('reports a missing row as plan: null rather than inventing one', async () => {
    const { client } = mockSupabase({ data: null, error: null });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).findEntitlementInputs('nobody');

    expect(error).toBeNull();
    expect(data).toEqual({ plan: null, overrides: [] });
  });

  it('returns the error instead of throwing', async () => {
    const { client } = mockSupabase({ data: null, error: new Error('boom') });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).findEntitlementInputs('acct-1');

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});

describe('findEntitlementInputsBatch', () => {
  it('keys the result by account and uses a single IN query', async () => {
    const { client, calls } = mockSupabase({
      data: [
        { ...PLAN_ROW, business_os_entitlement_overrides: [OVERRIDE_ROW] },
        { ...PLAN_ROW, user_id: 'acct-2', business_os_entitlement_overrides: [] },
      ],
      error: null,
    });

    const { data, error } = await new BusinessOsAccountPlanRepository(client)
      .findEntitlementInputsBatch(['acct-1', 'acct-2']);

    expect(error).toBeNull();
    expect(calls.in).toEqual(['user_id', ['acct-1', 'acct-2']]);
    expect(Object.keys(data!).sort()).toEqual(['acct-1', 'acct-2']);
    expect(data!['acct-1'].overrides).toHaveLength(1);
  });

  it('refuses an oversized batch rather than truncating it', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    const ids = Array.from({ length: BOS_ENTITLEMENT_BATCH_LIMIT + 1 }, (_, i) => `a${i}`);

    const { data, error } = await new BusinessOsAccountPlanRepository(client).findEntitlementInputsBatch(ids);

    expect(data).toBeNull();
    expect(error?.message).toContain('at most 100');
    // A truncated read would look like "these accounts have no plan row".
    expect(calls.in).toBeUndefined();
  });

  it('short-circuits an empty batch without querying', async () => {
    const { client } = mockSupabase({ data: [], error: null });

    const { data } = await new BusinessOsAccountPlanRepository(client).findEntitlementInputsBatch([]);

    expect(data).toEqual({});
    expect((client.from as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('pagePlans', () => {
  it('seeks by user_id rather than paging by offset', async () => {
    const { client, calls } = mockSupabase({ data: [PLAN_ROW], error: null });

    await new BusinessOsAccountPlanRepository(client).pagePlans({ afterUserId: 'acct-0', limit: 250 });

    expect(calls.order).toEqual(['user_id', { ascending: true }]);
    expect(calls.gt).toEqual([['user_id', 'acct-0']]);
    expect(calls.limit).toBe(250);
  });

  it('clamps an absurd page size', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });

    await new BusinessOsAccountPlanRepository(client).pagePlans({ limit: 100000 });

    expect(calls.limit).toBe(1000);
    expect(calls.gt).toEqual([]);
  });
});

describe('ensurePlanRow', () => {
  it('leaves an existing row untouched and reports created: false', async () => {
    const { client, calls } = mockSupabase({ data: PLAN_ROW, error: null });

    const { data } = await new BusinessOsAccountPlanRepository(client).ensurePlanRow({
      userId: 'acct-1',
      cohort: 'champion',
      cohortExpiresAt: null,
      adminId: 'admin-1',
    });

    expect(data).toEqual({ created: false, plan: PLAN_ROW });
    expect(calls.upsert).toBeUndefined();
  });

  it('creates the row with the explicit cohort and the recovered facts', async () => {
    const { client, calls } = mockSupabase([
      { data: null, error: null },                                   // the existence check
      { data: { ...PLAN_ROW, origin: 'admin' }, error: null },       // the upsert
    ]);

    const { data } = await new BusinessOsAccountPlanRepository(client).ensurePlanRow({
      userId: 'acct-9',
      cohort: 'champion',
      cohortExpiresAt: null,
      onboardingStartedAt: '2026-08-01T00:00:00Z',
      profileCreatedAt: '2026-08-02T00:00:00Z',
      adminId: 'admin-1',
    });

    expect(data!.created).toBe(true);
    expect(calls.upsert).toMatchObject({
      user_id: 'acct-9',
      cohort: 'champion',
      cohort_expires_at: null,
      onboarding_started_at: '2026-08-01T00:00:00Z',
      profile_created_at: '2026-08-02T00:00:00Z',
      origin: 'admin',
      updated_by_admin_id: 'admin-1',
    });
    // M-5: every writer maintains updated_at; nothing in the database does.
    expect(typeof calls.upsert!.updated_at).toBe('string');
    // F-4: ON CONFLICT DO NOTHING, so a racing writer's row is never overwritten.
    expect(calls.upsertOptions).toEqual({ onConflict: 'user_id', ignoreDuplicates: true });
  });

  it('reports created: false when a racing writer won, instead of failing', async () => {
    // The row did not exist at the read, appeared before the write, so the
    // upsert inserts nothing and returns no row (F-4).
    const { client, calls } = mockSupabase([
      { data: null, error: null },                                       // the existence check
      { data: null, error: null },                                       // the upsert: skipped
      { data: { ...PLAN_ROW, cohort: 'trial' }, error: null },           // the read-back
    ]);

    const { data, error } = await new BusinessOsAccountPlanRepository(client).ensurePlanRow({
      userId: 'acct-9',
      cohort: 'champion',
      cohortExpiresAt: null,
      adminId: 'admin-1',
    });

    expect(error).toBeNull();
    // The cohort the OTHER writer set survives; this call reports the truth.
    expect(data).toEqual({ created: false, plan: { ...PLAN_ROW, cohort: 'trial' } });
    expect(calls.upsert).toBeDefined();
  });

  it.each(['', '   '])('refuses a blank cohort (%p) without touching the database', async (blank) => {
    // QA Q-13: the table has no value CHECK on cohort (tier/cohort names live in
    // config, FR-12), so '' would satisfy `cohort IS NOT NULL` and produce a row
    // the resolver cannot interpret. The reset RPC refuses it in SQL; this is the
    // same refusal on the other write path.
    const { client } = mockSupabase({ data: null, error: null });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).ensurePlanRow({
      userId: 'acct-9',
      cohort: blank,
      adminId: 'admin-1',
    });

    expect(data).toBeNull();
    expect(error?.message).toContain('non-blank cohort');
    expect(client.from as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('updatePlan', () => {
  it('writes only allow-listed fields, plus updated_at and the actor', async () => {
    const { client, calls } = mockSupabase({ data: PLAN_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).updatePlan(
      'acct-1',
      // The extra keys are the shape a request body would have. They must not
      // reach the table (tenant-isolation-guard: explicit allow-list).
      {
        cohort: 'champion',
        cohort_expires_at: null,
        user_id: 'someone-else',
        created_at: '1999-01-01T00:00:00Z',
        onboarding_started_at: '1999-01-01T00:00:00Z',
      } as never,
      'admin-1'
    );

    expect(Object.keys(calls.update!).sort()).toEqual(
      ['cohort', 'cohort_expires_at', 'updated_at', 'updated_by_admin_id'].sort()
    );
    expect(calls.eqs).toEqual([['user_id', 'acct-1']]);
  });

  it('distinguishes an explicit null from an absent field', async () => {
    const { client, calls } = mockSupabase({ data: PLAN_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).updatePlan(
      'acct-1',
      { tier_expires_at: null },   // "no end date", said deliberately
      'admin-1'
    );

    expect(calls.update).toHaveProperty('tier_expires_at', null);
    expect(calls.update).not.toHaveProperty('tier');
  });

  it('clears an end date along with the assignment it belongs to (QA Q-6)', async () => {
    // The table pairs them, so clearing one half alone violates the CHECK and
    // reaches the admin as an opaque 500.
    const { client, calls } = mockSupabase({ data: PLAN_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).updatePlan('acct-1', { tier: null }, 'admin-1');
    expect(calls.update).toHaveProperty('tier_expires_at', null);

    const second = mockSupabase({ data: PLAN_ROW, error: null });
    await new BusinessOsAccountPlanRepository(second.client).updatePlan('acct-1', { cohort: null }, 'admin-1');
    expect(second.calls.update).toHaveProperty('cohort_expires_at', null);
  });

  it('does not overrule an expiry the caller set deliberately', async () => {
    const { client, calls } = mockSupabase({ data: PLAN_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).updatePlan(
      'acct-1',
      { tier: 'probe', plan_version: 2, tier_expires_at: '2027-01-01T00:00:00Z' },
      'admin-1'
    );

    expect(calls.update).toHaveProperty('tier_expires_at', '2027-01-01T00:00:00Z');
  });

  it('reports no data when no row matched, which the caller cannot otherwise tell (QA Q-15)', async () => {
    const { client } = mockSupabase({ data: null, error: null });

    const { data, error } = await new BusinessOsAccountPlanRepository(client)
      .updatePlan('acct-missing', { cohort: 'champion' }, 'admin-1');

    // Contract unchanged — the admin route pre-checks and answers 409
    // `plan_row_missing`; the repository logs a warning so it is observable.
    expect(data).toBeNull();
    expect(error).toBeNull();
  });
});

describe('createOverride', () => {
  it('stores the grant with its actor and reason', async () => {
    const { client, calls } = mockSupabase({ data: OVERRIDE_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).createOverride({
      userId: 'acct-1',
      capability: 'chat.search',
      op: 'set',
      value: true,
      reason: 'design partner',
      adminId: 'admin-1',
    });

    expect(calls.table).toBe('business_os_entitlement_overrides');
    expect(calls.insert).toMatchObject({
      user_id: 'acct-1',
      capability: 'chat.search',
      op: 'set',
      value: true,
      reason: 'design partner',
      actor_admin_id: 'admin-1',
      expires_at: null,
    });
  });

  it('drops any value on a revoke, where it would be meaningless', async () => {
    const { client, calls } = mockSupabase({ data: OVERRIDE_ROW, error: null });

    await new BusinessOsAccountPlanRepository(client).createOverride({
      userId: 'acct-1',
      capability: 'email.volume',
      op: 'revoke',
      value: { ceilingPerMonth: 5 },
      reason: 'abuse',
      adminId: 'admin-1',
    });

    expect(calls.insert).toHaveProperty('value', null);
  });
});

describe('endOverride', () => {
  it('ends the row instead of deleting it, scoped by id AND account', async () => {
    const { client, calls, builder } = mockSupabase({
      data: { ...OVERRIDE_ROW, ended_at: '2026-09-21T00:00:00Z' },
      error: null,
    });

    await new BusinessOsAccountPlanRepository(client).endOverride('ovr-1', 'acct-1', 'admin-2', 'no longer needed');

    // M-2 / §8: overrides are the durable admin record and are never deleted.
    expect(builder.update).toHaveBeenCalled();
    expect(builder.delete).not.toHaveBeenCalled();
    expect(calls.update).toMatchObject({ ended_by_admin_id: 'admin-2', ended_reason: 'no longer needed' });
    expect(calls.eqs).toEqual([['id', 'ovr-1'], ['user_id', 'acct-1']]);
    // Ending twice must not overwrite who ended it first.
    expect(calls.is).toEqual([['ended_at', null]]);
  });
});

describe('resetPlanState', () => {
  it('delegates to the single-transaction RPC with the explicit cohort', async () => {
    const { client, calls } = mockSupabase({ data: { ...PLAN_ROW, origin: 'admin_reset' }, error: null });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).resetPlanState({
      userId: 'acct-1',
      cohort: 'champion',
      cohortExpiresAt: null,
      adminId: 'admin-1',
      reason: 'support rebuild',
    });

    expect(error).toBeNull();
    expect(calls.rpc).toEqual([
      'business_os_reset_plan_state',
      {
        p_user_id: 'acct-1',
        p_cohort: 'champion',
        p_cohort_expires_at: null,
        p_trial_started_at: null,
        p_admin_id: 'admin-1',
        p_reason: 'support rebuild',
      },
    ]);
    expect(data!.origin).toBe('admin_reset');
  });

  it('accepts the row whether PostgREST returns it bare or wrapped', async () => {
    const { client } = mockSupabase({ data: [{ ...PLAN_ROW, origin: 'admin_reset' }], error: null });

    const { data } = await new BusinessOsAccountPlanRepository(client).resetPlanState({
      userId: 'acct-1',
      cohort: 'trial',
      adminId: 'admin-1',
      reason: 'support rebuild',
    });

    expect(data!.origin).toBe('admin_reset');
  });

  it('surfaces the database refusal (a blank cohort) as an error, not a throw', async () => {
    const { client } = mockSupabase({
      data: null,
      error: { message: 'business_os_reset_plan_state requires an explicit cohort' },
    });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).resetPlanState({
      userId: 'acct-1',
      cohort: '   ',
      adminId: 'admin-1',
      reason: 'support rebuild',
    });

    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
