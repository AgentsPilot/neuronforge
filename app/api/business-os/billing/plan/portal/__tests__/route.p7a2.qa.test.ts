/**
 * QA P-7a.2 (workplan "SA Code Review — P-7a.2", QA focus 2, 3, 5, 6, 7, 8),
 * through the REAL routes and orchestration; harness copied from
 * `route.test.ts` (fakes only at the session, repository, Stripe, catalog).
 *
 *   - focus 7: missing / malformed configuration id → the owner reads "not
 *     available", an `error` log with `alert: true`, no session, no retrieve;
 *   - focus 8: a whole walk (every route path, success and failure, including
 *     a Stripe error whose message holds a URL) never logs a Stripe link;
 *   - focus 6: more injection shapes on both routes;
 *   - focus 2 / 5: switch combinations and abandoned / ended rows;
 *   - focus 3: a declined upgrade's voided invoice, 12 per page, hasMore.
 */


import { NextRequest } from 'next/server';

import { resetPortalConfigurationCacheForTests } from '@/lib/business-os/billing/portalConfiguration';

const USER = '11111111-1111-4111-8111-111111111111';
const PORTAL_URL = 'https://billing.stripe.com/p/session/test_SECRETBEARERLINK';
const HOSTED = 'https://invoice.stripe.com/i/acct_x/test_SECRETINVOICELINK';
const CONFIG = 'bpc_ownconfig';

const state: {
  user: { id: string; email?: string } | null;
  log: string[];
  logged: string[];
  row: Record<string, unknown> | null | 'error';
  config: Record<string, unknown> | Error;
  session: Record<string, unknown> | Error | null;
  sessionParams: Array<Record<string, unknown>>;
  invoices: { invoices: Array<Record<string, unknown>>; hasMore: boolean } | Error;
} = { user: null, log: [], logged: [], row: null, config: {}, session: null, sessionParams: [], invoices: { invoices: [], hasMore: false } };

jest.mock('@/lib/auth', () => ({ getUser: async () => state.user }));
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) {
      logger[level] = (...args: unknown[]) => {
        state.logged.push(JSON.stringify(args));
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => {
  const actual = jest.requireActual('@/lib/repositories/BusinessOsBillingAccountRepository');
  return {
    isHostedInvoiceUrl: actual.isHostedInvoiceUrl,
    businessOsBillingAccountRepository: {
      findByUser: async (userId: string, livemode: boolean) => {
        state.log.push(`db:findByUser:${userId}:${livemode}`);
        if (state.row === 'error') return { data: null, error: new Error('down') };
        return { data: state.row, error: null };
      },
    },
  };
});

const mockStripe = {
  retrieveBusinessOsPortalConfiguration: jest.fn(async (id: string) => {
    state.log.push(`stripe:config:${id}`);
    if (state.config instanceof Error) throw state.config;
    return state.config;
  }),
  createBusinessOsPortalSession: jest.fn(async (params: Record<string, unknown>) => {
    state.log.push(`stripe:session:${String(params.customerId)}`);
    state.sessionParams.push(params);
    if (state.session instanceof Error) throw state.session;
    return state.session ?? { url: PORTAL_URL, customerId: params.customerId, configurationId: params.configurationId, livemode: false };
  }),
  listBusinessOsInvoices: jest.fn(async (params: { customerId: string; limit: number }) => {
    state.log.push(`stripe:invoices:${params.customerId}:${params.limit}`);
    if (state.invoices instanceof Error) throw state.invoices;
    return state.invoices;
  }),
};
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockStripe }));

jest.mock('@/lib/business-os/billing/planPriceCatalog', () => ({
  planPriceCatalog: {
    load: async () => {
      state.log.push('stripe:catalog');
      return { byPriceId: new Map([['price_one', 'bos_plan_basic_monthly_usd']]), fromCache: false };
    },
  },
  planTierForLookupKey: jest.requireActual('@/lib/business-os/billing/planPriceCatalog').planTierForLookupKey,
}));

import { POST as PORTAL } from '@/app/api/business-os/billing/plan/portal/route';
import { GET as INVOICES } from '@/app/api/business-os/billing/plan/invoices/route';

function billingRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    cancelAtPeriodEnd: false,
    endedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

function ourConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONFIG,
    active: true,
    livemode: false,
    features: { payment_method_update: true, invoice_history: true, subscription_cancel: false, subscription_update: false, customer_update: false },
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'in_1',
    customerId: 'cus_own',
    livemode: false,
    status: 'paid',
    billingReason: 'subscription_create',
    totalMinor: 7900,
    currency: 'usd',
    created: 1_790_000_000,
    hostedInvoiceUrl: HOSTED,
    invoicePdf: null,
    priceIds: ['price_one'],
    ...overrides,
  };
}

function portalPost(body: unknown, raw?: string, headers: Record<string, string> = {}) {
  return PORTAL(
    new NextRequest('https://evil.example/api/business-os/billing/plan/portal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: raw ?? JSON.stringify(body),
    })
  );
}
function invoicesGet(query = '') {
  return INVOICES(new NextRequest(`https://evil.example/api/business-os/billing/plan/invoices${query}`, { method: 'GET' }));
}
const stripeCalls = () => state.log.filter((entry) => entry.startsWith('stripe:'));

