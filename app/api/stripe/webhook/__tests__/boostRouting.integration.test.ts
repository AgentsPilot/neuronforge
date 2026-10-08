/**
 * Credits boost slice 4a, through the real webhook route and the real P-1
 * dispatcher (workplan §6; SA C-1, C-2, C-3; HP-1, HP-3, HP-4).
 *
 * The route, the dispatcher, the plan and boost resolvers and the boost handler
 * all run for real. Mocked: signature verification (the event is handed in),
 * the Supabase client (claims and every other table), the boost purchase
 * repository (its webhook methods), the bounded audit flush and the Business OS
 * Stripe client (the receipt read). No Stripe call and no database.
 */

import { NextRequest } from 'next/server';

import {
  ACCOUNT,
  INTENT,
  LOT,
  PURCHASE,
  SESSION,
  boostEvent,
  purchaseRow,
} from '@/lib/business-os/boost/__fixtures__/boostWebhookFixtures';

type Answer = { data: unknown; error: unknown };

const mockEffects: Array<Record<string, unknown>> = [];
const mockLogLines: Array<{ level: string; ctx: unknown; msg: unknown }> = [];
let mockEvent: unknown = null;
let mockDb: Record<string, Answer> = {};
const mockBoost = {
  bySession: null as unknown,
  byId: null as unknown,
  lookupError: null as unknown,
  credit: null as unknown,
  transition: null as unknown,
  calls: [] as Array<[string, unknown]>,
};
const mockAudits: Array<Record<string, unknown>> = [];
const mockRetrieves: unknown[][] = [];

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const writeCall = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const operation = writeCall ? String(writeCall[0]) : 'select';
    mockEffects.push({ type: 'db', table, operation, chain: calls });
    return Promise.resolve(mockDb[`${table}:${operation}`] ?? { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => resolve().then(f, r);
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve();
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (ctx: unknown, msg?: unknown) => {
      mockLogLines.push({ level, ctx, msg });
    };
    const l: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal') };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return {
    ...actual,
    planPriceCatalog: {
      load: () => {
        mockEffects.push({ type: 'plan.catalog' });
        return Promise.resolve({ byPriceId: new Map([['price_basic', 'bos_basic_monthly']]), fromCache: false });
      },
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mockBuilder(t, []) }) }));
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => ({ constructWebhookEvent: () => mockEvent }) }));

jest.mock('@/lib/repositories/BusinessOsBoostPurchaseRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/BusinessOsBoostPurchaseRepository');
  const answer = (value: unknown) => (value instanceof Error ? { data: null, error: value } : value);
  return {
    ...actual,
    businessOsBoostPurchaseRepository: {
      findBySessionIdForWebhook: async (id: string) => {
        mockBoost.calls.push(['findBySessionIdForWebhook', id]);
        if (mockBoost.lookupError) return { data: null, error: mockBoost.lookupError };
        return { data: mockBoost.bySession, error: null };
      },
      findByIdForWebhook: async (id: string) => {
        mockBoost.calls.push(['findByIdForWebhook', id]);
        return { data: mockBoost.byId, error: null };
      },
      credit: async (input: unknown) => {
        mockBoost.calls.push(['credit', input]);
        return answer(mockBoost.credit) ?? { data: { outcome: 'credited', accountId: ACCOUNT, lotId: LOT }, error: null };
      },
      transition: async (input: unknown) => {
        mockBoost.calls.push(['transition', input]);
        return answer(mockBoost.transition) ?? { data: { status: 'transitioned', accountId: ACCOUNT, fromStatus: 'pending' }, error: null };
      },
      recordReceipt: async (input: unknown) => {
        mockBoost.calls.push(['recordReceipt', input]);
        return { data: { status: 'recorded', accountId: ACCOUNT }, error: null };
      },
    },
  };
});

jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: async (entry: Record<string, unknown>) => {
    mockAudits.push(entry);
    mockEffects.push({ type: 'audit', action: entry.action });
  },
}));

jest.mock('@/lib/business-os/billing/stripeClient', () => ({
  getBusinessOsStripeClient: () => ({
    paymentIntents: {
      retrieve: async (...args: unknown[]) => {
        mockRetrieves.push(args);
        return { id: INTENT, latest_charge: { id: 'ch_test_1', receipt_url: 'https://pay.stripe.com/receipts/x' } };
      },
    },
  }),
}));

jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: () => Promise.resolve('owner-a'),
}));
jest.mock('@/lib/payments/processorFee', () => ({ ...jest.requireActual('@/lib/payments/processorFee'), resolveProcessorFee: () => Promise.resolve(null) }));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve(null) }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({ bindPlanSubscription: () => Promise.resolve({}) }));
jest.mock('@/lib/payments/syncBookingPaymentState', () => ({ syncBookingsForTransactions: () => Promise.resolve() }));
jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  paymentPlanSubscriptionRepository: {
    findBySubscriptionId: () => Promise.resolve({ data: null, error: null }),
    recordPeriodPaid: () => Promise.resolve({ data: null, error: null }),
    recordFailure: () => Promise.resolve({ data: null, error: null }),
    close: () => Promise.resolve({ data: null, error: null }),
  },
}));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({ crmActivityRepository: { create: () => Promise.resolve({ data: null, error: null }) } }));
jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({ allocateQuotasForUser: () => Promise.resolve({ success: true }) })),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({
  pilotCreditsToTokens: (n: unknown) => {
    mockEffects.push({ type: 'pilotCreditsToTokens' });
    return Promise.resolve(Number(n) * 10);
  },
}));

async function run(event: unknown, db: Record<string, Answer> = {}) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  mockAudits.length = 0;
  mockRetrieves.length = 0;
  mockBoost.calls = [];
  mockDb = db;
  mockEvent = event;
  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per scenario
    POST = require('../route').POST;
  });
  const res = await POST(new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } }));
  await new Promise((r) => setImmediate(r));
  return { status: res.status, body: await res.json() };
}

const claimStatus = () => {
  const ups = mockEffects.filter((e) => e.type === 'db' && e.table === 'processed_webhook_events' && e.operation === 'update');
  const last = ups[ups.length - 1] as { chain: unknown[][] } | undefined;
  return (last?.chain[0][1] as { status?: string } | undefined)?.status;
};
const boostCalls = (name: string) => mockBoost.calls.filter(([n]) => n === name);
const legacyRan = () => mockEffects.some((e) => e.type === 'pilotCreditsToTokens');
const agentPlatformWrites = () =>
  mockEffects.filter((e) => e.type === 'db' && e.operation !== 'select' && ['user_subscriptions', 'credit_transactions'].includes(String(e.table)));

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_boost';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());
beforeEach(() => {
  mockBoost.bySession = purchaseRow();
  mockBoost.byId = null;
  mockBoost.lookupError = null;
  mockBoost.credit = null;
  mockBoost.transition = null;
});

