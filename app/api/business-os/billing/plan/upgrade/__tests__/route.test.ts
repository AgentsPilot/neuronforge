/**
 * POST /api/business-os/billing/plan/upgrade/preview and
 * POST /api/business-os/billing/plan/upgrade (plan payments P-7b.1a,
 * workplan §3.4 and §7 "Routes"; SA U-9, V-1, V-3, V-9, V-11).
 *
 * Integration through the REAL routes and the REAL orchestration; only the
 * edges are fakes: the session, the billing repository, the price catalog,
 * Stripe and the audit flush. Every call lands in one ordered log. Every
 * logger call and every audit entry is captured, so the confirmation secret
 * can be shown to appear only in the confirm's 200 body (V-1).
 *
 * Stripe answers are HAND-BUILT (the sandbox captures wait on E-1 to E-6).
 */

import { NextRequest } from 'next/server';

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { displayMonthlyPricesUsd, displayPriceInCents } from '@/lib/business-os/billing/planPriceCheck';
import { PLAN_UPGRADE_REFUSALS } from '@/lib/business-os/billing/planUpgrade';

const USER = '11111111-1111-4111-8111-111111111111';
const LOWER = TIER_ORDER[0];
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const PRICE_LOWER = `price_${PLAN_STRIPE_PRICES[LOWER].lookupKey}`;
const PRICE_TOP = `price_${PLAN_STRIPE_PRICES[TOP].lookupKey}`;
const SECRET = 'pi_handbuilt_route_secret_owner_only';

const nowSeconds = () => Math.floor(new Date().getTime() / 1000);

const state: {
  user: { id: string; email?: string } | null;
  log: string[];
  logLines: unknown[];
  audits: unknown[];
  flushed: boolean;
  row: Record<string, unknown> | null | 'error';
  subscription: Record<string, unknown>;
  update: Record<string, unknown> | Error;
  invoice: Record<string, unknown>;
} = {
  user: null,
  log: [],
  logLines: [],
  audits: [],
  flushed: false,
  row: null,
  subscription: {},
  update: {},
  invoice: {},
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

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    findByUser: async (userId: string, livemode: boolean) => {
      state.log.push(`db:findByUser:${userId}:${livemode}`);
      if (state.row === 'error') return { data: null, error: new Error('down') };
      return { data: state.row, error: null };
    },
  },
}));

jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return {
    ...actual,
    planPriceCatalog: {
      load: async () => {
        state.log.push('stripe:catalog');
        const { PLAN_STRIPE_PRICES: prices } = jest.requireActual('@/lib/business-os/entitlements/config/planPrices');
        const { TIER_ORDER: order } = jest.requireActual('@/lib/business-os/entitlements/config/tierMatrix');
        return {
          byPriceId: new Map((order as string[]).map((tier) => [`price_${prices[tier].lookupKey}`, prices[tier].lookupKey])),
          fromCache: false,
        };
      },
    },
  };
});

const mockStripe = {
  retrieveBusinessOsSubscription: jest.fn(async (id: string) => {
    state.log.push(`stripe:subscription:${id}`);
    return state.subscription;
  }),
  retrieveBusinessOsUpgradeInvoice: jest.fn(async (id: string) => {
    state.log.push(`stripe:invoice:${id}`);
    return state.invoice;
  }),
  previewBusinessOsPlanUpgrade: jest.fn(async () => {
    state.log.push('stripe:preview');
    return { amountDueMinor: 2985, totalMinor: 2985, taxMinor: 0, currency: 'usd' };
  }),
  upgradeBusinessOsPlanSubscription: jest.fn(async () => {
    state.log.push('stripe:update');
    if (state.update instanceof Error) throw state.update;
    return state.update;
  }),
  listPricesByLookupKeys: jest.fn(async (keys: readonly string[]) => {
    state.log.push(`stripe:prices:${keys.join(',')}`);
    return keys.map((lookupKey) => {
      const tier = (TIER_ORDER as readonly string[]).find((candidate) => PLAN_STRIPE_PRICES[candidate as typeof LOWER].lookupKey === lookupKey) as typeof LOWER;
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
      };
    });
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

const mockLogAndFlush = jest.fn(async (entry: { action: string }) => {
  state.log.push(`audit:${entry.action}`);
  state.audits.push(entry);
  // A real flush takes time: the response must wait for it (WC-7).
  await new Promise((resolve) => setTimeout(resolve, 15));
  state.flushed = true;
});
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...(args as [{ action: string }])),
}));