const ENV = [
  'BUSINESS_OS_PLAN_CHECKOUT_ENABLED',
  'BUSINESS_OS_PLAN_PRICES_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_BOS_PORTAL_CONFIGURATION_ID',
  'NEXT_PUBLIC_APP_URL',
] as const;
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
  process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID = CONFIG;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.agentpilot.test';
  resetPortalConfigurationCacheForTests();
  state.user = { id: USER, email: 'owner@example.com' };
  state.log = [];
  state.logged = [];
  state.row = billingRow();
  state.config = ourConfig();
  state.session = null;
  state.sessionParams = [];
  state.invoices = { invoices: [invoice()], hasMore: false };
  for (const fn of Object.values(mockStripe)) fn.mockClear();
});

const STRIPE_LINK = /(billing|invoice|pay|checkout)\.stripe\.com/;
const parsedLogs = () => state.logged.map((line) => JSON.parse(line) as Array<Record<string, unknown>>);

describe('QA focus 7: configuration faults', () => {
  it.each([
    ['unset', undefined],
    ['not a bpc_ id', 'pc_123'],
    ['whitespace', '   '],
    ['bpc_ with a bad character', 'bpc_abc/def'],
  ])('%s → 503 portal_unavailable, "not available", error log with alert: true, no Stripe call', async (_label, value) => {
    if (value === undefined) delete process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID;
    else process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID = value;
    const response = await portalPost({ intent: 'update_card' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false,
      error: 'This is not available right now. Please try again later.',
      code: 'portal_unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const missing = parsedLogs().find((args) => args[0]?.event === 'bos_billing_portal_configuration_missing');
    expect(missing?.[0]).toMatchObject({ alert: true, env: 'STRIPE_BOS_PORTAL_CONFIGURATION_ID' });
    expect(stripeCalls()).toEqual([]);
  });

  it('a configuration retrieve that fails → error log with alert: true (unreadable), no session', async () => {
    state.config = new Error('boom');
    expect((await portalPost({ intent: 'invoices' })).status).toBe(503);
    const hit = parsedLogs().find((args) => args[0]?.event === 'bos_billing_portal_configuration_unreadable');
    expect(hit?.[0]).toMatchObject({ alert: true });
    expect(mockStripe.createBusinessOsPortalSession).not.toHaveBeenCalled();
  });

  it('a retrieve that answers ANOTHER configuration id → mismatch, no session', async () => {
    state.config = ourConfig({ id: 'bpc_someoneelse' });
    expect((await portalPost({ intent: 'update_card' })).status).toBe(503);
    expect(mockStripe.createBusinessOsPortalSession).not.toHaveBeenCalled();
  });

  it('the invoices route does not depend on the portal configuration (works with it unset)', async () => {
    delete process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID;
    expect((await invoicesGet()).status).toBe(200);
  });
});

describe('QA focus 8: no Stripe link in any log line across a whole walk', () => {
  it('every path of both routes', async () => {
    for (const locale of [undefined, 'en', 'he', 'es']) {
      await portalPost({ intent: 'update_card', ...(locale ? { locale } : {}) });
      await portalPost({ intent: 'invoices', ...(locale ? { locale } : {}) });
    }
    // A session for another customer: the URL is withheld.
    state.session = { url: PORTAL_URL, customerId: 'cus_other', configurationId: CONFIG, livemode: false };
    const withheld = await portalPost({ intent: 'update_card' });
    expect(withheld.status).toBe(502);
    expect(JSON.stringify(await withheld.json())).not.toMatch(STRIPE_LINK);
    // Stripe throws with a URL in its message.
    state.session = Object.assign(new Error(`failed for ${PORTAL_URL}`), { type: 'StripeAPIError', raw: { url: PORTAL_URL } });
    const thrown = await portalPost({ intent: 'update_card' });
    expect(thrown.status).toBe(502);
    expect(JSON.stringify(await thrown.json())).not.toMatch(STRIPE_LINK);
    state.session = null;
    // Invoices with dropped rows (alerted by id), then a throwing list.
    state.invoices = {
      invoices: [
        invoice(),
        invoice({ id: 'in_x', customerId: 'cus_other' }),
        invoice({ id: 'in_eur', currency: 'eur' }),
        invoice({ id: 'in_d', status: 'draft' }),
      ],
      hasMore: true,
    };
    expect((await invoicesGet()).status).toBe(200);
    state.invoices = Object.assign(new Error(`list failed ${HOSTED}`), { type: 'StripeAPIError' });
    expect((await invoicesGet()).status).toBe(502);

    const all = state.logged.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toMatch(STRIPE_LINK);
    expect(all).not.toContain('SECRETBEARERLINK');
    expect(all).not.toContain('SECRETINVOICELINK');
    const dropped = parsedLogs().find((args) => args[0]?.event === 'bos_billing_invoice_list_dropped');
    expect(dropped?.[0]).toMatchObject({
      alert: true,
      dropped: [
        { id: 'in_x', reason: 'other_customer' },
        { id: 'in_eur', reason: 'not_usd' },
      ],
    });
  });
});

describe('QA focus 6: injection', () => {
  it.each([
    ['customerId', '?customerId=cus_x'],
    ['an empty-valued customerId', '?customerId='],
    ['userId', '?userId=someone'],
    ['limit', '?limit=100'],
    ['starting_after', '?starting_after=in_1'],
  ])('GET invoices with %s → 400, nothing read', async (_label, query) => {
    const response = await invoicesGet(query);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.log).toEqual([]);
  });

  it.each([
    ['customerId', { intent: 'update_card', customerId: 'cus_x' }],
    ['configuration', { intent: 'update_card', configuration: 'bpc_evil' }],
    ['flow_data', { intent: 'invoices', flow_data: { type: 'subscription_cancel' } }],
    ['he-IL locale', { intent: 'update_card', locale: 'he-IL' }],
    ['intent as an array', { intent: ['update_card'] }],
    ['a null body', null],
    ['a string body', 'update_card'],
  ])('POST portal with %s → 400, nothing read', async (_label, body) => {
    const response = await portalPost(body);
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });

  it('POST with a "__proto__" key in the raw JSON → 400, nothing read', async () => {
    const response = await portalPost(undefined, '{"intent":"update_card","__proto__":{"customerId":"cus_x"}}');
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });
});

describe('QA focus 2 / 5: switches and rows', () => {
  it.each([
    ['prices off, checkout on', 'false', 'true', 404],
    ['prices off, checkout off', 'false', 'false', 404],
    ['prices on, checkout off', 'true', 'false', 200],
    ['prices on, checkout on', 'true', 'true', 200],
  ])('%s → the expected status on both routes, no-store', async (_label, prices, checkout, status) => {
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = prices;
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = checkout;
    const a = await portalPost({ intent: 'update_card' });
    const b = await invoicesGet();
    expect([a.status, b.status]).toEqual([status, status]);
    expect([a.headers.get('cache-control'), b.headers.get('cache-control')]).toEqual(['no-store', 'no-store']);
    if (status === 404) expect(state.log).toEqual([]);
  });

  it('a checkout started and abandoned (customer, no subscription) → 409 no_billing_account on both, zero Stripe calls', async () => {
    state.row = billingRow({ stripeSubscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null });
    const a = await portalPost({ intent: 'update_card' });
    const b = await invoicesGet();
    expect([a.status, b.status]).toEqual([409, 409]);
    expect((await a.json()).code).toBe('no_billing_account');
    expect((await b.json()).code).toBe('no_billing_account');
    expect(stripeCalls()).toEqual([]);
  });

  it('a row whose own livemode differs from the key mode → 409, zero Stripe calls', async () => {
    state.row = billingRow({ livemode: true });
    expect((await portalPost({ intent: 'update_card' })).status).toBe(409);
    expect(stripeCalls()).toEqual([]);
  });

  it('an ended subscription lists its old receipts', async () => {
    state.row = billingRow({ subscriptionStatus: 'canceled', endedAt: '2026-01-01T00:00:00.000Z' });
    state.invoices = { invoices: [invoice({ id: 'in_old', billingReason: 'subscription_cycle' })], hasMore: false };
    const body = await (await invoicesGet()).json();
    expect(body.data.invoices.map((r: { id: string; status: string }) => `${r.id}:${r.status}`)).toEqual(['in_old:paid']);
  });
});

describe('QA focus 3: invoice rows', () => {
  it('asks Stripe for exactly 12, one page; hasMore passes through', async () => {
    state.invoices = { invoices: Array.from({ length: 12 }, (_, i) => invoice({ id: `in_${i}` })), hasMore: true };
    const body = await (await invoicesGet()).json();
    expect(state.log.filter((l) => l.startsWith('stripe:invoices'))).toEqual(['stripe:invoices:cus_own:12']);
    expect(body.data.invoices).toHaveLength(12);
    expect(body.data.hasMore).toBe(true);
  });

  it("a declined upgrade's voided invoice is subscription_update + void (Plan change, Not charged)", async () => {
    state.invoices = {
      invoices: [invoice({ id: 'in_up', billingReason: 'subscription_update', status: 'void', totalMinor: 4100 })],
      hasMore: false,
    };
    const body = await (await invoicesGet()).json();
    expect(body.data.invoices[0]).toMatchObject({ id: 'in_up', reason: 'subscription_update', status: 'void', amountMinor: 4100 });
  });

  it('no PDF URL on the wire (deviation 3); a non-Stripe hosted link is withheld', async () => {
    state.invoices = {
      invoices: [invoice({ invoicePdf: 'https://pay.stripe.com/x' }), invoice({ id: 'in_bad', hostedInvoiceUrl: 'https://evil.example/i/1' })],
      hasMore: false,
    };
    const body = await (await invoicesGet()).json();
    expect(JSON.stringify(body)).not.toContain('pay.stripe.com');
    expect(body.data.invoices[1].hostedInvoiceUrl).toBeNull();
  });
});
