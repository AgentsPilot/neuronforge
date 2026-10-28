/**
 * QA gap tests for D2 / SX-1 (workplan
 * docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md, SA code review
 * 2026-10-27, "What QA must exercise" items 2-4), through the REAL cancel and
 * reactivate routes and the REAL engine. Only the edges are fakes (session,
 * billing repository, Stripe, audit flush), and, unlike route.test.ts, the
 * logger CAPTURES every line, so "never in a log line" is asserted at the
 * route boundary too.
 *
 * Covers what route.test.ts / planCancelEngine.d2.test.ts leave out:
 *   - every one of the seven reason codes → 200 with that code in the audit;
 *   - more invalid bodies (injections beside a valid code, null, array, case);
 *   - reactivate with each code → 400;
 *   - change_pending at the route for an unexpired checkout lock (warn log,
 *     zero Stripe calls, no audit), an expired lock (proceeds), Keep on a
 *     cancelling row with an open lock, Keep repairing a stale renewing row;
 *   - the screen wire is null in that state;
 *   - cancel → keep → cancel through the routes: three distinct keys, never in
 *     a log line or audit row; a double press consumes one key.
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const PERIOD_END = Math.floor(Date.now() / 1000) + 86400 * 30;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();
const FUTURE_ISO = new Date(Date.now() + 3600_000).toISOString();
const PAST_ISO = new Date(Date.now() - 3600_000).toISOString();
const KEY_SHAPE = /^bos-plan-manage:sub_own:(cancel|reactivate):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const mockState: {
  user: { id: string; email?: string } | null;
  log: string[];
  logs: unknown[];
  audits: Array<Record<string, unknown>>;
  row: Record<string, unknown> | null;
  stripeCancelling: boolean;
  keys: Array<string | undefined>;
  argCounts: number[];
} = { user: null, log: [], logs: [], audits: [], row: null, stripeCancelling: false, keys: [], argCounts: [] };

jest.mock('@/lib/auth', () => ({ getUser: async () => mockState.user }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (bound: Record<string, unknown>): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug', 'fatal', 'trace']) {
      logger[level] = (...args: unknown[]) => {
        mockState.logs.push([level, bound, ...args]);
      };
    }
    logger.child = (more: Record<string, unknown>) => make({ ...bound, ...more });
    return logger;
  };
  return { createLogger: (base: Record<string, unknown>) => make(base ?? {}) };
});

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async (userId: string, livemode: boolean) => {
      mockState.log.push(`db:findByUser:${userId}:${livemode}`);
      return { data: mockState.row ? { ...mockState.row } : null, error: null };
    },
    mirrorSubscriptionState: async (input: { cancelAtPeriodEnd: boolean; status: string }) => {
      mockState.log.push(`db:mirror:${input.cancelAtPeriodEnd}`);
      if (mockState.row) mockState.row = { ...mockState.row, cancelAtPeriodEnd: input.cancelAtPeriodEnd };
      return { data: { mirrored: true }, error: null };
    },
  },
}));

const mockStripe = {
  retrieveBusinessOsSubscription: jest.fn(async (id: string) => {
    mockState.log.push(`stripe:retrieve:${id}`);
    return {
      id: 'sub_own',
      status: 'active',
      customerId: 'cus_own',
      billingCycleAnchor: PERIOD_END - 86400 * 30,
      cancelAtPeriodEnd: mockState.stripeCancelling,
      cancelAt: mockState.stripeCancelling ? PERIOD_END : null,
      endedAt: null,
      livemode: false,
      metadata: {},
      priceIds: ['price_one'],
      items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
      pendingUpdate: null,
      latestInvoiceId: 'in_last',
    };
  }),
  setBusinessOsCancelAtPeriodEnd: jest.fn(async (...args: unknown[]) => {
    const [id, value, options] = args as [string, boolean, { idempotencyKey?: string } | undefined];
    mockState.log.push(`stripe:update:${id}:${value}`);
    mockState.keys.push(options?.idempotencyKey);
    mockState.argCounts.push(args.length);
    mockState.stripeCancelling = value;
    return {
      id: 'sub_own',
      status: 'active',
      customerId: 'cus_own',
      livemode: false,
      cancelAtPeriodEnd: value,
      cancelAt: value ? PERIOD_END : null,
      endedAt: null,
      currentPeriodEnd: PERIOD_END,
    };
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: async (entry: Record<string, unknown>) => {
    mockState.log.push(`audit:${String(entry.action)}`);
    mockState.audits.push(entry);
  },
}));

import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';
import { POST as REACTIVATE } from '@/app/api/business-os/billing/plan/reactivate/route';
import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { planManageOffer, planManageWire } from '@/lib/business-os/billing/planManageOffer';

function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: 'tier_one',
    currentPeriodEnd: PERIOD_END_ISO,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    endedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

function post(url: string, body: unknown) {
  return new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const cancelPost = (body: unknown) => CANCEL(post('/api/business-os/billing/plan/cancel', body));
const reactivatePost = (body: unknown) => REACTIVATE(post('/api/business-os/billing/plan/reactivate', body));
const stripeCalls = () => mockState.log.filter((entry) => entry.startsWith('stripe:'));
const warnsWith = (code: string) =>
  mockState.logs.filter((line) => {
    const [level, , context] = line as [string, unknown, Record<string, unknown> | undefined];
    return level === 'warn' && context?.code === code;
  });

const ENV = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

beforeEach(() => {
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'false';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  mockState.user = { id: USER, email: 'owner@example.com' };
  mockState.log = [];
  mockState.logs = [];
  mockState.audits = [];
  mockState.row = billingRow();
  mockState.stripeCancelling = false;
  mockState.keys = [];
  mockState.argCounts = [];
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe('QA item 2: reason codes at the cancel route', () => {
  it('the list is the seven agreed codes', () => {
    expect([...PLAN_LEAVE_REASON_CODES]).toEqual([
      'too_expensive',
      'not_using_enough',
      'missing_feature',
      'switching_tool',
      'business_closing',
      'technical_problems',
      'other',
    ]);
  });

  it.each(PLAN_LEAVE_REASON_CODES.map((code) => [code]))('%s → 200 cancelled, one write, the audit carries that code', async (code) => {
    const response = await cancelPost({ reasonCode: code });
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('cancelled');
    expect(stripeCalls()).toEqual(['stripe:retrieve:sub_own', 'stripe:update:sub_own:true']);
    expect(mockState.audits).toHaveLength(1);
    expect(mockState.audits[0]).toMatchObject({ action: 'BOS_BILLING_SUBSCRIPTION_CANCELLED', details: { reasonCode: code, outcome: 'cancelled' } });
  });

  it('{} → 200, audit details.reasonCode is null (present, not absent)', async () => {
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    const details = mockState.audits[0].details as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(details, 'reasonCode')).toBe(true);
    expect(details.reasonCode).toBeNull();
  });

  it.each([
    ['an unlisted code', { reasonCode: 'price' }],
    ['a code in upper case', { reasonCode: 'TOO_EXPENSIVE' }],
    ['a label (English)', { reasonCode: 'Too expensive' }],
    ['a label (Hebrew)', { reasonCode: 'יקר מדי' }],
    ['a number', { reasonCode: 1 }],
    ['an empty string', { reasonCode: '' }],
    ['null', { reasonCode: null }],
    ['an array of codes', { reasonCode: ['too_expensive'] }],
    ['an extra note beside a valid code', { reasonCode: 'other', note: 'free text' }],
    ['an injected userId beside a valid code', { reasonCode: 'other', userId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected userId alone', { userId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected subscriptionId beside a valid code', { reasonCode: 'other', subscriptionId: 'sub_other' }],
    ['an injected accountId beside a valid code', { reasonCode: 'other', accountId: '99999999-9999-4999-8999-999999999999' }],
  ])('%s → 400 invalid_input, nothing read, nothing audited', async (_label, body) => {
    const response = await cancelPost(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(mockState.log).toEqual([]);
    expect(mockState.audits).toEqual([]);
  });

  it.each(PLAN_LEAVE_REASON_CODES.map((code) => [code]))('reactivate with reasonCode %s → 400, nothing read', async (code) => {
    mockState.row = billingRow({ cancelAtPeriodEnd: true });
    mockState.stripeCancelling = true;
    const response = await reactivatePost({ reasonCode: code });
    expect(response.status).toBe(400);
    expect(mockState.log).toEqual([]);
  });

  it('reactivate audit never carries a reason (null)', async () => {
    mockState.row = billingRow({ cancelAtPeriodEnd: true });
    mockState.stripeCancelling = true;
    const response = await reactivatePost({});
    expect(response.status).toBe(200);
    const details = (mockState.audits[0]?.details ?? {}) as Record<string, unknown>;
    expect(details.reasonCode ?? null).toBeNull();
  });
});

describe('QA item 3: change_pending at the routes', () => {
  it.each([
    ['pending_tier', { pendingTier: 'tier_two' }],
    ['an unexpired checkout lock', { openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE_ISO }],
  ])('renewing + %s: cancel → 409 change_pending, zero Stripe calls, no audit, one warn log', async (_name, overrides) => {
    mockState.row = billingRow(overrides);
    const response = await cancelPost({ reasonCode: 'too_expensive' });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'change_pending', error: 'A plan change is in progress. Try again once it is finished.' });
    expect(stripeCalls()).toEqual([]);
    expect(mockState.audits).toEqual([]);
    expect(warnsWith('change_pending')).toHaveLength(1);
    // The refusal log is the code only: no reason text or label leaks into it.
    expect(JSON.stringify(warnsWith('change_pending'))).not.toContain('too_expensive');
  });

  it('an expired checkout lock: the cancel proceeds (one write, audited)', async () => {
    mockState.row = billingRow({ openCheckoutSessionId: 'cs_old', openCheckoutExpiresAt: PAST_ISO });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('cancelled');
    expect(mockState.audits).toHaveLength(1);
  });

  it.each([
    ['pending_tier', { pendingTier: 'tier_two' }],
    ['an unexpired checkout lock', { openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE_ISO }],
  ])('cancelling + %s: Keep → 200 reactivated (one write)', async (_name, overrides) => {
    mockState.row = billingRow({ cancelAtPeriodEnd: true, ...overrides });
    mockState.stripeCancelling = true;
    const response = await reactivatePost({});
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('reactivated');
    expect(stripeCalls()).toEqual(['stripe:retrieve:sub_own', 'stripe:update:sub_own:false']);
  });

  it.each([
    ['pending_tier', { pendingTier: 'tier_two' }],
    ['an unexpired checkout lock', { openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE_ISO }],
  ])('stale renewing row + %s, Stripe cancelling: Keep repairs it (write false, row mirrored)', async (_name, overrides) => {
    mockState.row = billingRow(overrides);
    mockState.stripeCancelling = true;
    const response = await reactivatePost({});
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('reactivated');
    expect(mockState.log).toContain('stripe:update:sub_own:false');
    expect(mockState.stripeCancelling).toBe(false);
  });

  it('the screen wire is null (no Cancel control) for a renewing row with a pending change; an expired lock shows Cancel', () => {
    const now = new Date();
    const facts = (overrides: Record<string, unknown>) => billingRow(overrides) as unknown as Parameters<typeof planManageOffer>[0];
    expect(planManageWire(planManageOffer(facts({ pendingTier: 'tier_two' }), { pricesEnabled: true }, now))).toBeNull();
    expect(
      planManageWire(planManageOffer(facts({ openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: FUTURE_ISO }), { pricesEnabled: true }, now))
    ).toBeNull();
    expect(
      planManageWire(planManageOffer(facts({ openCheckoutSessionId: 'cs_old', openCheckoutExpiresAt: PAST_ISO }), { pricesEnabled: true }, now))
    ).toEqual({ cancel: true, reactivate: false, paymentFailed: false });
    expect(planManageWire(planManageOffer(facts({ cancelAtPeriodEnd: true, pendingTier: 'tier_two' }), { pricesEnabled: true }, now))).toEqual({
      cancel: false,
      reactivate: true,
      paymentFailed: false,
    });
  });
});

describe('QA item 4: per-attempt keys through the routes', () => {
  it('cancel → keep → cancel: three writes, three distinct keys of the stated shape, none in a log line or audit row', async () => {
    expect((await cancelPost({ reasonCode: 'other' })).status).toBe(200);
    expect((await reactivatePost({})).status).toBe(200);
    expect((await cancelPost({})).status).toBe(200);

    expect(stripeCalls().filter((c) => c.startsWith('stripe:update:'))).toEqual([
      'stripe:update:sub_own:true',
      'stripe:update:sub_own:false',
      'stripe:update:sub_own:true',
    ]);
    const keys = mockState.keys as string[];
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(KEY_SHAPE);
    expect(keys.map((k) => k.split(':')[2])).toEqual(['cancel', 'reactivate', 'cancel']);
    // The write always gets the 3-argument form from the engine.
    expect(mockState.argCounts).toEqual([3, 3, 3]);

    expect(mockState.audits).toHaveLength(3);
    const logged = JSON.stringify(mockState.logs);
    const audited = JSON.stringify(mockState.audits);
    expect(mockState.logs.length).toBeGreaterThan(0);
    for (const key of keys) {
      const uuid = key.split(':').pop() as string;
      expect(logged).not.toContain(key);
      expect(logged).not.toContain(uuid);
      expect(audited).not.toContain(key);
      expect(audited).not.toContain(uuid);
    }
  });

  it('a double press of Cancel: one write, one key; the second is unchanged and not audited', async () => {
    const first = await cancelPost({});
    const second = await cancelPost({});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).data.outcome).toBe('unchanged');
    expect(mockState.keys).toHaveLength(1);
    expect(mockState.audits).toHaveLength(1);
  });
});