import { POST as PREVIEW } from '@/app/api/business-os/billing/plan/upgrade/preview/route';
import { POST as CONFIRM } from '@/app/api/business-os/billing/plan/upgrade/route';

function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: LOWER,
    cancelAtPeriodEnd: false,
    endedAt: null,
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_own',
    status: 'active',
    customerId: 'cus_own',
    billingCycleAnchor: nowSeconds() - 86400 * 10,
    cancelAtPeriodEnd: false,
    endedAt: null,
    livemode: false,
    metadata: {},
    priceIds: [PRICE_LOWER],
    items: [{ id: 'si_own', priceId: PRICE_LOWER, currentPeriodStart: nowSeconds() - 86400 * 10, currentPeriodEnd: nowSeconds() + 86400 * 20 }],
    pendingUpdate: null,
    latestInvoiceId: 'in_last',
    ...overrides,
  };
}

const PAID = {
  subscriptionId: 'sub_own',
  livemode: false,
  pendingUpdate: false,
  pendingUpdateExpiresAt: null,
  invoiceId: 'in_up',
  invoiceStatus: 'paid',
  paymentState: 'succeeded',
  confirmationClientSecret: SECRET,
};

function post(url: string, body: unknown, raw?: string) {
  return new NextRequest(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}
const previewPost = (body: unknown, raw?: string) => PREVIEW(post('/api/business-os/billing/plan/upgrade/preview', body, raw));
const confirmPost = (body: unknown, raw?: string) => CONFIRM(post('/api/business-os/billing/plan/upgrade', body, raw));
const confirmBody = (overrides: Record<string, unknown> = {}) => ({ tier: TOP, prorationDate: nowSeconds() - 5, ...overrides });

const stripeCalls = () => state.log.filter((entry) => entry.startsWith('stripe:'));

/** V-1: the secret in no log line and no audit entry. */
function expectSecretInNoLogOrAudit() {
  expect(JSON.stringify(state.logLines)).not.toContain(SECRET);
  expect(JSON.stringify(state.audits)).not.toContain(SECRET);
}

const ENV = ['BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
let clock = Date.parse('2026-10-13T10:00:00.000Z');

const mutablePresentation = TIER_MATRIX.presentation as Record<string, { availableToBuy: boolean }>;
const savedAvailableToBuy = Object.fromEntries(TIER_ORDER.map((tier) => [tier, mutablePresentation[tier].availableToBuy]));

beforeAll(() => {
  for (const name of ENV) savedEnv[name] = process.env[name];
});
afterAll(() => {
  for (const name of ENV) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  for (const tier of TIER_ORDER) mutablePresentation[tier].availableToBuy = savedAvailableToBuy[tier];
  jest.restoreAllMocks();
});

beforeEach(() => {
  process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
  process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  // The production values (on for every tier since 2026-10-13), restored per test.
  for (const tier of TIER_ORDER) mutablePresentation[tier].availableToBuy = true;
  // The shared price cache lives 60 s; each test runs two minutes later.
  clock += 120_000;
  jest.spyOn(Date, 'now').mockReturnValue(clock);

  state.user = { id: USER, email: 'owner@example.com' };
  state.log = [];
  state.logLines = [];
  state.audits = [];
  state.flushed = false;
  state.row = billingRow();
  state.subscription = subscription();
  state.update = { ...PAID };
  state.invoice = {
    invoiceId: 'in_last',
    subscriptionId: 'sub_own',
    customerId: 'cus_own',
    status: 'open',
    billingReason: 'subscription_update',
    amountDueMinor: 2985,
    livemode: false,
    paymentState: 'requires_action',
    confirmationClientSecret: SECRET,
  };
  mockLogAndFlush.mockClear();
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe.each([
  ['preview', previewPost, { tier: TOP }],
  ['confirm', confirmPost, { tier: TOP, prorationDate: 1_790_000_000 }],
] as const)('%s — boundaries (V-11)', (_name, send, validBody) => {
  it('switch off → 404 not_available, and nothing is read: no session, no database, no Stripe', async () => {
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'false';
    const getUserSpy = jest.spyOn(jest.requireMock('@/lib/auth') as { getUser: () => unknown }, 'getUser');
    const response = await send(validBody);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false, error: 'Not found', code: 'not_available' });
    expect(state.log).toEqual([]);
    expect(getUserSpy).not.toHaveBeenCalled();
    getUserSpy.mockRestore();
  });

  it('signed out → 401, nothing read', async () => {
    state.user = null;
    const response = await send(validBody);
    expect(response.status).toBe(401);
    expect(state.log).toEqual([]);
  });

  it.each([
    ['an unknown tier', { ...validBody, tier: 'enterprise-x' }],
    ['a missing tier', {}],
    ['an injected userId', { ...validBody, userId: '99999999-9999-4999-8999-999999999999' }],
    ['an injected subscriptionId', { ...validBody, subscriptionId: 'sub_someone_else' }],
    ['an injected priceId', { ...validBody, priceId: 'price_cheap' }],
    ['an injected customerId', { ...validBody, customerId: 'cus_someone_else' }],
    ['an injected amount', { ...validBody, amountDueMinor: 1 }],
  ])('%s → 400 invalid_input, nothing read', async (_label, body) => {
    const response = await send(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(state.log).toEqual([]);
  });

  it('a body that is not JSON → 400', async () => {
    const response = await send(undefined, '{not json');
    expect(response.status).toBe(400);
  });
});

describe('confirm — the proration date must be an integer (V-11)', () => {
  it.each([
    ['a non-integer', 1_790_000_000.5],
    ['a string', '1790000000'],
    ['zero', 0],
    ['negative', -5],
    ['missing', undefined],
  ])('%s → 400, nothing read', async (_label, prorationDate) => {
    const response = await confirmPost({ tier: TOP, ...(prorationDate === undefined ? {} : { prorationDate }) });
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });
});

describe('preview — happy path and refusals', () => {
  it('200 with the amounts (taxMinor, V-12) and the proration date; logged, NEVER audited', async () => {
    const response = await previewPost({ tier: TOP });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      data: {
        fromTier: LOWER,
        tier: TOP,
        amountDueMinor: 2985,
        taxMinor: 0,
        currency: 'usd',
        prorationDate: expect.any(Number),
        renewsOn: expect.any(String),
        monthlyPriceMinor: displayPriceInCents(displayMonthlyPricesUsd()[TOP]),
      },
    });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    // V-9: every DB read before any Stripe call.
    expect(state.log[0]).toBe(`db:findByUser:${USER}:false`);
    expect(state.log.slice(1).every((entry) => entry.startsWith('stripe:'))).toBe(true);
    expect(mockStripe.retrieveBusinessOsSubscription).toHaveBeenCalledWith('sub_own');
  });

  it('Q-2: our upgrade waiting on 3-D Secure → 409 upgrade_awaiting_confirmation with the amount and a fresh date; no secret', async () => {
    state.subscription = subscription({ pendingUpdate: { expiresAt: nowSeconds() + 3600, priceIds: [PRICE_TOP] } });
    const response = await previewPost({ tier: TOP });
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      success: false,
      error: PLAN_UPGRADE_REFUSALS.upgrade_awaiting_confirmation.message,
      code: 'upgrade_awaiting_confirmation',
      amountDueMinor: 2985,
      prorationDate: expect.any(Number),
    });
    expect(text).not.toContain(SECRET);
    expectSecretInNoLogOrAudit();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('another pending update → 409 upgrade_pending with retryAfter', async () => {
    const expiresAt = nowSeconds() + 3600;
    state.subscription = subscription({ pendingUpdate: { expiresAt, priceIds: [PRICE_LOWER] } });
    const response = await previewPost({ tier: TOP });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'upgrade_pending', retryAfter: new Date(expiresAt * 1000).toISOString() });
  });
});

