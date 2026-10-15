/**
 * Plan payments P-3b.2, SA code review F-2: the REGISTERED `plan` handler,
 * driven through the real webhook `POST`, on its RETURN path.
 *
 * The CF-5 characterisation harness only shows the handler's throw path (P3,
 * ids that are not Stripe-shaped → released, 500). This file is this slice's
 * own: it adds no snapshot and edits nothing in the harness.
 *
 * Real: the route, the dispatcher, the plan resolver, the plan handler, the
 * apply use case, and BOTH billing repositories (on a recording Supabase
 * client). Mocked: Supabase itself, signature verification, the price catalog
 * (it knows one plan price), and the side services the route imports.
 *
 * Scenario: a recognised plan `invoice.paid` with Stripe-shaped ids whose
 * subscription and customer are on no billing record → one `mismatch_refused`
 * money-history row with `refusal_reason = 'unknown_customer'` and NO account,
 * an alert, the claim COMPLETED and a 200. No apply call, no plan write.
 */

import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown; count?: number | null };

const mockEffects: Array<{ table: string; operation: string; terminal: string; chain: unknown[][] }> = [];
const mockLogLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
let mockDb: Record<string, Answer> = {};
let mockEvent: unknown = null;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = (terminal: string) => {
    const writeCall = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const operation = writeCall ? String(writeCall[0]) : 'select';
    mockEffects.push({ table, operation, terminal, chain: calls });
    return Promise.resolve(mockDb[`${table}:${operation}`] ?? { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => resolve('await').then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve(String(prop));
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (ctx: unknown) => {
      mockLogLines.push({ level, ctx: (ctx ?? {}) as Record<string, unknown> });
    };
    const l: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
    };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

// The catalog knows the fixture's price under a REAL plan lookup key.
jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return {
    ...actual,
    planPriceCatalog: {
      load: () => Promise.resolve({ byPriceId: new Map([['price_1PlanA', actual.BOS_PLAN_LOOKUP_KEYS[0]]]), fromCache: false }),
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mockBuilder(t, []) }) }));
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

// Signature verification only. Any Stripe read the handler attempted would be
// a TypeError here: the unknown-customer path must make none.
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({ constructWebhookEvent: () => mockEvent }),
}));

jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve(null) }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({ bindPlanSubscription: () => Promise.resolve({}) }));
jest.mock('@/lib/payments/syncBookingPaymentState', () => ({ syncBookingsForTransactions: () => Promise.resolve() }));
jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({ paymentPlanSubscriptionRepository: {} }));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({ crmActivityRepository: {} }));
jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({ QuotaAllocationService: jest.fn() }));
jest.mock('@/lib/utils/pricingConfig', () => ({ pilotCreditsToTokens: () => Promise.resolve(0) }));

const EVENT_ROW_ID = '55555555-5555-4555-8555-555555555555';

/** A recognised plan invoice.paid, Basil-shaped, with Stripe-shaped (alphanumeric) ids. */
function paidPlanInvoice(): Record<string, unknown> {
  return {
    id: 'evt_1RouteF2',
    object: 'event',
    api_version: '2025-10-29.clover',
    type: 'invoice.paid',
    livemode: false,
    created: 1790000100,
    data: {
      object: {
        id: 'in_1RouteF2',
        object: 'invoice',
        customer: 'cus_RouteF2',
        currency: 'usd',
        amount_paid: 2000,
        amount_due: 2000,
        billing_reason: 'subscription_create',
        discounts: [],
        total_taxes: [],
        status_transitions: { paid_at: 1790000070 },
        livemode: false,
        metadata: {},
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_RouteF2', metadata: {} } },
        lines: {
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'il_1RouteF2',
              amount: 2000,
              period: { start: 1790000000, end: 1792592000 },
              pricing: { type: 'price_details', price_details: { price: 'price_1PlanA' } },
            },
          ],
        },
      },
    },
  };
}

async function run(event: unknown) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  mockEvent = event;
  mockDb = {
    // The money-history insert returns its new row id.
    'business_os_billing_events:insert': { data: { id: EVENT_ROW_ID }, error: null },
  };
  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per run (owner cache)
    POST = require('../route').POST;
  });
  const res = await POST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 't=1,v1=x' },
    })
  );
  await new Promise((r) => setImmediate(r));
  return { status: res.status, body: await res.json() };
}

