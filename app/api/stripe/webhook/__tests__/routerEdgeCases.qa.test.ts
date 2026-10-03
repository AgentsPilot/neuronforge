/**
 * QA (plan payments P-1): route-level edge cases for the Business OS router
 * that the characterisation harness covers only at unit level.
 *
 * No snapshots; nothing here may change the P-0 / P-1 snapshot file.
 * No Stripe call and no database: every client is mocked.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown };

interface QaScenario {
  /** undefined → real (empty) catalog; 'throw' → Stripe failure; map → known prices. */
  catalog?: 'throw' | Record<string, string>;
  db?: Record<string, Answer>;
}

const mockEffects: Array<Record<string, unknown>> = [];
const mockLogLines: Array<{ level: string; ctx: unknown }> = [];
let mockScenario: QaScenario = {};
let mockEvent: unknown = null;
let mockCatalogLoads = 0;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const writeCall = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const operation = writeCall ? String(writeCall[0]) : 'select';
    mockEffects.push({ type: 'db', table, operation, chain: calls });
    return Promise.resolve(mockScenario.db?.[`${table}:${operation}`] ?? { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => resolve().then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve();
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (ctx: unknown) => {
      mockLogLines.push({ level, ctx });
    };
    const l: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
    };
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
      load: (...args: unknown[]) => {
        mockCatalogLoads += 1;
        const c = mockScenario.catalog;
        if (c === 'throw') return Promise.reject(new Error('Stripe unavailable (QA)'));
        if (c) return Promise.resolve({ byPriceId: new Map(Object.entries(c)), fromCache: false });
        return actual.planPriceCatalog.load(...args);
      },
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => mockBuilder(t, []) }) }));

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => {
    mockEffects.push({ type: 'stripe.client' });
    return {};
  })
);

jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({ constructWebhookEvent: () => mockEvent }),
}));

jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: () => Promise.resolve('owner-a'),
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
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
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: { create: () => Promise.resolve({ data: null, error: null }) },
}));
jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({
    allocateQuotasForUser: () => {
      mockEffects.push({ type: 'quota' });
      return Promise.resolve({ success: true });
    },
  })),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({
  pilotCreditsToTokens: (n: unknown) => {
    mockEffects.push({ type: 'pilotCreditsToTokens' });
    return Promise.resolve(Number(n) * 10);
  },
}));

const FIXTURES = path.join(__dirname, 'fixtures');
const CREDIT_TABLES = ['user_subscriptions', 'credit_transactions', 'billing_events', 'subscription_invoices'];

function fixture(dir: string, name: string): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- test fixture mutation
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, dir, name), 'utf8'));
}

async function run(event: unknown, scenario: QaScenario = {}) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  mockCatalogLoads = 0;
  mockScenario = scenario;
  mockEvent = event;
  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module per scenario
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

const creditWrites = () =>
  mockEffects
    .filter((e) => e.type === 'db' && e.operation !== 'select' && CREDIT_TABLES.includes(String(e.table)))
    .map((e) => `${e.table}:${e.operation}`);
