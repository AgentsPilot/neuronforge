/**
 * POST /api/business-os/billing/plan/cancel — P-7a.4: cancel during a failed
 * payment ends the plan now (workplan §4.3; BQ-3 = A; SA C-11, TQ-12).
 *
 * Through the REAL route and the REAL orchestration; the session, the billing
 * repository, Stripe and the audit flush are fakes writing one ordered log.
 *
 *   - Stripe past_due → 200 `{ outcome: 'cancelled', endsOn, mode: 'immediate' }`;
 *     the open invoice is voided before the response; ONE audit
 *     `BOS_BILLING_SUBSCRIPTION_CANCELLED` with `details.mode = 'immediate'`,
 *     the void counts and the reason code, flushed before the response;
 *   - a void that fails: still 200 (the plan ended), audited `invoicesLeftOpen: 1`;
 *   - already ended at Stripe → 200 `unchanged` / `ended`, not audited;
 *   - a row Stripe already cured → the period-end answer (no `mode`).
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW_UNIX = Math.floor(Date.now() / 1000);
const PERIOD_END = NOW_UNIX + 86400 * 30;

const state: {
  log: string[];
  audits: Array<Record<string, unknown>>;
  flushed: boolean;
  row: Record<string, unknown>;
  subscription: Record<string, unknown>;
  voidFails: boolean;
} = { log: [], audits: [], flushed: false, row: {}, subscription: {}, voidFails: false };

jest.mock('@/lib/auth', () => ({ getUser: async () => ({ id: USER, email: 'owner@example.com' }) }));
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
    findByUser: async () => {
      state.log.push('db:findByUser');
      return { data: state.row, error: null };
    },
    mirrorSubscriptionState: async (input: { status: string }) => {
      state.log.push(`db:mirror:${input.status}`);
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
    return { id: 'sub_own', status: 'active', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: value, cancelAt: value ? PERIOD_END : null, endedAt: null, currentPeriodEnd: PERIOD_END };
  }),
  cancelBusinessOsSubscriptionNow: jest.fn(async (id: string) => {
    state.log.push(`stripe:cancel_now:${id}`);
    return { id: 'sub_own', status: 'canceled', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: false, cancelAt: null, endedAt: NOW_UNIX, currentPeriodEnd: PERIOD_END };
  }),
  listBusinessOsOpenSubscriptionInvoices: jest.fn(async (id: string) => {
    state.log.push(`stripe:list_open:${id}`);
    return { invoices: [{ id: 'in_open', status: 'open', customerId: 'cus_own', subscriptionId: 'sub_own', livemode: false }], hasMore: false };
  }),
  voidBusinessOsInvoice: jest.fn(async (id: string) => {
    state.log.push(`stripe:void:${id}`);
    if (state.voidFails) throw Object.assign(new Error('x'), { type: 'StripeAPIError' });
    return { id, status: 'void' };
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

const mockLogAndFlush = jest.fn(async (entry: Record<string, unknown>) => {
  state.log.push(`audit:${String(entry.action)}`);
  state.audits.push(entry);
  await new Promise((resolve) => setTimeout(resolve, 15));
  state.flushed = true;
});
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...(args as [Record<string, unknown>])),
}));

import { POST as CANCEL } from '@/app/api/business-os/billing/plan/cancel/route';

function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'past_due',
    boughtTier: 'tier_one',
    currentPeriodEnd: new Date((NOW_UNIX - 86400) * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    endedAt: null,
    failedAttempts: 1,
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_own',
    status: 'past_due',
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
    latestInvoiceId: 'in_open',
    ...overrides,
  };
}

const cancelPost = (body: unknown) =>
  CANCEL(new NextRequest('https://example.test/api/business-os/billing/plan/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const ENV = ['BUSINESS_OS_PLAN_PRICES_ENABLED', 'STRIPE_SECRET_KEY'] as const;
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
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  state.log = [];
  state.audits = [];
  state.flushed = false;
  state.row = billingRow();
  state.subscription = subscription();
  state.voidFails = false;
  mockLogAndFlush.mockClear();
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe('P-7a.4 cancel route: a failed renewal ends the plan now', () => {
  it('past_due at Stripe → 200 immediate; void before the response; one audit with mode immediate, flushed first', async () => {
    const response = await cancelPost({ reasonCode: 'too_expensive' });
    expect(response.status).toBe(200);
    const endsOn = new Date(NOW_UNIX * 1000).toISOString();
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn, mode: 'immediate' } });
    expect(state.flushed).toBe(true);
    expect(state.log).toEqual([
      'db:findByUser',
      'stripe:retrieve:sub_own',
      'stripe:cancel_now:sub_own',
      'stripe:list_open:sub_own',
      'stripe:void:in_open',
      'db:mirror:canceled',
      'audit:BOS_BILLING_SUBSCRIPTION_CANCELLED',
    ]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: 'BOS_BILLING_SUBSCRIPTION_CANCELLED',
      entityType: 'business_os_billing_account',
      entityId: USER,
      userId: USER,
      details: {
        subscriptionId: 'sub_own',
        outcome: 'cancelled',
        endsOn,
        mode: 'immediate',
        invoicesVoided: 1,
        invoicesLeftOpen: 0,
        livemode: false,
        reasonCode: 'too_expensive',
        actor: 'owner',
      },
    });
    expect(mockStripe.setBusinessOsCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('a void that fails → still 200 (the plan ended); audited with invoicesLeftOpen 1', async () => {
    state.voidFails = true;
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ outcome: 'cancelled', mode: 'immediate' });
    expect(state.audits[0]).toMatchObject({ details: { mode: 'immediate', invoicesVoided: 0, invoicesLeftOpen: 1, reasonCode: null } });
  });

  it('already ended at Stripe → 200 unchanged / ended, nothing written at Stripe, not audited', async () => {
    state.subscription = subscription({ status: 'canceled', endedAt: NOW_UNIX - 60 });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'ended', date: new Date((NOW_UNIX - 60) * 1000).toISOString() } });
    expect(state.log.filter((e) => e.startsWith('stripe:'))).toEqual(['stripe:retrieve:sub_own']);
    expect(state.audits).toEqual([]);
  });

  it('QA E-1 (TL ruling): our record already shows the end → 200 unchanged / ended from the row; no Stripe call, no write, no audit', async () => {
    const endedIso = new Date((NOW_UNIX - 3600) * 1000).toISOString();
    state.row = billingRow({ subscriptionStatus: 'canceled', endedAt: endedIso });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'unchanged', state: 'ended', date: endedIso } });
    expect(state.log).toEqual(['db:findByUser']);
    expect(state.audits).toEqual([]);
  });

  it('QA E-2 (TL ruling): the failed-payment refusal never says "contact us to cancel"', async () => {
    const { PLAN_MANAGE_REFUSALS } = jest.requireActual('@/lib/business-os/billing/planSubscriptionManage') as typeof import('@/lib/business-os/billing/planSubscriptionManage');
    const { en } = jest.requireActual('@/lib/business-os/translations/en') as { en: Record<string, string> };
    expect(PLAN_MANAGE_REFUSALS.payment_failed_contact_us.message).toBe(en['plan.manage.refusal.payment_failed']);
    expect(PLAN_MANAGE_REFUSALS.payment_failed_contact_us.message).not.toMatch(/contact us/i);
  });

  it('a failing row that Stripe already cured → the period-end answer (no `mode`), audited period_end without void counts', async () => {
    state.subscription = subscription({ status: 'active' });
    const response = await cancelPost({});
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ outcome: 'cancelled', endsOn: new Date(PERIOD_END * 1000).toISOString() });
    expect(state.audits[0]).toMatchObject({ details: { mode: 'period_end' } });
    const details = state.audits[0].details as Record<string, unknown>;
    expect(details).not.toHaveProperty('invoicesVoided');
    expect(details).not.toHaveProperty('invoicesLeftOpen');
    expect(mockStripe.cancelBusinessOsSubscriptionNow).not.toHaveBeenCalled();
  });
});