describe('confirm — one answer per outcome, audited and flushed before the 200 (U-9, WC-7)', () => {
  it('upgraded → 200 { outcome: upgraded }; one audit entry with the facts, flushed before the response', async () => {
    const response = await confirmPost(confirmBody());
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'upgraded' } });
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(state.audits[0]).toMatchObject({
      action: 'BOS_BILLING_UPGRADE_REQUESTED',
      entityType: 'business_os_billing_account',
      entityId: USER,
      userId: USER,
      details: {
        fromTier: LOWER,
        toTier: TOP,
        lookupKey: PLAN_STRIPE_PRICES[TOP].lookupKey,
        outcome: 'upgraded',
        resumed: false,
        invoiceId: 'in_up',
        subscriptionId: 'sub_own',
        livemode: false,
        actor: 'owner',
        correlationId: expect.any(String),
      },
    });
    // The write named OUR row's subscription, the fresh item and the target price.
    expect(mockStripe.upgradeBusinessOsPlanSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub_own', itemId: 'si_own', priceId: PRICE_TOP })
    );
    // The audit comes after the write, the write after every DB read.
    expect(state.log.indexOf('stripe:update')).toBeLessThan(state.log.indexOf('audit:BOS_BILLING_UPGRADE_REQUESTED'));
    expect(state.log.filter((entry) => entry.startsWith('db:'))).toHaveLength(1);
    expect(state.log[0]).toMatch(/^db:/);
    expectSecretInNoLogOrAudit();
  });

  it('action_required → 200 with the clientSecret: the ONLY place the secret appears (V-1)', async () => {
    state.update = { ...PAID, pendingUpdate: true, pendingUpdateExpiresAt: nowSeconds() + 3600, invoiceStatus: 'open', paymentState: 'requires_action' };
    const response = await confirmPost(confirmBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'action_required', clientSecret: SECRET } });
    expect(state.flushed).toBe(true);
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'action_required', resumed: false } });
    expectSecretInNoLogOrAudit();
  });

  it('Q-2 resume → 200 action_required with the SAME secret, no new update, audited resumed (V-1 on the resume path)', async () => {
    state.subscription = subscription({ pendingUpdate: { expiresAt: nowSeconds() + 3600, priceIds: [PRICE_TOP] } });
    const response = await confirmPost(confirmBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'action_required', clientSecret: SECRET } });
    expect(mockStripe.upgradeBusinessOsPlanSubscription).not.toHaveBeenCalled();
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'action_required', resumed: true, invoiceId: 'in_last' } });
    expectSecretInNoLogOrAudit();
  });

  it('declined (returned shape) → 200 { outcome: declined, retryAfter }, audited', async () => {
    const expiresAt = nowSeconds() + 3600;
    state.update = { ...PAID, pendingUpdate: true, pendingUpdateExpiresAt: expiresAt, invoiceStatus: 'open', paymentState: 'requires_payment_method' };
    const response = await confirmPost(confirmBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'declined', retryAfter: new Date(expiresAt * 1000).toISOString() } });
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'declined' } });
  });

  it('declined (thrown card error) → 200 { outcome: declined }, audited; the error is not logged', async () => {
    state.update = Object.assign(new Error('declined'), { type: 'StripeCardError', payment_intent: { client_secret: SECRET } });
    const response = await confirmPost(confirmBody());
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'declined' } });
    expect(state.audits).toHaveLength(1);
    expectSecretInNoLogOrAudit();
  });

  it('processing → 200 { outcome: processing }, audited (V-4)', async () => {
    state.update = { ...PAID, pendingUpdate: true, invoiceStatus: 'open', paymentState: 'processing' };
    const response = await confirmPost(confirmBody());
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'processing' } });
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'processing' } });
  });

  it('V-3: the write answered with a connection error → 502 stripe_error + outcomeUnknown, audited as unknown, flushed first', async () => {
    state.update = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    const response = await confirmPost(confirmBody());
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      success: false,
      error: PLAN_UPGRADE_REFUSALS.stripe_error.message,
      code: 'stripe_error',
      outcomeUnknown: true,
    });
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'unknown', invoiceId: null } });
  });

  it('SA F-1: the write succeeds, the payment read AFTER it fails → 502 outcomeUnknown, audited unknown, alert logged, secret nowhere', async () => {
    // The REAL StripeService method over a hand-built Stripe client: the update
    // answers a pending update with an open invoice (carrying the secret), and
    // the follow-up invoicePayments read rejects with an invalid-request error
    // (a class the orchestration would read as "refused before running").
    const { StripeService: RealStripeService } = jest.requireActual('@/lib/stripe/StripeService') as typeof import('@/lib/stripe/StripeService');
    const real = new RealStripeService('sk_test_unit');
    const fakeClient = {
      subscriptions: {
        update: jest.fn(async () => ({
          id: 'sub_own',
          livemode: false,
          pending_update: { expires_at: nowSeconds() + 3600, subscription_items: [{ price: { id: PRICE_TOP } }] },
          latest_invoice: { id: 'in_up', status: 'open', confirmation_secret: { client_secret: SECRET, type: 'payment_intent' } },
        })),
      },
      invoicePayments: {
        list: jest.fn(async () => {
          throw Object.assign(new Error(`bad expand ${SECRET}`), {
            name: 'StripeInvalidRequestError',
            type: 'StripeInvalidRequestError',
            code: 'parameter_invalid',
            statusCode: 400,
            requestId: 'req_f1_route',
            raw: { client_secret: SECRET },
          });
        }),
      },
    };
    (real as unknown as { stripe: unknown }).stripe = fakeClient;
    mockStripe.upgradeBusinessOsPlanSubscription.mockImplementationOnce(async (params?: unknown) => {
      state.log.push('stripe:update');
      return real.upgradeBusinessOsPlanSubscription(params as Parameters<typeof real.upgradeBusinessOsPlanSubscription>[0]) as never;
    });

    const response = await confirmPost(confirmBody());
    expect(fakeClient.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(fakeClient.invoicePayments.list).toHaveBeenCalledTimes(1);
    expect(state.flushed).toBe(true);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      error: PLAN_UPGRADE_REFUSALS.stripe_error.message,
      code: 'stripe_error',
      outcomeUnknown: true,
    });
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({ details: { outcome: 'unknown', invoiceId: 'in_up' } });
    const lines = state.logLines as unknown[][];
    const alerted = lines.filter(([level, ctx]) => {
      const c = ctx as Record<string, unknown> | undefined;
      return level === 'error' && c?.alert === true && c?.reason === 'outcome_unknown';
    });
    expect(alerted).toHaveLength(1);
    expect(alerted[0][1]).toMatchObject({ code: 'stripe_error', paymentState: 'none' });
    const readFailed = lines.find(([, ctx]) => (ctx as Record<string, unknown> | undefined)?.event === 'bos_billing_upgrade_payment_read_failed');
    expect(readFailed?.[1]).toMatchObject({ stripeError: { type: 'StripeInvalidRequestError', code: 'parameter_invalid', requestId: 'req_f1_route' } });
    expectSecretInNoLogOrAudit();
  });

  it.each([
    ['StripeIdempotencyError'],
    ['StripeInvalidRequestError'],
  ])('double click: the in-flight conflict as %s → 409 upgrade_busy, a refusal: NOT audited (SA F-2)', async (type) => {
    state.update = Object.assign(new Error('in use'), { type, code: 'idempotency_key_in_use' });
    const response = await confirmPost(confirmBody());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('upgrade_busy');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('two identical confirms send identical write params (the same idempotency key)', async () => {
    const body = confirmBody();
    await confirmPost(body);
    await confirmPost(body);
    const [first, second] = mockStripe.upgradeBusinessOsPlanSubscription.mock.calls as unknown[][];
    expect(first).toEqual(second);
  });
});