const claimStatus = () => {
  const ups = mockEffects.filter((e) => e.type === 'db' && e.table === 'processed_webhook_events' && e.operation === 'update');
  const last = ups[ups.length - 1] as { chain: unknown[][] } | undefined;
  return (last?.chain[0][1] as { status?: string } | undefined)?.status;
};
const denies = () =>
  mockLogLines
    .filter((l) => (l.ctx as { event?: string } | null)?.event === 'bos_billing_event_denied')
    .map((l) => ({ level: l.level, reason: (l.ctx as any).reason, alert: (l.ctx as any).alert })); // eslint-disable-line @typescript-eslint/no-explicit-any -- log ctx

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('QA P-1: Business OS router edge cases at the route', () => {
  it('catalog (Stripe) failure → 500, claim failed, NOT a deny, nothing credited, no internal message', async () => {
    const r = await run(fixture('platform', 'invoice-paid-unknown-price-legacy-metadata.json'), { catalog: 'throw' });
    expect(r.status).toBe(500);
    expect(claimStatus()).toBe('failed');
    expect(denies()).toEqual([]);
    expect(creditWrites()).toEqual([]);
    expect(r.body).toEqual({ success: false, error: 'Webhook processing failed' });
    expect(JSON.stringify(r.body)).not.toContain('Stripe unavailable');
  });

  it('a replayed, already-denied (completed) event short-circuits before the router', async () => {
    const r = await run(fixture('platform', 'invoice-paid-unknown-price-legacy-metadata.json'), {
      db: { 'processed_webhook_events:select': { data: { event_id: 'evt_platform_hazard', status: 'completed' }, error: null } },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, duplicate: true });
    expect(mockCatalogLoads).toBe(0);
    expect(denies()).toEqual([]);
    expect(creditWrites()).toEqual([]);
  });

  it('lines.has_more → denied lines_truncated with alert, catalog never read, nothing credited', async () => {
    const ev = fixture('platform', 'invoice-paid-unknown-price-legacy-metadata.json');
    ev.data.object.lines.has_more = true;
    const r = await run(ev, { catalog: { price_agent_platform_1: 'k' } });
    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expect(mockCatalogLoads).toBe(0);
    expect(denies()).toEqual([{ level: 'error', reason: 'lines_truncated', alert: true }]);
    expect(creditWrites()).toEqual([]);
  });

  it('KNOWN price + legacy user_id/credits metadata → metadata_mismatch (alert), not a flow, nothing credited', async () => {
    const r = await run(fixture('platform', 'invoice-paid-unknown-price-legacy-metadata.json'), {
      catalog: { price_agent_platform_1: 'bos_probe' },
    });
    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expect(denies()).toEqual([{ level: 'error', reason: 'metadata_mismatch', alert: true }]);
    expect(creditWrites()).toEqual([]);
    expect(mockEffects.some((e) => e.type === 'stripe.client')).toBe(false);
  });

  it('zero-line invoice with legacy metadata → no_priced_lines, nothing credited, no Stripe client', async () => {
    const ev = fixture('platform', 'invoice-paid-unknown-price-legacy-metadata.json');
    ev.data.object.lines.data = [];
    const r = await run(ev);
    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expect(denies()).toEqual([{ level: 'warn', reason: 'no_priced_lines', alert: undefined }]);
    expect(creditWrites()).toEqual([]);
    expect(mockEffects.some((e) => e.type === 'stripe.client')).toBe(false);
  });

  it('multi-line upgrade invoice, one line unknown → mixed_prices (alert), nothing credited', async () => {
    const ev = fixture('platform', 'invoice-paid-unknown-price-no-metadata.json');
    const line = ev.data.object.lines.data[0];
    ev.data.object.lines.data = [
      line,
      { ...line, id: 'il_qa_2', pricing: { ...line.pricing, price_details: { ...line.pricing.price_details, price: 'price_qa_other' } } },
    ];
    const known = String(line.pricing.price_details.price);
    const r = await run(ev, { catalog: { [known]: 'bos_probe' } });
    expect(r.status).toBe(200);
    expect(denies()).toEqual([{ level: 'error', reason: 'mixed_prices', alert: true }]);
    expect(creditWrites()).toEqual([]);
  });

  it('invoice.payment_failed on a KNOWN price, clean metadata → recognised, no handler → 500 retry, no dunning write', async () => {
    const ev = fixture('platform', 'invoice-payment-failed-unknown-price.json');
    ev.data.object.metadata = {};
    ev.data.object.parent.subscription_details.metadata = {};
    const r = await run(ev, { catalog: { price_agent_platform_1: 'bos_probe' } });
    expect(r.status).toBe(500);
    expect(claimStatus()).toBe('failed');
    expect(denies()).toEqual([]);
    expect(creditWrites()).toEqual([]);
  });

  it('invoice.payment_failed on a KNOWN price WITH legacy user_id → metadata_mismatch, no dunning write', async () => {
    const r = await run(fixture('platform', 'invoice-payment-failed-unknown-price.json'), {
      catalog: { price_agent_platform_1: 'bos_probe' },
    });
    expect(r.status).toBe(200);
    expect(denies()).toEqual([{ level: 'error', reason: 'metadata_mismatch', alert: true }]);
    expect(creditWrites()).toEqual([]);
  });

  it('a Connect invoice.paid never reaches the router (catalog never loaded, no deny log)', async () => {
    const r = await run(fixture('connect', 'invoice-paid.json'));
    expect(r.status).toBe(200);
    expect(mockCatalogLoads).toBe(0);
    expect(denies()).toEqual([]);
  });
});
