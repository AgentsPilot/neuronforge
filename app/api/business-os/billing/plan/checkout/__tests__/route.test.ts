/**
 * POST /api/business-os/billing/plan/checkout (plan payments P-3a, workplan
 * §3 and §7; SA rulings Q-1 to Q-12, conditions C-1 to C-4).
 *
 * Integration through the REAL route and the REAL orchestration; only the
 * edges are fakes: the session, the repositories, the entitlement snapshot,
 * Stripe and the audit flush. Every call lands in one ordered log, so the
 * tests can assert that an early refusal makes no Stripe call (C-4) and that
 * the audit is flushed before the 200 (WC-7).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { NextRequest } from 'next/server';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const SECRET = 'cs_test_secret_for_the_owner_only';
const FRIEND_TIER = TIER_ORDER[0];
const HIGHER_TIER = TIER_ORDER[TIER_ORDER.length - 1];

type Row = Record<string, unknown> | null;

const state: {
  user: { id: string; email?: string } | null;
  log: string[];
  lineage: Record<string, unknown> | null | 'error';
  invite: Record<string, unknown> | null;
  snapshot: { unavailable: boolean; resolution: { anomaly?: string } | null };
  row: Row | 'error';
  prices: Array<Record<string, unknown>> | null;
  subscriptions: Array<{ complete: boolean; subscriptions: Array<{ id: string; status: string }> } | Error>;
  sessions: Array<{ sessionId: string; clientSecret: string; expiresAt: number; livemode: boolean } | Error>;
  lockAcquired: boolean;
  logLines: unknown[];
} = {
  user: null,
  log: [],
  lineage: null,
  invite: null,
  snapshot: { unavailable: false, resolution: {} },
  row: null,
  prices: null,
  subscriptions: [],
  sessions: [],
  lockAcquired: true,
  logLines: [],
};

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => state.logLines.push([level, ...args]);
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/utils/origins', () => ({ platformOrigin: () => 'https://app.example' }));

jest.mock('@/lib/repositories/BusinessOsAccountLineageRepository', () => ({
  businessOsAccountLineageRepository: {
    findHoldFactsForAccount: async () => {
      state.log.push('db:lineage');
      return state.lineage === 'error' ? { data: null, error: new Error('down') } : { data: state.lineage, error: null };
    },
  },
}));
jest.mock('@/lib/repositories/BusinessOsInviteRepository', () => ({
  businessOsInviteRepository: {
    findHoldFactsById: async () => {
      state.log.push('db:invite');
      return { data: state.invite, error: null };
    },
  },
}));

const mockAcquireLock = jest.fn();
const mockReplaceCustomer = jest.fn();
jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async () => {
      state.log.push('db:findByUser');
      if (state.row === 'error') return { data: null, error: new Error('down') };
      return { data: state.row, error: null };
    },
    recordCustomer: async (input: { stripeCustomerId: string }) => {
      state.log.push('db:recordCustomer');
      return { data: { account: billingRow({ stripeCustomerId: input.stripeCustomerId }), created: true }, error: null };
    },
    acquireCheckoutLock: (...args: unknown[]) => mockAcquireLock(...args),
    replaceCustomer: (...args: unknown[]) => mockReplaceCustomer(...args),
  },
}));

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshot: async (accountId: string) => {
      state.log.push(`db:snapshot:${accountId}`);
      return state.snapshot;
    },
  }),
}));

const mockStripe = {
  listPricesByLookupKeys: jest.fn(async (keys: readonly string[]) => {
    state.log.push('stripe:listPrices');
    return state.prices ?? keys.map((key) => priceFor(key));
  }),
  listCustomerSubscriptions: jest.fn(async (customerId: string) => {
    state.log.push(`stripe:listSubscriptions:${customerId}`);
    const next = state.subscriptions.length > 1 ? state.subscriptions.shift()! : state.subscriptions[0] ?? { complete: true, subscriptions: [] };
    if (next instanceof Error) throw next;
    return next;
  }),
  createBusinessOsPlanCheckoutSession: jest.fn(async (params: { customerId: string }) => {
    state.log.push(`stripe:createSession:${params.customerId}`);
    const next =
      state.sessions.length > 1
        ? state.sessions.shift()!
        : state.sessions[0] ?? { sessionId: 'cs_test_new', clientSecret: SECRET, expiresAt: 1_800_000_000, livemode: false };
    if (next instanceof Error) throw next;
    return next;
  }),
  expireCheckoutSession: jest.fn(async (sessionId: string) => {
    state.log.push(`stripe:expire:${sessionId}`);
  }),
  findOrCreatePlatformCustomer: jest.fn(async (params: { idempotencyKey: string }) => {
    state.log.push(`stripe:createCustomer:${params.idempotencyKey}`);
    return { customerId: params.idempotencyKey.includes(':replaces:') ? 'cus_replacement' : 'cus_created', created: true, livemode: false };
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

const mockLogAndFlush = jest.fn(async (entry: { action: string }) => {
  state.log.push(`audit:${entry.action}`);
});
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...(args as [{ action: string }])),
}));

import { POST } from '@/app/api/business-os/billing/plan/checkout/route';

function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_stored',
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    ...overrides,
  };
}

function priceFor(lookupKey: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const tier = TIER_ORDER.find((candidate) => PLAN_STRIPE_PRICES[candidate].lookupKey === lookupKey) ?? FRIEND_TIER;
  return {
    id: `price_${lookupKey}`,
    lookup_key: lookupKey,
    active: true,
    currency: 'usd',
    unit_amount: displayPriceInCents(displayMonthlyPricesUsd()[tier]),
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    ...overrides,
  };
}

const missingCustomer = () => Object.assign(new Error('No such customer'), { code: 'resource_missing', param: 'customer' });

function post(body: unknown, raw?: string) {
  return new NextRequest('https://example.test/api/business-os/billing/plan/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

const BODY = { tier: FRIEND_TIER, returnTo: 'test_harness' };
const stripeCalls = () => state.log.filter((entry) => entry.startsWith('stripe:'));

const ENV = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
let clock = Date.parse('2026-10-07T10:00:00.000Z');

beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  jest.restoreAllMocks();
});

beforeEach(() => {
  process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  // The shared price cache lives 60 s; each test runs two minutes later.
  clock += 120_000;
  jest.spyOn(Date, 'now').mockReturnValue(clock);

  state.user = { id: USER, email: 'owner@example.com' };
  state.log = [];
  state.lineage = null;
  state.invite = null;
  state.snapshot = { unavailable: false, resolution: {} };
  state.row = null;
  state.prices = null;
  state.subscriptions = [];
  state.sessions = [];
  state.lockAcquired = true;
  state.logLines = [];
  mockAcquireLock.mockReset().mockImplementation(async () => {
    state.log.push('db:acquireCheckoutLock');
    return { data: { acquired: state.lockAcquired }, error: null };
  });
  mockReplaceCustomer.mockReset().mockImplementation(async () => {
    state.log.push('db:replaceCustomer');
    return { data: { replaced: true }, error: null };
  });
  mockLogAndFlush.mockClear();
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe('POST /api/business-os/billing/plan/checkout — boundaries', () => {
  it('flag off → 404 not_available, and nothing is read: no session, no database, no Stripe (Q-6)', async () => {
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'false';
    const getUserSpy = jest.spyOn(jest.requireMock('@/lib/auth') as { getUser: () => unknown }, 'getUser');
    const response = await POST(post(BODY));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Not found', code: 'not_available' });
    expect(state.log).toEqual([]);
    expect(getUserSpy).not.toHaveBeenCalled();
  });

  it('signed out → 401, nothing read', async () => {
    state.user = null;
    const response = await POST(post(BODY));
    expect(response.status).toBe(401);
    expect(state.log).toEqual([]);
  });

  it.each([
    ['an unknown tier', { tier: 'enterprise-x', returnTo: 'test_harness' }],
    ['a missing tier', { returnTo: 'test_harness' }],
    ['a free return URL', { tier: FRIEND_TIER, returnTo: 'https://evil.example' }],
    ['an injected userId (strict body)', { ...BODY, userId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected accountId', { ...BODY, accountId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected priceId', { ...BODY, priceId: 'price_cheap' }],
    ['an injected customerId', { ...BODY, customerId: 'cus_someone_else' }],
    ['an injected amount', { ...BODY, amount: 1 }],
  ])('%s → 400 invalid_input, nothing read', async (_label, body) => {
    const response = await POST(post(body));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(state.log).toEqual([]);
  });

  it('a body that is not JSON → 400', async () => {
    const response = await POST(post(undefined, '{not json'));
    expect(response.status).toBe(400);
  });
});

describe('POST /api/business-os/billing/plan/checkout — the happy path', () => {
  it('200 with the client secret; the account is the SESSION\'s; audit flushed BEFORE the response', async () => {
    const response = await POST(post(BODY));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { clientSecret: SECRET, sessionId: 'cs_test_new', expiresAt: new Date(1_800_000_000 * 1000).toISOString(), tier: FRIEND_TIER },
    });

    expect(state.log).toContain(`db:snapshot:${USER}`);
    expect(state.log[state.log.length - 1]).toBe('audit:BOS_BILLING_CHECKOUT_STARTED');
    expect(state.log.indexOf('db:acquireCheckoutLock')).toBeLessThan(state.log.indexOf('audit:BOS_BILLING_CHECKOUT_STARTED'));

    const [entry] = mockLogAndFlush.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      action: 'BOS_BILLING_CHECKOUT_STARTED',
      entityType: 'business_os_billing_account',
      entityId: USER,
      userId: USER,
      details: {
        tier: FRIEND_TIER,
        lookupKey: PLAN_STRIPE_PRICES[FRIEND_TIER].lookupKey,
        sessionId: 'cs_test_new',
        livemode: false,
        held: false,
        actor: 'owner',
      },
    });
    expect(JSON.stringify(entry.details)).not.toContain(SECRET);
    expect(JSON.stringify(entry.details)).not.toContain('owner@example.com');
  });

  it('the session email (never the body) creates the Stripe customer', async () => {
    await POST(post(BODY));
    const params = mockStripe.findOrCreatePlatformCustomer.mock.calls[0][0] as unknown as { email: string; idempotencyKey: string };
    expect(params.email).toBe('owner@example.com');
    expect(params.idempotencyKey).toBe(`bos-customer:${USER}`);
  });

  it('a held friend buying the friend tier → 200', async () => {
    state.lineage = { invite_id: INVITE, source: 'account_invite', first_paid_at: null };
    const response = await POST(post({ tier: INVITE_ISSUANCE_POLICY.account.grantId, returnTo: 'awaiting_payment' }));
    expect(response.status).toBe(200);
    const [entry] = mockLogAndFlush.mock.calls[0] as unknown as [{ details: { held: boolean } }];
    expect(entry.details.held).toBe(true);
  });

  it('the client secret and the email never appear in a log line', async () => {
    await POST(post(BODY));
    const lines = JSON.stringify(state.logLines);
    expect(lines).not.toContain(SECRET);
    expect(lines).not.toContain('owner@example.com');
  });
});

describe('POST /api/business-os/billing/plan/checkout — refusals map to status, and early ones make NO Stripe call (C-4)', () => {
  const early: Array<[string, () => void, Record<string, unknown>, number, string]> = [
    ['price switch off', () => (process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'false'), BODY, 503, 'checkout_unavailable'],
    ['no Stripe key mode', () => (process.env.STRIPE_SECRET_KEY = 'nonsense'), BODY, 503, 'checkout_unavailable'],
    ['hold unreadable', () => (state.lineage = 'error'), BODY, 503, 'hold_unreadable'],
    [
      'held friend asking a higher tier',
      () => (state.lineage = { invite_id: INVITE, source: 'account_invite', first_paid_at: null }),
      { tier: HIGHER_TIER, returnTo: 'awaiting_payment' },
      409,
      'held_tier_not_allowed',
    ],
    [
      'held admin invitee',
      () => {
        state.lineage = { invite_id: INVITE, source: 'admin_invite', first_paid_at: null };
        state.invite = { grant_kind: 'tier', language: 'en' };
      },
      BODY,
      409,
      'held_tier_unresolved',
    ],
    ['plan snapshot unreadable', () => (state.snapshot = { unavailable: true, resolution: null }), BODY, 503, 'plan_unreadable'],
    ['no plan row', () => (state.snapshot = { unavailable: false, resolution: { anomaly: 'no_plan_row' } }), BODY, 409, 'no_plan_row'],
    ['billing row unreadable', () => (state.row = 'error'), BODY, 503, 'billing_row_unreadable'],
    ['live subscription on record', () => (state.row = billingRow({ subscriptionStatus: 'active' })), BODY, 409, 'subscription_live'],
    [
      'an open checkout',
      () => (state.row = billingRow({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2099-01-01T00:00:00.000Z' })),
      BODY,
      409,
      'checkout_open',
    ],
  ];

  it.each(early)('%s → its status and code, no Stripe call, no audit', async (_label, arrange, body, status, code) => {
    arrange();
    const response = await POST(post(body));
    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json).toMatchObject({ success: false, code });
    expect(typeof json.error).toBe('string');
    expect(stripeCalls()).toEqual([]);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('checkout_open returns the open lock\'s expiry', async () => {
    state.row = billingRow({ openCheckoutSessionId: 'cs_test_open', openCheckoutExpiresAt: '2099-01-01T00:00:00.000Z' });
    expect(await (await POST(post(BODY))).json()).toMatchObject({ code: 'checkout_open', expiresAt: '2099-01-01T00:00:00.000Z' });
  });

  it('a live subscription at Stripe (layer 1b) → 409 subscription_live, no session, no audit', async () => {
    state.row = billingRow();
    state.subscriptions = [{ complete: true, subscriptions: [{ id: 'sub_live', status: 'active' }] }];
    const response = await POST(post(BODY));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('subscription_live');
    expect(mockStripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('a price that differs from the display price → 503 price_mismatch, no customer, no session', async () => {
    state.prices = [priceFor(PLAN_STRIPE_PRICES[FRIEND_TIER].lookupKey, { unit_amount: 1 })];
    const response = await POST(post(BODY));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('price_mismatch');
    expect(mockStripe.findOrCreatePlatformCustomer).not.toHaveBeenCalled();
    expect(mockStripe.createBusinessOsPlanCheckoutSession).not.toHaveBeenCalled();
  });

  it('lock race lost → 409 checkout_busy, the session expired, no client secret, no audit', async () => {
    state.row = billingRow();
    state.lockAcquired = false;
    const response = await POST(post(BODY));
    expect(response.status).toBe(409);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('checkout_busy');
    expect(text).not.toContain(SECRET);
    expect(mockStripe.expireCheckoutSession).toHaveBeenCalledWith('cs_test_new');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('a customer deleted at Stripe → replaced once (its own key), retried, 200', async () => {
    state.row = billingRow({ stripeCustomerId: 'cus_deleted' });
    state.sessions = [missingCustomer(), { sessionId: 'cs_test_new', clientSecret: SECRET, expiresAt: 1_800_000_000, livemode: false }];
    const response = await POST(post(BODY));
    expect(response.status).toBe(200);
    expect(state.log).toContain(`stripe:createCustomer:bos-customer:${USER}:replaces:cus_deleted`);
    expect(mockReplaceCustomer).toHaveBeenCalledTimes(1);
    expect(state.log).toContain('stripe:createSession:cus_replacement');
  });

  it('a provider failure → 502 with no provider message outside development', async () => {
    state.row = billingRow();
    state.sessions = [Object.assign(new Error('Stripe internal detail xyz'), { type: 'StripeAPIError' })];
    const response = await POST(post(BODY));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('internal detail xyz');
  });

  it('an unexpected fault → 500, details only in development', async () => {
    mockAcquireLock.mockImplementation(async () => {
      throw new Error('very internal');
    });
    state.row = billingRow();
    const response = await POST(post(BODY));
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.success).toBe(false);
    if (process.env.NODE_ENV !== 'development') expect(json.details).toBeUndefined();
  });
});

describe('route source guards', () => {
  const source = readFileSync(join(process.cwd(), 'app', 'api', 'business-os', 'billing', 'plan', 'checkout', 'route.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the flag is the first thing the handler checks', () => {
    const body = code.slice(code.indexOf('export async function POST'));
    expect(body.indexOf('isPlanCheckoutEnabled()')).toBeLessThan(body.indexOf('getUser()'));
    expect(body.indexOf('isPlanCheckoutEnabled()')).toBeLessThan(body.indexOf('request.json()'));
  });

  it('the account comes from the session through the seam; the body schema is strict', () => {
    expect(code).toContain('resolveAccountId(user.id)');
    expect(code).toContain('.strict()');
    expect(code).not.toMatch(/body\.(userId|accountId|email)/);
  });

  it('audits with logAndFlush (WC-7), Pino only', () => {
    expect(code).toContain('await logAndFlush(');
    expect(code).not.toMatch(/console\./);
  });
});
