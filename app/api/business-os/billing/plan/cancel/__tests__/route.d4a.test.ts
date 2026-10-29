/**
 * The plan cancel / keep emails through the REAL routes (account deletion
 * lifecycle D4a / SX-3; workplan §3.3, §8 rows 4 and 5; SA S-6, S-9, S-11,
 * DR-6, DR-7; user U-2).
 *
 * The REAL cancel and reactivate routes, the REAL orchestration, the REAL
 * composer and its REAL production wiring. Only the edges are fakes: the
 * session, the billing repository, Stripe, the audit flush, the transport,
 * the identity / language / timezone repositories and the plan-ending view.
 * Every call lands in one ordered log.
 *
 *   - switch on: `cancelled` → one "Plan cancelled" send, AFTER the action's
 *     audit flush; P-7a.4 immediate → "Your plan has ended"; `reactivated` →
 *     "Your plan continues"; each audited SENT;
 *   - switch off: the routes behave exactly as before (no extra read or audit);
 *   - a failed or throwing send: still 200, the same body, audited NOT_SENT;
 *   - sender missing with the switch on: NOT_SENT `sender_not_configured`;
 *   - `unchanged`, a refusal, a lost answer, 401, 400: no send.
 */

import { NextRequest } from 'next/server';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner@example.com';
const NOW_UNIX = Math.floor(Date.now() / 1000);
// Relative to the real clock: the routes use it, and a fixed date would rot into "period over".
const PERIOD_END = NOW_UNIX + 86400 * 30;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

const state: {
  user: { id: string; email?: string } | null;
  log: string[];
  audits: Array<Record<string, unknown>>;
  row: Record<string, unknown>;
  subscription: Record<string, unknown>;
  write: Error | null;
  sender: string | undefined;
  send: 'ok' | 'refused' | 'throws';
  sent: Array<Record<string, unknown>>;
} = { user: null, log: [], audits: [], row: {}, subscription: {}, write: null, sender: undefined, send: 'ok', sent: [] };

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
    findByUser: async () => {
      state.log.push('db:findByUser');
      return { data: state.row, error: null };
    },
    mirrorSubscriptionState: async () => {
      state.log.push('db:mirror');
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
    if (state.write) throw state.write;
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
    return { id, status: 'void' };
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: async (entry: Record<string, unknown>) => {
    state.log.push(`audit:${String(entry.action)}`);
    state.audits.push(entry);
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  platformSenderAddress: () => state.sender,
  sendEmail: async (params: Record<string, unknown>) => {
    state.log.push('email:send');
    state.sent.push(params);
    if (state.send === 'throws') throw new Error('transport exploded');
    return state.send === 'ok' ? { sent: true, provider: 'resend' } : { sent: false, provider: 'none', error: 'refused' };
  },
}));

jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: {
    findUserIdentity: async (id: string) => {
      state.log.push(`identity:${id}`);
      return { data: { id, email: OWNER, createdAt: null }, error: null };
    },
  },
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    findLanguage: async () => ({ data: null, error: null }),
  },
}));
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: {
    findPreferredLanguage: async () => ({ data: null, error: null }),
    findTimezone: async () => ({ data: 'UTC', error: null }),
  },
}));
jest.mock('@/lib/business-os/entitlements/planEndingView', () => ({
  readPlanEndingView: async (input: { endsAt: string }) => {
    state.log.push('view');
    return { kind: 'unknown', endsAt: input.endsAt };
  },
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
const cancelPost = (body: unknown = {}, raw?: string) => CANCEL(post('/api/business-os/billing/plan/cancel', body, raw));
const reactivatePost = (body: unknown = {}, raw?: string) => REACTIVATE(post('/api/business-os/billing/plan/reactivate', body, raw));
const emailAudits = () => state.audits.filter((entry) => String(entry.action).startsWith('BOS_PLAN_CANCEL_EMAIL_'));

const ENV = ['BUSINESS_OS_PLAN_PRICES_ENABLED', 'BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED', 'STRIPE_SECRET_KEY'] as const;
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
  process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  state.user = { id: USER, email: OWNER };
  state.log = [];
  state.audits = [];
  state.row = billingRow();
  state.subscription = subscription();
  state.write = null;
  state.sender = 'notifications@agentspilot.ai';
  state.send = 'ok';
  state.sent = [];
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

describe('cancel → "Plan cancelled" (switch on)', () => {
  it('happy path: one send to the live address, AFTER the action audit; audited SENT; the body is unchanged', async () => {
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: PERIOD_END_ISO } });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ kind: 'transactional', to: [OWNER], subject: 'Your plan is cancelled', redactRecipientInLogs: true });
    // S-11: the action is audited first, then the email, then its own audit.
    const order = state.log.filter((entry) => entry.startsWith('audit:') || entry === 'email:send');
    expect(order).toEqual(['audit:BOS_BILLING_SUBSCRIPTION_CANCELLED', 'email:send', 'audit:BOS_PLAN_CANCEL_EMAIL_SENT']);
    expect(emailAudits()[0]).toMatchObject({
      entityType: 'business_os_billing_account',
      entityId: USER,
      userId: USER,
      details: { email: 'cancelled', outcome: 'sent', subscriptionId: 'sub_own', periodEnd: PERIOD_END_ISO, livemode: false, actor: 'owner' },
    });
    expect(JSON.stringify(state.audits)).not.toContain(OWNER);
  });

  it('U-2 / P-7a.4: a cancel during a failed payment → "Your plan has ended", ended on (DR-7)', async () => {
    state.row = billingRow({ subscriptionStatus: 'past_due', failedAttempts: 1, currentPeriodEnd: new Date((NOW_UNIX - 86400) * 1000).toISOString() });
    state.subscription = subscription({ status: 'past_due', latestInvoiceId: 'in_open' });
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ outcome: 'cancelled', mode: 'immediate' });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].subject).toBe('Your plan has ended');
    expect(String(state.sent[0].text)).toContain('Your plan ended on');
    // The open invoice was voided and none is left open: the sentence may be written.
    expect(String(state.sent[0].text)).toContain('Any unpaid invoice for it was cancelled, and you will not be charged again.');
    expect(emailAudits()[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_SENT', details: { email: 'ended_now' } });
  });

  it('the send is refused → still 200 with the same body; audited NOT_SENT transport_failed', async () => {
    state.send = 'refused';
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'cancelled', endsOn: PERIOD_END_ISO } });
    expect(emailAudits()).toEqual([expect.objectContaining({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: expect.objectContaining({ reason: 'transport_failed' }) })]);
  });

  it('the transport throws → still 200, never a 500', async () => {
    state.send = 'throws';
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('cancelled');
    expect(emailAudits()[0]).toMatchObject({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT' });
  });

  it('switch on, sender missing → nothing sent, NOT_SENT sender_not_configured, still 200', async () => {
    state.sender = undefined;
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(state.log).not.toContain(`identity:${USER}`);
    expect(emailAudits()).toEqual([
      expect.objectContaining({ action: 'BOS_PLAN_CANCEL_EMAIL_NOT_SENT', details: expect.objectContaining({ reason: 'sender_not_configured' }) }),
    ]);
  });

  it('switch off → exactly the P-7a behaviour: no email read, send or audit', async () => {
    process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'false';
    const response = await cancelPost();
    expect(response.status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
    expect(state.log).toEqual(['db:findByUser', 'stripe:retrieve:sub_own', 'stripe:update:sub_own:true', 'db:mirror', 'audit:BOS_BILLING_SUBSCRIPTION_CANCELLED']);
  });

  it('already cancelling (unchanged) → no email', async () => {
    state.row = billingRow({ cancelAtPeriodEnd: true });
    state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
    const response = await cancelPost();
    expect((await response.json()).data.outcome).toBe('unchanged');
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('a refusal (no subscription) → no email', async () => {
    state.row = billingRow({ stripeSubscriptionId: null, subscriptionStatus: null });
    expect((await cancelPost()).status).toBe(409);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('a lost Stripe answer (outcomeUnknown) → no email', async () => {
    state.write = Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    expect((await cancelPost()).status).toBe(502);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('signed out (401) → no email', async () => {
    state.user = null;
    expect((await cancelPost()).status).toBe(401);
    expect(state.sent).toEqual([]);
    expect(state.log).toEqual([]);
  });

  it.each([
    ['an injected userId', { userId: '99999999-9999-4999-8999-999999999999' }, undefined],
    ['unparsable JSON', null, '{not json'],
  ])('invalid input (400: %s) → no email', async (_label, body, raw) => {
    expect((await cancelPost(body, raw)).status).toBe(400);
    expect(state.sent).toEqual([]);
    expect(state.log).toEqual([]);
  });
});

describe('reactivate → "Plan kept" (switch on)', () => {
  beforeEach(() => {
    state.row = billingRow({ cancelAtPeriodEnd: true });
    state.subscription = subscription({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END });
  });

  it('happy path: one "Your plan continues" send after the action audit; no view read; audited SENT', async () => {
    const response = await reactivatePost();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { outcome: 'reactivated', renewsOn: PERIOD_END_ISO } });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ to: [OWNER], subject: 'Your plan continues' });
    expect(state.log).not.toContain('view');
    const order = state.log.filter((entry) => entry.startsWith('audit:') || entry === 'email:send');
    expect(order).toEqual(['audit:BOS_BILLING_SUBSCRIPTION_REACTIVATED', 'email:send', 'audit:BOS_PLAN_CANCEL_EMAIL_SENT']);
    expect(emailAudits()[0]).toMatchObject({ details: { email: 'kept', outcome: 'sent', periodEnd: PERIOD_END_ISO } });
  });

  it('not cancelling at Stripe (unchanged) → no email', async () => {
    state.subscription = subscription();
    expect((await (await reactivatePost()).json()).data.outcome).toBe('unchanged');
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('the send throws → still 200 reactivated', async () => {
    state.send = 'throws';
    const response = await reactivatePost();
    expect(response.status).toBe(200);
    expect((await response.json()).data.outcome).toBe('reactivated');
  });

  it('switch off → no email', async () => {
    process.env.BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED = 'false';
    expect((await reactivatePost()).status).toBe(200);
    expect(state.sent).toEqual([]);
    expect(emailAudits()).toEqual([]);
  });

  it('401 and 400 → no email', async () => {
    expect((await reactivatePost({ reasonCode: 'too_expensive' })).status).toBe(400);
    state.user = null;
    expect((await reactivatePost()).status).toBe(401);
    expect(state.sent).toEqual([]);
  });
});
