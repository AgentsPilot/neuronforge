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
  not?: [string, string, unknown];
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
    not: jest.fn((col: string, op: string, val: unknown) => { calls.not = [col, op, val]; return builder; }),
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

describe('findPeriodAnchor (credit deduction slice 6a, SQ-20)', () => {
  // A microsecond value, as PostgREST returns it. A `Date` would cut it to
  // milliseconds; the repository must hand it back untouched.
  const ANCHOR = '2026-09-14T09:31:07.123456+00:00';

  it('reads period_anchor only, scoped by user_id, and returns the string verbatim', async () => {
    const { client, calls, builder } = mockSupabase({ data: { period_anchor: ANCHOR }, error: null });

    const { data, error } = await new BusinessOsAccountPlanRepository(client).findPeriodAnchor('acct-1');

    expect(error).toBeNull();
    expect(data).toBe(ANCHOR);
    expect(calls.table).toBe('business_os_account_plans');
    expect(calls.select).toBe('period_anchor');
    expect(calls.eqs).toEqual([['user_id', 'acct-1']]);
    expect(builder.maybeSingle).toHaveBeenCalledTimes(1);
    // Read only.
    expect(builder.insert).not.toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.upsert).not.toHaveBeenCalled();
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('reports no plan row as null', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    const { data, error } = await new BusinessOsAccountPlanRepository(client).findPeriodAnchor('acct-1');
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('returns a read error as an error, never as "no row"', async () => {
    const { client } = mockSupabase({ data: null, error: new Error('permission denied') });
    const { data, error } = await new BusinessOsAccountPlanRepository(client).findPeriodAnchor('acct-1');
    expect(data).toBeNull();
    expect(error?.message).toBe('permission denied');
  });

  it('treats a row with no readable anchor as an error', async () => {
    const { client } = mockSupabase({ data: { period_anchor: null }, error: null });
    const { data, error } = await new BusinessOsAccountPlanRepository(client).findPeriodAnchor('acct-1');
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

describe('findRecentOnboardedPlans (QA B-1)', () => {
  it('orders by the account\'s own start, newest first — not by created_at', async () => {
    // `created_at` is the moment the BACKFILL ran for every account it touched,
    // so ordering by it would sort tens of thousands of accounts by one
    // identical timestamp and the "recent" sample would be arbitrary.
    const { client, calls } = mockSupabase({ data: [PLAN_ROW], error: null });

    await new BusinessOsAccountPlanRepository(client).findRecentOnboardedPlans({ limit: 200 });

    expect(calls.table).toBe('business_os_account_plans');
    expect(calls.order).toEqual(['onboarding_started_at', { ascending: false }]);
    expect(calls.limit).toBe(200);
  });

  it('excludes accounts that never started onboarding', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });

    await new BusinessOsAccountPlanRepository(client).findRecentOnboardedPlans();

    expect(calls.not).toEqual(['onboarding_started_at', 'is', null]);
  });

  it('clamps the sample size', async () => {
    const { client, calls } = mockSupabase({ data: [], error: null });
    await new BusinessOsAccountPlanRepository(client).findRecentOnboardedPlans({ limit: 999999 });
    expect(calls.limit).toBe(1000);
  });
});

describe('findTenantsMissingPlanRow — exhaustive since S-0', () => {
  /**
   * One RPC call, not a paged walk.
   *
   * It used to read `business_profiles` and then ask about plan records 100 ids
   * at a time, because the anti-join across `business_profiles` and
   * `onboarding_conversations` cannot be expressed through PostgREST. That made
   * an onboarding-only tenant with no plan record invisible — harmless while
   * nothing is enforced, and a real customer denied a capability afterwards.
   *
   * The counts below therefore come from SQL. What these tests hold is the
   * boundary: the right function, the clamped argument, and — most of all —
   * that a failure never looks like "nothing is missing".
   */
  const SCAN_ROW = {
    tenants_checked: 1200,
    missing_count: 3,
    missing_with_profile: 1,
    missing_onboarding_only: 2,
    missing_sample: ['ghost-1', 'ghost-2', 'ghost-3'],
    truncated: false,
  };

  it('asks the exhaustive function, and passes the bound it was given', async () => {
    const { client, calls } = mockSupabase({ data: [SCAN_ROW], error: null });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow({
      maxAccounts: 500,
    });

    expect(calls.rpc).toEqual(['business_os_tenants_missing_plan_row', { p_limit: 500 }]);
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      checked: 1200,
      count: 3,
      missing: ['ghost-1', 'ghost-2', 'ghost-3'],
      withProfile: 1,
      onboardingOnly: 2,
      truncated: false,
    });
  });

  it('says what it scanned, in the words the report prints', async () => {
    // The old value of this field said "accounts with a business profile". That
    // sentence was accurate and was the defect, so the scope now travels with
    // the answer rather than being written at the reader.
    const { client } = mockSupabase({ data: [SCAN_ROW], error: null });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data?.scope).toContain('exhaustive');
    expect(result.data?.scope).toContain('onboarding');
  });

  it('clamps the bound rather than passing a caller number through', async () => {
    const { client, calls } = mockSupabase({ data: [SCAN_ROW], error: null });
    const repository = new BusinessOsAccountPlanRepository(client);

    await repository.findTenantsMissingPlanRow({ maxAccounts: 999999 });
    expect(calls.rpc?.[1]).toEqual({ p_limit: 20000 });

    await repository.findTenantsMissingPlanRow({ maxAccounts: 0 });
    expect(calls.rpc?.[1]).toEqual({ p_limit: 1 });

    await repository.findTenantsMissingPlanRow();
    expect(calls.rpc?.[1]).toEqual({ p_limit: 2000 });
  });

  it('reads bigint counts that arrive as strings', async () => {
    // PostgREST sends `bigint` as a string. Counting is the entire purpose of
    // this method, so `"37" + 1 === "371"` is the bug worth a test of its own.
    const { client } = mockSupabase({
      data: [
        {
          ...SCAN_ROW,
          tenants_checked: '5000',
          missing_count: '37',
          missing_with_profile: '5',
          missing_onboarding_only: '32',
        },
      ],
      error: null,
    });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data?.checked).toBe(5000);
    expect(result.data?.count).toBe(37);
    expect(result.data?.withProfile).toBe(5);
    expect(result.data?.onboardingOnly).toBe(32);
  });

  it('accepts the row unwrapped as well as wrapped', async () => {
    // A table-returning function comes back as an array; some PostgREST
    // versions hand back the row itself. Both mean the same thing.
    const { client } = mockSupabase({ data: SCAN_ROW, error: null });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data?.count).toBe(3);
  });

  it('reports NOTHING MISSING only when the function said so', async () => {
    const { client } = mockSupabase({
      data: [
        {
          ...SCAN_ROW,
          missing_count: 0,
          missing_with_profile: 0,
          missing_onboarding_only: 0,
          missing_sample: [],
        },
      ],
      error: null,
    });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data).toMatchObject({ count: 0, missing: [] });
    expect(result.error).toBeNull();
  });

  it('returns an error when the function is not there — never an empty list', async () => {
    // The operator applies migrations by hand. "Nothing is missing" and "the
    // check has not been installed" must never look the same, because the first
    // is a green light to switch enforcement on.
    const { client } = mockSupabase({
      data: null,
      error: { message: 'function public.business_os_tenants_missing_plan_row(integer) does not exist' },
    });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data).toBeNull();
    // Asserted on shape, not `instanceof Error`: PostgREST returns a plain
    // object, and the repository casts it, which is the convention throughout
    // this file.
    expect(result.error).toBeTruthy();
    expect(String((result.error as { message?: string }).message)).toContain('does not exist');
  });

  it('treats an empty result set as a failure, not as a clean database', async () => {
    // The function returns exactly one row. No row means it answered nothing —
    // the same trap as above, arriving by a different route.
    const { client } = mockSupabase({ data: [], error: null });

    const result = await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/returned no row/);
  });

  it('never queries the two tables itself', async () => {
    // If this starts going through `from(...)` again, the anti-join has been
    // re-implemented in TypeScript and the gap is back.
    const { client, builder } = mockSupabase({ data: [SCAN_ROW], error: null });

    await new BusinessOsAccountPlanRepository(client).findTenantsMissingPlanRow();

    expect(client.from as jest.Mock).not.toHaveBeenCalled();
    expect(builder.in).not.toHaveBeenCalled();
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

describe('provisionFromInvite (invite-only signup Slice 1b; L-5, I-5, F-8)', () => {
  const input = {
    inviteId: '11111111-1111-4111-8111-111111111111',
    accountId: '33333333-3333-4333-8333-333333333333',
    email: 'invitee@example.com',
    cohort: 'champion',
  };

  it('calls the finalise function with exactly the four server-derived arguments and returns the invite id', async () => {
    const { client, calls, builder } = mockSupabase({ data: input.inviteId, error: null });
    const result = await new BusinessOsAccountPlanRepository(client).provisionFromInvite(input);
    expect(result).toEqual({ data: input.inviteId, error: null });
    expect(calls.rpc).toEqual([
      'business_os_finalise_invite_redemption',
      { p_invite_id: input.inviteId, p_account_id: input.accountId, p_email: input.email, p_cohort: input.cohort },
    ]);
    // One transaction in SQL: no table write from here.
    expect(builder.insert).not.toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it('a row that no longer matches is { data: null, error: null }', async () => {
    const { client } = mockSupabase({ data: null, error: null });
    expect(await new BusinessOsAccountPlanRepository(client).provisionFromInvite(input)).toEqual({ data: null, error: null });
  });

  it('a database error is scrubbed to { code, message }, and the email is never logged (M-1)', async () => {
    const { client } = mockSupabase({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint', details: `Key (user_id)=(x) for ${input.email}`, hint: '' },
    });
    const result = await new BusinessOsAccountPlanRepository(client).provisionFromInvite(input);
    expect(result.data).toBeNull();
    expect(result.error).not.toHaveProperty('details');
    expect((result.error as Error & { code?: string }).code).toBe('23505');
    expect(JSON.stringify(result.error)).not.toContain(input.email);
  });
});