const effectsOn = (table: string) => mockEffects.filter((e) => e.table === table);
const claimUpdates = () =>
  effectsOn('processed_webhook_events')
    .filter((e) => e.operation === 'update')
    .map((e) => (e.chain[0][1] as { status?: string }).status);

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_route_f2';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('P-3b.2 F-2: the registered plan handler through the webhook route, return path', () => {
  it('unknown customer: one refusal row with no account, alert, claim COMPLETED, 200', async () => {
    const r = await run(paidPlanInvoice());

    expect(r).toEqual({ status: 200, body: { received: true } });
    expect(claimUpdates()).toEqual(['completed']);

    // The router sent it to the plan flow; nothing was denied.
    expect(mockLogLines.filter((l) => l.ctx.event === 'bos_billing_event_denied')).toEqual([]);

    // The account is looked up by subscription, then by customer, in test mode: neither exists.
    const lookups = effectsOn('business_os_billing_accounts');
    expect(lookups.map((e) => [e.operation, e.terminal])).toEqual([
      ['select', 'maybeSingle'],
      ['select', 'maybeSingle'],
    ]);
    expect(lookups[0].chain).toContainEqual(['eq', 'stripe_subscription_id', 'sub_RouteF2']);
    expect(lookups[1].chain).toContainEqual(['eq', 'stripe_customer_id', 'cus_RouteF2']);
    for (const lookup of lookups) expect(lookup.chain).toContainEqual(['eq', 'livemode', false]);

    // Exactly one money-history row: the refusal, with the money recorded and NO account.
    const inserts = effectsOn('business_os_billing_events');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].operation).toBe('insert');
    expect(inserts[0].chain[0][1]).toEqual({
      user_id: null,
      livemode: false,
      kind: 'mismatch_refused',
      stripe_event_id: 'evt_1RouteF2',
      stripe_invoice_id: 'in_1RouteF2',
      stripe_subscription_id: 'sub_RouteF2',
      stripe_customer_id: 'cus_RouteF2',
      tier: expect.any(String),
      refusal_reason: 'unknown_customer',
      amount_minor: 2000,
      amount_tax_minor: 0,
      currency: 'usd',
      period_start: new Date(1790000000 * 1000).toISOString(),
      period_end: new Date(1792592000 * 1000).toISOString(),
      paid_at: new Date(1790000070 * 1000).toISOString(),
    });

    // No apply, no plan write, no billing write.
    expect(effectsOn('business_os_account_plans')).toEqual([]);
    expect(effectsOn('business_os_billing_accounts').filter((e) => e.operation !== 'select')).toEqual([]);

    const refused = mockLogLines.filter((l) => l.ctx.event === 'bos_billing_payment_refused');
    expect(refused).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ reason: 'unknown_customer', accountId: null, alert: true }) }),
    ]);
  });

  it('a redelivery of the same refusal is a replay: still completed and 200, logged as replayed', async () => {
    const event = paidPlanInvoice();
    mockDb = {};
    const first = await run(event);
    expect(first.status).toBe(200);
    // The second delivery: the insert hits the event-id UNIQUE.
    mockEffects.length = 0;
    mockLogLines.length = 0;
    mockEvent = event;
    let POST: (req: NextRequest) => Promise<Response> = async () => {
      throw new Error('not loaded');
    };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per run
      POST = require('../route').POST;
    });
    mockDb = {
      'business_os_billing_events:insert': {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "business_os_billing_events_stripe_event_id_key"' },
      },
    };
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } })
    );
    expect(res.status).toBe(200);
    expect(claimUpdates()).toEqual(['completed']);
    expect(mockLogLines.filter((l) => l.ctx.event === 'bos_billing_payment_refusal_replayed')).toHaveLength(1);
    expect(mockLogLines.filter((l) => l.ctx.event === 'bos_billing_payment_refused')).toEqual([]);
  });
});

// ── P-6a.2: invoice.payment_action_required through the real route (§5.4, SR-10) ──

const ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
const HOSTED_URL = 'https://invoice.stripe.com/i/acct_route/test_route_hosted?s=ap';

