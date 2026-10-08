/**
 * QA (CF-5 PR 2, Connect invoices): what the characterisation harness cannot
 * see, pinned at the route.
 *
 *   1. Throws, not error results. The harness answers every query with
 *      `{ data, error }`, so it cannot tell a repository (or a call site) that
 *      catches from one that does not. Inline, a query that REJECTED threw out of
 *      the handler: 500, the claim released as `failed`, and Stripe retried. That
 *      must still hold at every one of the 15 converted sites, including the
 *      reused `findByStripeInvoiceId` (PR2-D1) and `findLanguage` (CR-P2-1). The
 *      one exception is the receipt read, which sits inside the receipt's own
 *      try/catch and so never failed the delivery.
 *   2. Tenant isolation: for each converted handler, an invoice owned by another
 *      business is refused before any write, and nothing but the claim is written.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 2). No snapshots, no database, no Stripe.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown };
type Rule = Answer | { reject: unknown };

interface DbOp {
  table: string;
  op: string;
  chain: unknown[][];
}

const mockOps: DbOp[] = [];
const mockLogs: Array<{ level: string; args: unknown[] }> = [];
const mockCalls: string[] = [];
const mockCounts: Record<string, number> = {};
let mockRules: Record<string, Rule> = {};
let mockEvent: unknown = null;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const w = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const op = w ? String(w[0]) : 'select';
    mockOps.push({ table, op, chain: calls });
    const key = `${table}:${op}`;
    mockCounts[key] = (mockCounts[key] ?? 0) + 1;
    const rule = mockRules[`${key}:${mockCounts[key]}`] ?? mockRules[key];
    if (rule && 'reject' in rule) return Promise.reject(rule.reject);
    return Promise.resolve(rule ?? { data: null, error: null });
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

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (t: string) => mockBuilder(t, []) },
  createServerSupabaseClient: () => ({ from: (t: string) => mockBuilder(t, []) }),
}));
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (...args: unknown[]) => {
      mockLogs.push({ level, args });
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
  return { ...actual, planPriceCatalog: { load: () => Promise.resolve({ byPriceId: new Map(), fromCache: false }) } };
});
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => ({ constructWebhookEvent: () => mockEvent }) }));
jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: (_client: unknown, account: string) =>
    Promise.resolve(account === 'acct_owner_a' ? 'owner-a' : null),
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve(null) }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({ bindPlanSubscription: () => Promise.resolve({}) }));
jest.mock('@/lib/payments/syncBookingPaymentState', () => ({ syncBookingsForTransactions: () => Promise.resolve() }));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: {
    create: (row: { title: string }) => {
      mockCalls.push(`crmActivity:${row.title}`);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendPaymentReceipt: () => {
      mockCalls.push('receipt');
      return Promise.resolve({ sent: true });
    },
  },
}));
jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({ allocateQuotasForUser: () => Promise.resolve({ success: true }) })),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({ pilotCreditsToTokens: (n: unknown) => Promise.resolve(Number(n) * 10) }));

// Each scenario loads the route afresh (isolateModules); the first load is slow on a busy runner.
jest.setTimeout(30000);

const PWE = 'processed_webhook_events';
const PI = 'payment_invoices';
const PGRST116 = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null };
const GENERIC_500 = { success: false, error: 'Webhook processing failed' };

const ok = (data: unknown): Answer => ({ data, error: null });
const rejects = (): Rule => ({ reject: new Error('socket hang up') });
const row = (over: Record<string, unknown> = {}) => ({
  id: 'pinv-1', user_id: 'owner-a', contact_id: 'contact-1', invoice_number: 'INV-1', booking_id: null,
  status: 'sent', currency: 'USD', ...over,
});
const activityRow = { contact_id: 'contact-1', amount: 120, currency: 'USD' };

type Fixture =
  | 'invoice-paid'
  | 'checkout-completed-invoice'
  | 'invoice-payment-failed'
  | 'invoice-finalized'
  | 'invoice-marked-uncollectible';

async function run(fixture: Fixture, rules: Record<string, Rule>, patch?: (ev: { data: { object: Record<string, unknown> } }) => void) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockCalls.length = 0;
  for (const k of Object.keys(mockCounts)) delete mockCounts[k];
  mockRules = rules;
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'connect', `${fixture}.json`), 'utf8'));
  patch?.(ev);
  mockEvent = ev;
  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('route not loaded');
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
  // Let the fire-and-forget work (receipt, activity) finish.
  await new Promise((r) => setTimeout(r, 10));
  return { status: res.status, body: await res.json() };
}

const claimRelease = () => mockOps.filter((o) => o.table === PWE && o.op === 'update').map((o) => (o.chain[0][1] as { status: string }).status);
const writes = () => mockOps.filter((o) => o.op !== 'select' && o.table !== PWE);
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('QA CF-5 PR 2: a rejected query at a converted site still fails the delivery (500, claim failed)', () => {
  // [site, fixture, rules]: the rejecting query is the last one each scenario reaches.
  const cases: Array<[string, Fixture, Record<string, Rule>]> = [
    ['H1 findByStripeInvoiceId (invoice.paid)', 'invoice-paid', { [`${PI}:select:1`]: rejects() }],
    ['H2 findByIdUnscoped (invoice.paid, metadata)', 'invoice-paid', { [`${PI}:select:1`]: { data: null, error: PGRST116 }, [`${PI}:select:2`]: rejects() }],
    ['H3 recordStripeInvoiceId', 'invoice-paid', { [`${PI}:select:1`]: { data: null, error: PGRST116 }, [`${PI}:select:2`]: ok(row()), [`${PI}:update:1`]: rejects() }],
    ['H6 markPaidFromStripeInvoice', 'invoice-paid', { [`${PI}:select:1`]: ok(row()), [`${PI}:update`]: rejects() }],
    ['I1 findByIdUnscoped (checkout)', 'checkout-completed-invoice', { [`${PI}:select`]: rejects() }],
    ['I3 markPaidFromCheckout', 'checkout-completed-invoice', { [`${PI}:select`]: ok(row()), [`${PI}:update`]: rejects() }],
    ['J1 findByStripeInvoiceId (payment_failed)', 'invoice-payment-failed', { [`${PI}:select`]: rejects() }],
    ['J2 setStatusFromStripe overdue', 'invoice-payment-failed', { [`${PI}:select:1`]: ok(row()), [`${PI}:update`]: rejects() }],
    ['J3 readFieldsUnscoped (activity)', 'invoice-payment-failed', { [`${PI}:select:1`]: ok(row()), [`${PI}:select:2`]: rejects() }],
    ['J4 findLanguage (CR-P2-1)', 'invoice-payment-failed', { [`${PI}:select:1`]: ok(row()), [`${PI}:select:2`]: ok(activityRow), 'business_profiles:select': rejects() }],
    ['K1 findByStripeInvoiceId (finalized)', 'invoice-finalized', { [`${PI}:select`]: rejects() }],
    ['K2 recordStripeDocuments', 'invoice-finalized', { [`${PI}:select`]: ok(row()), [`${PI}:update`]: rejects() }],
    ['L1 findByStripeInvoiceId (uncollectible)', 'invoice-marked-uncollectible', { [`${PI}:select`]: rejects() }],
    ['L2 setStatusFromStripe cancelled', 'invoice-marked-uncollectible', { [`${PI}:select`]: ok(row()), [`${PI}:update`]: rejects() }],
  ];

  it.each(cases)('%s', async (_site, fixture, rules) => {
    const r = await run(fixture, rules);
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimRelease()).toEqual(['failed']);
    expect(messages()).toContain('Webhook processing failed');
    // Nothing downstream of the failed query ran.
    expect(mockCalls).toEqual([]);
  });

  it('J4: a rejected language read leaves the invoice overdue but writes no activity', async () => {
    await run('invoice-payment-failed', {
      [`${PI}:select:1`]: ok(row()),
      [`${PI}:select:2`]: ok(activityRow),
      'business_profiles:select': rejects(),
    });
    expect(writes().map((o) => o.chain[0])).toEqual([['update', expect.objectContaining({ status: 'overdue' })]]);
    expect(mockCalls).toEqual([]);
  });

  it('H8: a rejected receipt read does NOT fail the delivery (it is inside the receipt try/catch)', async () => {
    const r = await run('invoice-paid', { [`${PI}:select:1`]: ok(row()), [`${PI}:select:2`]: rejects() });
    expect(r.status).toBe(200);
    expect(claimRelease()).toEqual(['completed']);
    expect(messages()).toContain('Payment settled but the receipt did not go out');
    expect(mockCalls).toEqual([]);
  });

  it('J4: a language read that RETURNS an error still answers 200 and writes the activity in English', async () => {
    const r = await run('invoice-payment-failed', {
      [`${PI}:select:1`]: ok(row()),
      [`${PI}:select:2`]: ok(activityRow),
      'business_profiles:select': { data: null, error: { code: 'XX000', message: 'db down' } },
    });
    expect(r.status).toBe(200);
    expect(claimRelease()).toEqual(['completed']);
    expect(mockCalls).toEqual(['crmActivity:Payment failed: $120.00']);
  });

  it('J4: the owner language is used for the activity (he)', async () => {
    const r = await run('invoice-payment-failed', {
      [`${PI}:select:1`]: ok(row()),
      [`${PI}:select:2`]: ok({ contact_id: 'contact-1', amount: 120, currency: 'ILS' }),
      'business_profiles:select': ok({ language: 'he' }),
    });
    expect(r.status).toBe(200);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).not.toContain('Payment failed');
    const profileRead = mockOps.find((o) => o.table === 'business_profiles');
    expect(profileRead?.chain).toEqual([['select', 'language'], ['eq', 'user_id', 'owner-a']]);
  });
});

describe('QA CF-5 PR 2: a foreign invoice is refused before any write, in every converted handler', () => {
  const foreign = row({ user_id: 'owner-b' });
  const cases: Array<[string, Fixture, Record<string, Rule>, string]> = [
    ['invoice.paid, found by Stripe id', 'invoice-paid', { [`${PI}:select:1`]: ok(foreign) }, 'Connect invoice.paid names an invoice owned by a different business - refusing'],
    ['invoice.paid, found by metadata (before recordStripeInvoiceId)', 'invoice-paid', { [`${PI}:select:1`]: { data: null, error: PGRST116 }, [`${PI}:select:2`]: ok(foreign) }, 'Connect invoice.paid names an invoice owned by a different business - refusing'],
    ['checkout.session.completed', 'checkout-completed-invoice', { [`${PI}:select`]: ok(foreign) }, 'Connect checkout names an invoice owned by a different business - refusing'],
    ['invoice.payment_failed', 'invoice-payment-failed', { [`${PI}:select`]: ok(foreign) }, 'Connect invoice.payment_failed names an invoice owned by a different business - refusing'],
    ['invoice.finalized', 'invoice-finalized', { [`${PI}:select`]: ok(foreign) }, 'Connect invoice.finalized names an invoice owned by a different business - refusing'],
    ['invoice.marked_uncollectible', 'invoice-marked-uncollectible', { [`${PI}:select`]: ok(foreign) }, 'Connect invoice.marked_uncollectible names an invoice owned by a different business - refusing'],
  ];

  it.each(cases)('%s', async (_name, fixture, rules, refusal) => {
    const r = await run(fixture, rules);
    expect(r.status).toBe(200);
    expect(messages()).toContain(refusal);
    expect(writes()).toEqual([]);
    expect(mockOps.some((o) => o.table === 'business_profiles')).toBe(false);
    expect(mockCalls).toEqual([]);
    expect(claimRelease()).toEqual(['completed']);
  });
});
