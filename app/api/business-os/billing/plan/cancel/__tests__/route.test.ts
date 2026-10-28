/**
 * POST /api/business-os/billing/plan/cancel and
 * POST /api/business-os/billing/plan/reactivate (plan payments P-7a.1,
 * workplan §4.2, §7 "Routes"; SA C-1 to C-5, TQ-1 to TQ-5).
 *
 * Integration through the REAL routes and the REAL orchestration; only the
 * edges are fakes: the session, the billing repository, Stripe and the audit
 * flush. Every call lands in one ordered log, so "nothing was read" and
 * "the audit was flushed before the response" are assertions, not hopes.
 *
 * Happy path and failure paths per route: switch off (404, nothing read),
 * signed out (401), invalid input (400, an injected id included; C-5), an
 * our-data refusal (409, zero Stripe calls), a lost Stripe answer (502 with
 * outcomeUnknown, audited), `unchanged` (200, not audited).
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
// Relative to the real clock: the routes use it, and a fixed date would rot into "period over".
const PERIOD_END = Math.floor(Date.now() / 1000) + 86400 * 30;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

const state: {
  user: { id: string; email?: string } | null;
  log: string[];
  audits: Array<Record<string, unknown>>;
  flushed: boolean;
  row: Record<string, unknown> | null | 'error';
  subscription: Record<string, unknown>;
  write: Record<string, unknown> | Error | null;
} = { user: null, log: [], audits: [], flushed: false, row: null, subscription: {}, write: null };

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async (userId: string, livemode: boolean) => {
      state.log.push(`db:findByUser:${userId}:${livemode}`);
      if (state.row === 'error') return { data: null, error: new Error('down') };
      return { data: state.row, error: null };
    },
    mirrorSubscriptionState: async (input: { cancelAtPeriodEnd: boolean }) => {
      state.log.push(`db:mirror:${input.cancelAtPeriodEnd}`);
      return { data: { mirrored: true }, error: null };
    },
  },
}));

const mockStripe = {
  retrieveBusinessOsSubscription: jest.fn(async (id: string) => {
    state.log.push(`stripe:retrieve:${id}`);
    return state.subscription;
  }),
  setBusinessOsCancelAtPeriodEnd: jest.fn(async (id: string, value: boolean) => {
    state.log.push(`stripe:update:${id}:${value}`);
    if (state.write instanceof Error) throw state.write;
    return (
      state.write ?? {
        id: 'sub_own',
        status: 'active',
        customerId: 'cus_own',
        livemode: false,
        cancelAtPeriodEnd: value,
        cancelAt: value ? PERIOD_END : null,
        endedAt: null,
        currentPeriodEnd: PERIOD_END,
      }
    );
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

const mockLogAndFlush = jest.fn(async (entry: Record<string, unknown>) => {
  state.log.push(`audit:${String(entry.action)}`);
  state.audits.push(entry);
  // A real flush takes time: the response must wait for it (WC-7).
  await new Promise((resolve) => setTimeout(resolve, 15));
  state.flushed = true;
});
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...(args as [Record<string, unknown>])),
}));

import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';
import { POST as REACTIVATE } from '@/app/api/business-os/billing/plan/reactivate/route';

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
    endedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_own',
    status: 'active',
    customerId: 'cus_own',
    billingCycleAnchor: PERIOD_END - 86400 * 30,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds: ['price_one'],
    items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
    pendingUpdate: null,
    latestInvoiceId: 'in_last',
    ...overrides,
  };
}

function post(url: string, body: unknown, raw?: string) {
  return new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}
const cancelPost = (body: unknown, raw?: string) => CANCEL(post('/api/business-os/billing/plan/cancel', body, raw));
const reactivatePost = (body: unknown, raw?: string) => REACTIVATE(post('/api/business-os/billing/plan/reactivate', body, raw));
const stripeCalls = () => state.log.filter((entry) => entry.startsWith('stripe:'));

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
  // BQ-1 / C-1: the checkout switch is NOT what these routes follow.
  process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'false';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  state.user = { id: USER, email: 'owner@example.com' };
  state.log = [];
  state.audits = [];
  state.flushed = false;
  state.row = billingRow();
  state.subscription = subscription();
  state.write = null;
  mockLogAndFlush.mockClear();
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe.each([
  ['cancel', cancelPost],
  ['reactivate', reactivatePost],
] as const)('%s — boundaries', (_name, send) => {
  it('C-1: the price switch off → 404, nothing read (no session, no database, no Stripe)', async () => {
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'false';
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
    const getUserSpy = jest.spyOn(jest.requireMock('@/lib/auth') as { getUser: () => unknown }, 'getUser');
    const response = await send({});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Not found', code: 'not_available' });
    expect(state.log).toEqual([]);
    expect(getUserSpy).not.toHaveBeenCalled();
    getUserSpy.mockRestore();
  });

  it('BQ-1: works with the CHECKOUT switch off (pausing sales never strands a payer)', async () => {
    const response = await send({});
    expect(response.status).not.toBe(404);
  });

  it('signed out → 401, nothing read', async () => {
    state.user = null;
    const response = await send({});
    expect(response.status).toBe(401);
    expect(state.log).toEqual([]);
  });

  it.each([
    ['an injected userId', { userId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected subscriptionId', { subscriptionId: 'sub_someone_else' }],
    ['an injected customerId', { customerId: 'cus_someone_else' }],
    ['a non-object body', [1, 2]],
  ])('C-5: %s → 400 invalid_input, nothing read', async (_label, body) => {
    const response = await send(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(state.log).toEqual([]);
  });

  it('C-5: unparsable JSON → 400, nothing read', async () => {
    const response = await send(null, '{not json');
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });

  it('our-data refusal (no subscription on our record) → 409, zero Stripe calls, not audited', async () => {
    state.row = billingRow({ stripeSubscriptionId: null, subscriptionStatus: null });
    const response = await send({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('not_subscribed');
    expect(stripeCalls()).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  // P-7a.4: the CANCEL now ends the plan (route.p7a4.test.ts); a REACTIVATE is still refused on our data.
  it('a failed renewal on our record → reactivate 409 payment_failed_contact_us, zero Stripe calls', async () => {
    state.row = billingRow({ subscriptionStatus: 'past_due', failedAttempts: 1 });
    const response = await reactivatePost({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('payment_failed_contact_us');
    expect(stripeCalls()).toEqual([]);
  });

  it('billing row unreadable → 503, zero Stripe calls', async () => {
    state.row = 'error';
    const response = await send({});
    expect(response.status).toBe(503);
    expect(stripeCalls()).toEqual([]);
  });

  it('C-4: Stripe names another customer → 409 billing_record_mismatch, no write, no audit', async () => {
    state.row = billingRow({ cancelAtPeriodEnd: _name === 'reactivate' });
    state.subscription = subscription({ customerId: 'cus_other', cancelAtPeriodEnd: _name === 'reactivate' });
    const response = await send({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('billing_record_mismatch');
    expect(stripeCalls()).toEqual(['stripe:retrieve:sub_own']);
    expect(state.audits).toEqual([]);
  });
});

describe('cancel', () => {
  it('happy path: one write, mirrored, audited and flushed BEFORE the response', async () => {
    const response = await cancelPost({});
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: PERIOD_END_ISO } });
    expect(state.log).toEqual([
      `db:findByUser:${USER}:false`,
      'stripe:retrieve:sub_own',
      'stripe:update:sub_own:true',
      'db:mirror:true',
      'audit:BOS_BILLING_SUBSCRIPTION_CANCELLED',
    ]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: 'BOS_BILLING_SUBSCRIPTION_CANCELLED',
      entityType: 'business_os_billing_account',
      entityId: USER,
      userId: USER,
      details: { subscriptionId: 'sub_own', outcome: 'cancelled', endsOn: PERIOD_END_ISO, mode: 'period_end', livemode: false, actor: 'owner' },
    });
  });

  it('already cancelling at Stripe → 200 unchanged, no write, NOT audited', async () => {
    state.row = billingRow({ cancelAtPeriodEnd: true });
    state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'cancelling', date: PERIOD_END_ISO } });
    expect(stripeCalls()).toEqual(['stripe:retrieve:sub_own']);
    expect(state.audits).toEqual([]);
  });

  it('TQ-5: a pending upgrade update → 409 upgrade_pending with retryAfter, no write', async () => {
    state.subscription = subscription({ pendingUpdate: { expiresAt: PERIOD_END - 86400 * 25, priceIds: ['price_pro'] } });
    const response = await cancelPost({});
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('upgrade_pending');
    expect(typeof body.retryAfter).toBe('string');
    expect(stripeCalls()).toEqual(['stripe:retrieve:sub_own']);
  });

  it('a lost Stripe answer → 502 outcomeUnknown, audited as unknown, flushed first', async () => {
    state.write = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    const response = await cancelPost({});
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, code: 'stripe_error', outcomeUnknown: true });
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ action: 'BOS_BILLING_SUBSCRIPTION_CANCELLED', details: { outcome: 'unknown' } });
  });

  it('Stripe refused before running → 502, no outcomeUnknown, not audited', async () => {
    state.write = Object.assign(new Error('bad request'), { type: 'StripeInvalidRequestError' });
    const response = await cancelPost({});
    expect(response.status).toBe(502);
    expect((await response.json()).outcomeUnknown).toBeUndefined();
    expect(state.audits).toEqual([]);
  });

  it('an unexpected fault (the repository throws) → 500, no internals outside development', async () => {
    const repo = (jest.requireMock('@/lib/repositories/BusinessOsBillingAccountRepository') as {
      businessOsBillingAccountRepository: { findByUser: () => unknown };
    }).businessOsBillingAccountRepository;
    const spy = jest.spyOn(repo, 'findByUser').mockImplementationOnce(() => {
      throw new Error('secret internal detail');
    });
    const response = await cancelPost({});
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret internal detail');
    expect(stripeCalls()).toEqual([]);
    spy.mockRestore();
  });
});

describe('reactivate', () => {
  beforeEach(() => {
    state.row = billingRow({ cancelAtPeriodEnd: true });
    state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
  });

  it('happy path: one write (false), mirrored, audited and flushed BEFORE the response', async () => {
    const response = await reactivatePost({});
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'reactivated', renewsOn: PERIOD_END_ISO } });
    expect(state.log).toEqual([
      `db:findByUser:${USER}:false`,
      'stripe:retrieve:sub_own',
      'stripe:update:sub_own:false',
      'db:mirror:false',
      'audit:BOS_BILLING_SUBSCRIPTION_REACTIVATED',
    ]);
    expect(state.audits[0]).toMatchObject({
      action: 'BOS_BILLING_SUBSCRIPTION_REACTIVATED',
      entityType: 'business_os_billing_account',
      entityId: USER,
      details: { subscriptionId: 'sub_own', outcome: 'reactivated', renewsOn: PERIOD_END_ISO, actor: 'owner' },
    });
  });

  it('not cancelling at Stripe → 200 unchanged; our stale row healed; not audited', async () => {
    state.subscription = subscription();
    const response = await reactivatePost({});
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'renewing', date: PERIOD_END_ISO } });
    expect(state.log).toEqual([`db:findByUser:${USER}:false`, 'stripe:retrieve:sub_own', 'db:mirror:false']);
    expect(state.audits).toEqual([]);
  });
});

describe('D2 / SX-1: the reason code (SX C-10, SA-4; SA Q-4, Q-5, W-10)', () => {
  it('cancel with a listed reason → 200; the audit details carry the code', async () => {
    const response = await cancelPost({ reasonCode: 'too_expensive' });
    expect(response.status).toBe(200);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'cancelled', reasonCode: 'too_expensive', actor: 'owner' } });
  });

  it('cancel with {} still works (P-7a.1 screen) → reasonCode null', async () => {
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect((state.audits[0].details as Record<string, unknown>).reasonCode).toBeNull();
  });

  it.each([
    ['an unlisted code', { reasonCode: 'because' }],
    ['a free-text note beside a code (no free text, SX C-10)', { reasonCode: 'other', note: 'my clients left' }],
    ['a label instead of a code', { reasonCode: 'Too expensive' }],
    ['a non-string code', { reasonCode: 3 }],
  ])('cancel with %s → 400 invalid_input, nothing read', async (_label, body) => {
    const response = await cancelPost(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(state.log).toEqual([]);
  });

  it('reactivate with a reasonCode → 400 (its body stays {} strict), nothing read', async () => {
    state.row = billingRow({ cancelAtPeriodEnd: true });
    const response = await reactivatePost({ reasonCode: 'too_expensive' });
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });

  it('the write receives a per-attempt idempotency key (SX C-4), never in the audit row', async () => {
    await cancelPost({ reasonCode: 'too_expensive' });
    expect(mockStripe.setBusinessOsCancelAtPeriodEnd).toHaveBeenCalledTimes(1);
    const options = (mockStripe.setBusinessOsCancelAtPeriodEnd.mock.calls[0] as unknown[])[2] as { idempotencyKey: string };
    expect(options.idempotencyKey).toMatch(/^bos-plan-manage:sub_own:cancel:[0-9a-f-]{36}$/);
    expect(JSON.stringify(state.audits)).not.toContain(options.idempotencyKey);
  });
});

describe('D2 / SX-1: change_pending (SA W-3)', () => {
  it('cancel with a tier change pending on our record → 409 change_pending, zero Stripe calls, not audited', async () => {
    state.row = billingRow({ pendingTier: 'tier_two' });
    const response = await cancelPost({});
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('change_pending');
    expect(stripeCalls()).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('reactivate is not refused for it: a cancelling plan with a change pending is kept', async () => {
    state.row = billingRow({ cancelAtPeriodEnd: true, pendingTier: 'tier_two' });
    state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
    const response = await reactivatePost({});
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('reactivated');
  });
});