/** A RENEWAL that needs 3-D Secure, on a plan price, Stripe-shaped ids (X-5's shape: attempt_count 0). */
function actionRequiredRenewal(): Record<string, unknown> {
  const event = paidPlanInvoice() as { id: string; type: string; data: { object: Record<string, unknown> } };
  event.id = 'evt_1RouteAR';
  event.type = 'invoice.payment_action_required';
  Object.assign(event.data.object, {
    id: 'in_1RouteAR',
    amount_paid: 0,
    billing_reason: 'subscription_cycle',
    attempt_count: 0,
    hosted_invoice_url: HOSTED_URL,
    status_transitions: { paid_at: null },
  });
  return event;
}

/** The account's billing row, as PostgREST returns it: it holds the subscription, paid through the first period. */
const billingRowRaw = {
  id: '77777777-7777-4777-8777-777777777777',
  user_id: ACCOUNT_ID,
  livemode: false,
  stripe_customer_id: 'cus_RouteF2',
  stripe_subscription_id: 'sub_RouteF2',
  subscription_status: 'past_due',
  bought_tier: null,
  current_period_end: '2026-09-21T14:13:20+00:00',
  cancel_at_period_end: false,
  pending_tier: null,
  open_checkout_session_id: null,
  open_checkout_expires_at: null,
  last_invoice_id: 'in_1RoutePaid',
  last_paid_at: '2026-08-22T14:13:20+00:00',
  last_payment_failed_at: null,
  failed_attempts: 0,
  action_required_invoice_url: null,
  founder_discount_applied_at: null,
  ended_at: null,
  created_at: '2026-08-01T00:00:00+00:00',
  updated_at: '2026-08-22T14:13:20+00:00',
};

describe('P-6a.2: invoice.payment_action_required through the webhook route', () => {
  const saved = process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
    else process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = saved;
  });

  it('price switch OFF (production today): not Business OS, exactly as before; no Business OS table touched, 200', async () => {
    delete process.env.BUSINESS_OS_PLAN_PRICES_ENABLED;
    const r = await run(actionRequiredRenewal());
    expect(r).toEqual({ status: 200, body: { received: true } });
    expect(claimUpdates()).toEqual(['completed']);
    expect(mockEffects.filter((e) => e.table.startsWith('business_os_'))).toEqual([]);
    expect(mockLogLines.filter((l) => l.ctx.event === 'bos_billing_event_denied')).toEqual([]);
  });

  it('price switch ON: a renewal records the history row, stores the hosted URL by compare-and-set, and logs no URL', async () => {
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'true';
    mockEffects.length = 0;
    mockLogLines.length = 0;
    mockEvent = actionRequiredRenewal();
    let POST: (req: NextRequest) => Promise<Response> = async () => {
      throw new Error('not loaded');
    };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per run
      POST = require('../route').POST;
    });
    mockDb = {
      'business_os_billing_accounts:select': { data: billingRowRaw, error: null },
      'business_os_billing_events:insert': { data: { id: EVENT_ROW_ID }, error: null },
      'business_os_billing_accounts:update': { data: null, error: null, count: 1 },
    };
    const res = await POST(
      new NextRequest('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'stripe-signature': 't=1,v1=x' } })
    );
    await new Promise((r) => setImmediate(r));
    expect(res.status).toBe(200);
    expect(claimUpdates()).toEqual(['completed']);

    const history = effectsOn('business_os_billing_events');
    expect(history.map((e) => (e.chain[0][1] as { kind: string }).kind)).toEqual(['payment_action_required']);

    const updates = effectsOn('business_os_billing_accounts').filter((e) => e.operation === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].chain[0][1]).toMatchObject({ failed_attempts: 1, action_required_invoice_url: HOSTED_URL });
    expect(updates[0].chain[0][2]).toEqual({ count: 'exact' });
    expect(updates[0].chain.map((c) => c[0])).not.toEqual(expect.arrayContaining(['select', 'or']));
    expect(updates[0].chain).toContainEqual(['eq', 'user_id', ACCOUNT_ID]);
    expect(updates[0].chain).toContainEqual(['eq', 'current_period_end', '2026-09-21T14:13:20+00:00']);

    // No plan write; the URL is in no log line.
    expect(effectsOn('business_os_account_plans')).toEqual([]);
    expect(JSON.stringify(mockLogLines)).not.toContain('invoice.stripe.com');
    expect(mockLogLines.filter((l) => l.ctx.event === 'bos_billing_renewal_failure_counted')).toEqual([
      expect.objectContaining({ ctx: expect.objectContaining({ outcome: 'recorded', failedAttempts: 1, actionRequiredUrlStored: true }) }),
    ]);
  });
});
