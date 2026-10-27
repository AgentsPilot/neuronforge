/**
 * POST /api/business-os/billing/plan/portal and
 * GET /api/business-os/billing/plan/invoices (plan payments P-7a.2, workplan
 * §4.4, §4.5, §7 "Routes"; SA C-1, C-6, TQ-6 to TQ-8).
 *
 * Integration through the REAL routes and the REAL orchestration
 * (`planBillingDocuments.ts`, `portalConfiguration.ts`, `planInvoiceList.ts`);
 * only the edges are fakes: the session, the billing repository, Stripe and
 * the plan price catalog. Every call lands in one ordered log, and every
 * logger call is kept, so "nothing was read" and "the URL was never logged"
 * are assertions.
 *
 * Per route: switch off (404, nothing read), signed out (401), invalid input
 * (400, an injected id included), no billing account (409, zero Stripe
 * calls), the happy path, and `Cache-Control: no-store` on every answer.
 * Portal: a missing or malformed configuration id refuses (never Stripe's
 * default), a configuration that allows cancel refuses, the return URL comes
 * from the server-side origin and never the request's Host / Origin.
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

describe.each([
  ['portal', () => portalPost({ intent: 'update_card' })],
  ['invoices', () => invoicesGet()],
] as const)('%s — boundaries', (_name, send) => {
  it('C-1: the price switch off → 404, nothing read (no session, no database, no Stripe), no-store', async () => {
    process.env.BUSINESS_OS_PLAN_PRICES_ENABLED = 'false';
    process.env.BUSINESS_OS_PLAN_CHECKOUT_ENABLED = 'true';
    const getUserSpy = jest.spyOn(jest.requireMock('@/lib/auth') as { getUser: () => unknown }, 'getUser');
    const response = await send();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: false, error: 'Not found', code: 'not_available' });
    expect(state.log).toEqual([]);
    expect(getUserSpy).not.toHaveBeenCalled();
    getUserSpy.mockRestore();
  });

  it('BQ-1: works with the CHECKOUT switch off (pausing sales never hides a payer\'s card or receipts)', async () => {
    const response = await send();
    expect(response.status).toBe(200);
  });

  it('signed out → 401, nothing read', async () => {
    state.user = null;
    const response = await send();
    expect(response.status).toBe(401);
    expect(state.log).toEqual([]);
  });

  it('no billing account → 409 no_billing_account, zero Stripe calls', async () => {
    state.row = null;
    const response = await send();
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('no_billing_account');
    expect(stripeCalls()).toEqual([]);
  });

  it('a customer but no subscription (a checkout that never paid) → 409, zero Stripe calls', async () => {
    state.row = billingRow({ stripeSubscriptionId: null, subscriptionStatus: null });
    const response = await send();
    expect(response.status).toBe(409);
    expect(stripeCalls()).toEqual([]);
  });

  it('an unreadable billing row → 503, zero Stripe calls', async () => {
    state.row = 'error';
    const response = await send();
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('billing_row_unreadable');
    expect(stripeCalls()).toEqual([]);
  });

  it('an ENDED subscription still has its card and receipts (200)', async () => {
    state.row = billingRow({ subscriptionStatus: 'canceled', endedAt: '2026-01-01T00:00:00.000Z' });
    const response = await send();
    expect(response.status).toBe(200);
  });

  it('reads the SESSION user\'s row in the server key\'s mode', async () => {
    await send();
    expect(state.log[0]).toBe(`db:findByUser:${USER}:false`);
  });
});

describe('POST /plan/portal', () => {
  it('happy path: update_card → 200 { url }, no-store, our customer and configuration, card flow', async () => {
    const response = await portalPost({ intent: 'update_card', locale: 'es' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: { url: PORTAL_URL } });
    expect(state.log).toEqual([`db:findByUser:${USER}:false`, `stripe:config:${CONFIG}`, 'stripe:session:cus_own']);
    expect(state.sessionParams[0]).toEqual({
      customerId: 'cus_own',
      configurationId: CONFIG,
      returnUrl: 'https://app.agentpilot.test/business-os/settings?section=plan',
      locale: 'es',
      flow: 'payment_method_update',
    });
  });

  it('invoices intent: the portal home (no flow); he → auto (X-5); no locale → auto', async () => {
    await portalPost({ intent: 'invoices', locale: 'he' });
    await portalPost({ intent: 'invoices' });
    expect(state.sessionParams.map((p) => [p.flow, p.locale])).toEqual([
      [null, 'auto'],
      [null, 'auto'],
    ]);
  });

  it('C-6: the return URL is the server-side origin, never the request Host / Origin / Referer', async () => {
    await portalPost({ intent: 'update_card' }, undefined, {
      host: 'evil.example',
      origin: 'https://evil.example',
      referer: 'https://evil.example/x',
      'x-forwarded-host': 'evil.example',
    });
    expect(String(state.sessionParams[0].returnUrl)).toBe('https://app.agentpilot.test/business-os/settings?section=plan');
    expect(JSON.stringify(state.sessionParams)).not.toContain('evil');
  });

  it('C-6: the portal URL is never logged', async () => {
    await portalPost({ intent: 'update_card' });
    expect(state.logged.length).toBeGreaterThan(0);
    expect(state.logged.join('\n')).not.toContain('SECRETBEARERLINK');
  });

  it.each([
    ['an injected userId', { intent: 'update_card', userId: 'someone-else' }],
    ['an injected customerId', { intent: 'update_card', customerId: 'cus_other' }],
    ['an injected returnUrl', { intent: 'update_card', returnUrl: 'https://evil.example' }],
    ['an unknown intent', { intent: 'cancel' }],
    ['no intent', {}],
    ['an unsupported locale', { intent: 'update_card', locale: 'fr' }],
    ['an array', [{ intent: 'update_card' }]],
  ])('%s → 400, nothing read', async (_label, body) => {
    const response = await portalPost(body);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).code).toBe('invalid_input');
    expect(state.log).toEqual([]);
  });

  it('unparsable JSON → 400', async () => {
    const response = await portalPost(undefined, '{not json');
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a bpc_ id', 'cus_123'],
  ])('configuration id %s → 503 portal_unavailable, NO session (never Stripe\'s default configuration)', async (_label, value) => {
    if (value === undefined) delete process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID;
    else process.env.STRIPE_BOS_PORTAL_CONFIGURATION_ID = value;
    const response = await portalPost({ intent: 'update_card' });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('portal_unavailable');
    expect(mockStripe.createBusinessOsPortalSession).not.toHaveBeenCalled();
    expect(mockStripe.retrieveBusinessOsPortalConfiguration).not.toHaveBeenCalled();
  });

  it.each([
    ['allows cancel', { features: { ...ourConfig().features as object, subscription_cancel: true } }],
    ['allows plan switching', { features: { ...ourConfig().features as object, subscription_update: true } }],
    ['has no card update', { features: { ...ourConfig().features as object, payment_method_update: false } }],
    ['is live while the key is test', { livemode: true }],
    ['is archived', { active: false }],
  ])('a configuration that %s → 503, no session, alerted', async (_label, overrides) => {
    state.config = ourConfig(overrides);
    const response = await portalPost({ intent: 'update_card' });
    expect(response.status).toBe(503);
    expect(mockStripe.createBusinessOsPortalSession).not.toHaveBeenCalled();
    expect(state.logged.join('\n')).toContain('bos_billing_portal_configuration_mismatch');
  });

  it('C-6: the configuration check caches SUCCESS only (a failed read is retried; a pass is not re-read)', async () => {
    state.config = new Error('stripe down');
    expect((await portalPost({ intent: 'update_card' })).status).toBe(503);
    state.config = ourConfig();
    expect((await portalPost({ intent: 'update_card' })).status).toBe(200);
    expect((await portalPost({ intent: 'update_card' })).status).toBe(200);
    expect(mockStripe.retrieveBusinessOsPortalConfiguration).toHaveBeenCalledTimes(2);
  });

  it('a session for another customer, mode or configuration → 502, and the URL is NOT returned', async () => {
    for (const session of [
      { url: PORTAL_URL, customerId: 'cus_other', configurationId: CONFIG, livemode: false },
      { url: PORTAL_URL, customerId: 'cus_own', configurationId: CONFIG, livemode: true },
      { url: PORTAL_URL, customerId: 'cus_own', configurationId: 'bpc_default', livemode: false },
    ]) {
      state.session = session;
      const response = await portalPost({ intent: 'update_card' });
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain('SECRETBEARERLINK');
    }
  });

  it('Stripe fails to create the session → 502 stripe_error', async () => {
    state.session = new Error('timeout');
    const response = await portalPost({ intent: 'update_card' });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('stripe_error');
  });
});

describe('GET /plan/invoices', () => {
  it('happy path: our customer, the last 12, one page, mapped rows, no-store', async () => {
    const response = await invoicesGet();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        invoices: [
          {
            id: 'in_1',
            createdAt: new Date(1_790_000_000 * 1000).toISOString(),
            reason: 'subscription_create',
            planLabel: 'Essentials',
            amountMinor: 7900,
            currency: 'usd',
            status: 'paid',
            hostedInvoiceUrl: HOSTED,
          },
        ],
        hasMore: false,
      },
    });
    expect(state.log).toEqual([`db:findByUser:${USER}:false`, 'stripe:invoices:cus_own:12', 'stripe:catalog']);
    expect(mockStripe.listBusinessOsInvoices).toHaveBeenCalledTimes(1);
  });

  it('an injected customerId (or any query) → 400, nothing read', async () => {
    const response = await invoicesGet('?customerId=cus_other');
    expect(response.status).toBe(400);
    expect(state.log).toEqual([]);
  });

  it('C-6: the list (its links) is never logged', async () => {
    await invoicesGet();
    expect(state.logged.join('\n')).not.toContain('SECRETINVOICELINK');
  });

  it('hasMore → passed through for "See all in Stripe"', async () => {
    state.invoices = { invoices: [invoice()], hasMore: true };
    expect((await (await invoicesGet()).json()).data.hasMore).toBe(true);
  });

  it('Stripe fails → 502 stripe_error', async () => {
    state.invoices = new Error('down');
    const response = await invoicesGet();
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe('stripe_error');
  });
});