describe('boost 4a through POST /api/stripe/webhook', () => {
  it('a paid boost checkout.session.completed → credited once, audited, receipt recorded, claim completed, 200; the legacy handler never runs', async () => {
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(boostCalls('credit')).toEqual([['credit', expect.objectContaining({ purchaseId: PURCHASE, sessionId: SESSION, paymentIntentId: INTENT })]]);
    expect(mockAudits.map((a) => a.action)).toEqual(['BOS_BOOST_CREDITED']);
    expect(mockAudits[0].userId).toBe(ACCOUNT);
    expect(mockRetrieves).toEqual([[INTENT, { expand: ['latest_charge'] }, { timeout: 5000, maxNetworkRetries: 0 }]]);
    expect(boostCalls('recordReceipt')).toHaveLength(1);
    expect(claimStatus()).toBe('completed');
    expect(legacyRan()).toBe(false);
    expect(agentPlatformWrites()).toEqual([]);
  });

  it('HP-1: a transient credit failure → 500, the claim released (failed), no audit, nothing else written', async () => {
    const { BoostRepositoryFailure } = jest.requireActual('@/lib/repositories/BusinessOsBoostPurchaseRepository');
    mockBoost.credit = new BoostRepositoryFailure('connection reset', '08006', false);
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: 'Webhook processing failed' });
    expect(claimStatus()).toBe('failed');
    expect(mockAudits).toEqual([]);
  });

  it('SA C-1: a deterministic credit failure (22023) → 200, completed, alerted and audited (never a 3-day retry loop)', async () => {
    const { BoostRepositoryFailure } = jest.requireActual('@/lib/repositories/BusinessOsBoostPurchaseRepository');
    mockBoost.credit = new BoostRepositoryFailure('out of range', '22023', true);
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expect(mockAudits.map((a) => a.action)).toEqual(['BOS_BOOST_FLAGGED']);
    expect(mockLogLines.some((l) => l.level === 'error' && (l.ctx as { alert?: boolean }).alert === true)).toBe(true);
  });

  it('a lookup failure in the resolver → 500 and released (SA Q-6), never a deny', async () => {
    const { BoostRepositoryFailure } = jest.requireActual('@/lib/repositories/BusinessOsBoostPurchaseRepository');
    mockBoost.lookupError = new BoostRepositoryFailure('timeout', null, false);
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result.status).toBe(500);
    expect(claimStatus()).toBe('failed');
  });

  it('the boost marker with no purchase row → denied metadata_mismatch with an alert, completed, nothing credited, no legacy handler', async () => {
    mockBoost.bySession = null;
    mockBoost.byId = null;
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result.status).toBe(200);
    const deny = mockLogLines.find((l) => (l.ctx as { event?: string })?.event === 'bos_billing_event_denied');
    expect(deny).toMatchObject({ level: 'error', ctx: { reason: 'metadata_mismatch', alert: true } });
    expect(boostCalls('credit')).toEqual([]);
    expect(legacyRan()).toBe(false);
    expect(claimStatus()).toBe('completed');
  });

  it('SA C-3 through the route: a paid session naming a purchase that holds ANOTHER session → no credit, alert, audit, 200', async () => {
    mockBoost.bySession = null;
    mockBoost.byId = purchaseRow({ stripeCheckoutSessionId: 'cs_test_the_real_one' });
    const result = await run(boostEvent('checkout.session.completed'));
    expect(result.status).toBe(200);
    expect(boostCalls('credit')).toEqual([]);
    expect(boostCalls('transition')).toEqual([]);
    expect(mockAudits.map((a) => (a.details as { reason?: string }).reason)).toEqual(['orphan_session_paid']);
  });

  it('expired → the row moves to expired; async failed → failed + audit', async () => {
    await run(boostEvent('checkout.session.expired', { payment_status: 'unpaid', payment_intent: null }));
    expect(boostCalls('transition')).toEqual([['transition', { purchaseId: PURCHASE, toStatus: 'expired', paymentIntentId: null }]]);
    await run(boostEvent('checkout.session.async_payment_failed', { payment_status: 'unpaid' }));
    expect(boostCalls('transition')).toEqual([['transition', { purchaseId: PURCHASE, toStatus: 'failed', paymentIntentId: INTENT }]]);
    expect(mockAudits.map((a) => a.action)).toEqual(['BOS_BOOST_PAYMENT_FAILED']);
  });

  it('HP-4: a Connect checkout.session.completed carrying the boost marker never reaches the boost resolver', async () => {
    const event = boostEvent('checkout.session.completed', {}, { account: 'acct_connect_1' });
    await run(event);
    expect(mockBoost.calls).toEqual([]);
    expect(mockAudits).toEqual([]);
  });

  it('an agent-platform boost pack (no row, no marker) still takes the legacy path, after one keyed boost read', async () => {
    mockBoost.bySession = null;
    const pack = boostEvent('checkout.session.completed', {
      id: 'cs_platform_pack',
      client_reference_id: null,
      metadata: { user_id: 'user-1', purchase_type: 'boost_pack', credits: '1000', boost_pack_id: 'p1' },
    });
    const result = await run(pack);
    expect(result.status).toBe(200);
    expect(mockBoost.calls).toEqual([['findBySessionIdForWebhook', 'cs_platform_pack']]);
    expect(legacyRan()).toBe(true);
  });

  it('a plan invoice.paid is unaffected: the boost resolver reads nothing, the plan flow is recognised (no handler until P-3b.2 → released, as before)', async () => {
    const invoice = {
      id: 'evt_plan',
      type: 'invoice.paid',
      livemode: false,
      data: {
        object: {
          id: 'in_1',
          object: 'invoice',
          amount_paid: 7900,
          metadata: {},
          lines: { has_more: false, data: [{ id: 'il_1', pricing: { price_details: { price: 'price_basic' } } }] },
        },
      },
    };
    const result = await run(invoice);
    expect(mockBoost.calls).toEqual([]);
    expect(result.status).toBe(500);
    expect(mockLogLines.some((l) => (l.ctx as { event?: string })?.event === 'bos_billing_plan_unhandled')).toBe(true);
  });

  it('a replayed, already-completed event short-circuits before any boost read', async () => {
    const result = await run(boostEvent('checkout.session.completed'), {
      'processed_webhook_events:select': { data: { event_id: 'evt_x', status: 'completed' }, error: null },
    });
    expect(result.body).toEqual({ received: true, duplicate: true });
    expect(mockBoost.calls).toEqual([]);
  });
});