describe('confirm — every refusal: status + English, never audited', () => {
  const cases: Array<[string, () => void, string, Record<string, unknown>?]> = [
    ['prices switch off', () => { process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'false'; }, 'upgrade_unavailable'],
    ['key mode unknown', () => { process.env.STRIPE_SECRET_KEY = 'not_a_key'; }, 'upgrade_unavailable'],
    ['billing row unreadable', () => { state.row = 'error'; }, 'billing_row_unreadable'],
    ['no billing row', () => { state.row = null; }, 'not_subscribed'],
    ['record past_due', () => { state.row = billingRow({ subscriptionStatus: 'past_due' }); }, 'subscription_not_active'],
    ['record cancelling', () => { state.row = billingRow({ cancelAtPeriodEnd: true }); }, 'subscription_cancelling'],
    ['top tier', () => { state.row = billingRow({ boughtTier: TOP }); }, 'not_an_upgrade'],
    ['target not on sale', () => { mutablePresentation[TOP].availableToBuy = false; }, 'price_unavailable'],
    ['Stripe status past_due', () => { state.subscription = subscription({ status: 'past_due' }); }, 'subscription_not_active'],
    ['Stripe cancelling', () => { state.subscription = subscription({ cancelAtPeriodEnd: true }); }, 'subscription_cancelling'],
    ['another pending update', () => { state.subscription = subscription({ pendingUpdate: { expiresAt: nowSeconds() + 60, priceIds: [PRICE_LOWER] } }); }, 'upgrade_pending'],
    ['Stripe already on the higher tier (V-2)', () => { state.subscription = subscription({ items: [{ id: 'si_own', priceId: PRICE_TOP, currentPeriodStart: 1, currentPeriodEnd: null }] }); }, 'upgrade_processing'],
    ['customer mismatch', () => { state.subscription = subscription({ customerId: 'cus_other' }); }, 'billing_record_mismatch'],
    ['two items', () => { state.subscription = subscription({ items: [{ id: 'a', priceId: PRICE_LOWER, currentPeriodStart: 1, currentPeriodEnd: null }, { id: 'b', priceId: PRICE_LOWER, currentPeriodStart: 1, currentPeriodEnd: null }] }); }, 'billing_record_mismatch'],
  ];

  it.each(cases)('%s → %s', async (_label, arrange, code) => {
    arrange();
    const response = await confirmPost(confirmBody());
    expect(response.status).toBe(PLAN_UPGRADE_REFUSALS[code as keyof typeof PLAN_UPGRADE_REFUSALS].status);
    expect(await response.json()).toMatchObject({
      success: false,
      error: PLAN_UPGRADE_REFUSALS[code as keyof typeof PLAN_UPGRADE_REFUSALS].message,
      code,
    });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockStripe.upgradeBusinessOsPlanSubscription).not.toHaveBeenCalled();
  });

  it('a stale preview → 409 preview_expired with no Stripe call', async () => {
    const response = await confirmPost(confirmBody({ prorationDate: nowSeconds() - 16 * 60 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('preview_expired');
    expect(stripeCalls()).toEqual([]);
  });
});
