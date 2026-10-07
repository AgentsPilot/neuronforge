/**
 * `GET /api/billing/summary` — the Settings billing screen's figures (P-10
 * workplan §16b, B-3).
 *
 * The session, the RLS client and the three repositories are faked. Pinned:
 *   - the happy path: the compact shape, sums from the repository, pricing
 *     parsed from config, never cached;
 *   - no subscription row is `subscription: null`, not an error;
 *   - 401 without a session, with nothing read;
 *   - every repository gets the caller's RLS client and the session user id;
 *   - a subscription or credit read failure is a 500 that, outside
 *     development, carries no internal detail;
 *   - a pricing config failure keeps the screen's defaults (0.00048 / 10).
 */

import { NextRequest } from 'next/server';

const CUSTOMER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OWNER_CLIENT = { marker: 'owner-rls-client' };

type Result<T> = { data: T | null; error: Error | null };

const state = {
  user: null as { id: string } | null,
  ownerClientsBuilt: 0,
  constructedWith: [] as Array<{ repo: string; client: unknown }>,
  subscriptionCalls: [] as string[],
  totalsCalls: [] as Array<{ userId: string; types: readonly string[] }>,
  configCalls: [] as string[][],
  subscription: { data: null, error: null } as Result<Record<string, unknown>>,
  totals: { data: null, error: null } as Result<Record<string, number>>,
  config: { data: null, error: null } as Result<Record<string, string>>,
};

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));

jest.mock('@/lib/supabaseServerAuth', () => ({
  createAuthenticatedServerClient: async () => {
    state.ownerClientsBuilt += 1;
    return OWNER_CLIENT;
  },
}));

// A service-role import here would be a regression: fail loudly if touched.
jest.mock('@/lib/supabaseServer', () => ({
  get supabaseServer() {
    throw new Error('the billing summary route must not use the service-role client');
  },
}));

jest.mock('@/lib/repositories/UserSubscriptionRepository', () => ({
  UserSubscriptionRepository: class {
    constructor(client: unknown) {
      state.constructedWith.push({ repo: 'subscriptions', client });
    }
    async findBillingSummaryByUserId(userId: string) {
      state.subscriptionCalls.push(userId);
      return state.subscription;
    }
  },
}));

jest.mock('@/lib/repositories/CreditTransactionRepository', () => ({
  CreditTransactionRepository: class {
    constructor(client: unknown) {
      state.constructedWith.push({ repo: 'transactions', client });
    }
    async sumCreditsDeltaByActivityType(userId: string, types: readonly string[]) {
      state.totalsCalls.push({ userId, types });
      return state.totals;
    }
  },
}));

jest.mock('@/lib/repositories/ConfigRepository', () => ({
  ConfigRepository: class {
    constructor(client: unknown) {
      state.constructedWith.push({ repo: 'config', client });
    }
    async getSystemConfigs(keys: string[]) {
      state.configCalls.push(keys);
      return state.config;
    }
  },
}));

import { GET } from '@/app/api/billing/summary/route';

const SUBSCRIPTION = {
  balance: 120000,
  total_spent: 80000,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  current_period_start: '2026-09-01T00:00:00.000Z',
  current_period_end: '2026-11-01T00:00:00.000Z',
  cancel_at_period_end: false,
  monthly_credits: 20000,
  monthly_amount_usd: 10,
};

const ORIGINAL_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined) {
  // NODE_ENV is typed read-only; tests switch it to pin the dev-only details guard.
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function request() {
  return new NextRequest('http://localhost/api/billing/summary?userId=bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', {
    headers: { 'x-correlation-id': 'corr-1' },
  });
}

beforeEach(() => {
  state.user = { id: CUSTOMER };
  state.ownerClientsBuilt = 0;
  state.constructedWith = [];
  state.subscriptionCalls = [];
  state.totalsCalls = [];
  state.configCalls = [];
  state.subscription = { data: { ...SUBSCRIPTION }, error: null };
  state.totals = { data: { reward_credit: 500, boost_pack_purchase: 2000 }, error: null };
  state.config = { data: { pilot_credit_cost_usd: '0.0005', tokens_per_pilot_credit: '12' }, error: null };
});

afterEach(() => setNodeEnv(ORIGINAL_ENV));

describe('GET /api/billing/summary', () => {
  it('returns the compact summary for the session user, never cached', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      success: true,
      data: {
        subscription: SUBSCRIPTION,
        rewardCredits: 500,
        boostPackCredits: 2000,
        pricingConfig: { pilot_credit_cost_usd: 0.0005, tokens_per_pilot_credit: 12 },
      },
    });
  });

  it('reads through the caller RLS client, scoped to the session user (a ?userId= is ignored)', async () => {
    await GET(request());
    expect(state.ownerClientsBuilt).toBe(1);
    expect(state.constructedWith).toHaveLength(3);
    for (const { client } of state.constructedWith) expect(client).toBe(OWNER_CLIENT);
    expect(state.subscriptionCalls).toEqual([CUSTOMER]);
    expect(state.totalsCalls).toEqual([{ userId: CUSTOMER, types: ['reward_credit', 'boost_pack_purchase'] }]);
    expect(state.configCalls).toEqual([['pilot_credit_cost_usd', 'tokens_per_pilot_credit']]);
  });

  it('no subscription row is subscription: null, not an error', async () => {
    state.subscription = { data: null, error: null };
    state.totals = { data: { reward_credit: 0, boost_pack_purchase: 0 }, error: null };
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.subscription).toBeNull();
    expect(body.data.rewardCredits).toBe(0);
    expect(body.data.boostPackCredits).toBe(0);
  });

  it('401 without a session, and nothing is read', async () => {
    state.user = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(state.ownerClientsBuilt).toBe(0);
    expect(state.subscriptionCalls).toEqual([]);
    expect(state.totalsCalls).toEqual([]);
    expect(state.configCalls).toEqual([]);
  });

  it('a subscription read failure is a 500 with no internal detail in production', async () => {
    setNodeEnv('production');
    state.subscription = { data: null, error: new Error('relation "user_subscriptions" secret detail') };
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Could not load your billing details' });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });

  it('a credit totals read failure is a 500, never a silent zero', async () => {
    setNodeEnv('production');
    state.totals = { data: null, error: new Error('credit_transactions secret detail') };
    const res = await GET(request());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.details).toBeUndefined();
    expect(body.data).toBeUndefined();
  });

  it('in development the 500 carries the detail', async () => {
    setNodeEnv('development');
    state.subscription = { data: null, error: new Error('boom') };
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect((await res.json()).details).toBe('boom');
  });

  it('an unexpected throw is a 500 with no detail in production', async () => {
    setNodeEnv('production');
    state.user = { id: CUSTOMER };
    jest.spyOn(Promise, 'all').mockRejectedValueOnce(new Error('unexpected secret'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
  });

  it('a pricing config failure keeps the defaults the screen always had', async () => {
    state.config = { data: null, error: new Error('config down') };
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).data.pricingConfig).toEqual({ pilot_credit_cost_usd: 0.00048, tokens_per_pilot_credit: 10 });
  });

  it('a missing pricing key falls back to its default', async () => {
    state.config = { data: { tokens_per_pilot_credit: '8' }, error: null };
    const res = await GET(request());
    expect((await res.json()).data.pricingConfig).toEqual({ pilot_credit_cost_usd: 0.00048, tokens_per_pilot_credit: 8 });
  });
});
