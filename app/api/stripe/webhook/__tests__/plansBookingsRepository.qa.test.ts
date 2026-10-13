/**
 * QA (CF-5 PR 4, plans and bookings): what the characterisation harness cannot
 * see, pinned at the route.
 *
 *   1. Throws, not error results. The harness answers every query with
 *      `{ data, error }`, so it cannot tell a call site that catches from one
 *      that does not. Inline, a plan or booking query that REJECTED (or threw)
 *      left the handler: 500, the claim released as `failed`, Stripe retried.
 *      That must still hold at all 10 converted route sites, and nothing
 *      downstream of the failed query may run.
 *   2. Returned errors keep their old handling (ignored, or logged with the
 *      delivery completing), and I5's `count` keeps its three readings.
 *   3. Tenant isolation: a foreign or unmapped owner writes no plan, period or
 *      booking row; owner-scoped writes carry the proved owner; H7 stays by id
 *      only (FU-4, pre-existing, documented).
 *   4. F-3 stays exactly as it is: M3 filters periods by Stripe's subscription
 *      id, never by our plan row's UUID. Fix-2 must change this on purpose.
 *   5. The Q-3 hoist (PR4-D1): an owner lookup that throws, and a Stripe client
 *      that cannot be built (STRIPE_SECRET_KEY unset), both fail the delivery
 *      without the "Could not bound" line; a real bind failure still logs it.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 4). No snapshots, no database, no Stripe network.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown; count?: number | null };
type Rule = Answer | { reject: unknown } | { throwSync: unknown };

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
let mockOwners: Record<string, string | null> = {};
let mockOwnerError: unknown = null;
let mockBindError: unknown = null;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const w = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const op = w ? String(w[0]) : 'select';
    mockOps.push({ table, op, chain: calls });
    const key = `${table}:${op}`;
    mockCounts[key] = (mockCounts[key] ?? 0) + 1;
    const rule = mockRules[`${key}:${mockCounts[key]}`] ?? mockRules[key];
    if (rule && 'throwSync' in rule) throw rule.throwSync;
    if (rule && 'reject' in rule) return Promise.reject(rule.reject);
    return Promise.resolve(rule ?? { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => {
            let p: Promise<unknown>;
            try {
              p = resolve();
            } catch (e) {
              p = Promise.reject(e);
            }
            return p.then(f, r);
          };
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
// The constructor stands in for stripe-node's: it throws when no key is given
// ("Neither apiKey nor config.authenticator provided"), which is the PR4-D1 case.
jest.mock('stripe', () =>
  jest.fn().mockImplementation((key?: string) => {
    mockCalls.push('stripe.client');
    if (!key) throw new Error('Neither apiKey nor config.authenticator provided');
    return {};
  })
);
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => ({ constructWebhookEvent: () => mockEvent }) }));
jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: (_client: unknown, account: string) => {
    mockCalls.push('resolveAccountOwner');
    if (mockOwnerError) return Promise.reject(mockOwnerError);
    return Promise.resolve(account in mockOwners ? mockOwners[account] : null);
  },
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve('pi_qa_1') }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({
  bindPlanSubscription: () => {
    mockCalls.push('bind');
    return mockBindError ? Promise.reject(mockBindError) : Promise.resolve({});
  },
}));
jest.mock('@/lib/payments/syncBookingPaymentState', () => ({ syncBookingsForTransactions: () => Promise.resolve() }));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: { create: () => Promise.resolve({ data: null, error: null }) },
}));
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: { sendPaymentReceipt: () => Promise.resolve({ sent: true }) },
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
const PT = 'payment_transactions';
const PI = 'payment_invoices';
const PLANS = 'payment_plan_subscriptions';
const PPI = 'payment_plan_installments';
const SB = 'scheduling_bookings';
const GENERIC_500 = { success: false, error: 'Webhook processing failed' };
const OWNERS = { acct_owner_a: 'owner-a', acct_foreign: 'owner-b' };
const COULD_NOT_BOUND = 'Could not bound a payment plan - subscription may bill indefinitely';

const ok = (data: unknown): Answer => ({ data, error: null });
const dbError = (message: string): Answer => ({ data: null, error: { code: 'XX000', message, details: null, hint: null } });
const rejects = (): Rule => ({ reject: new Error('socket hang up') });
const throwsSync = (): Rule => ({ throwSync: new TypeError('sync explode') });
const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: 'pinv-0001', user_id: 'owner-a', contact_id: 'contact-1', invoice_number: 'INV-1', booking_id: null,
  status: 'sent', currency: 'USD', ...over,
});
const planRow = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1', user_id: 'owner-a', contact_id: 'contact-2', booking_id: 'bk-plan-1', service_id: 'svc-1',
  currency: 'ILS', periods_paid: 0, installment_count: 3, status: 'active', ...over,
});
const endRow = (over: Record<string, unknown> = {}) => ({
  id: 'plan-1', user_id: 'owner-a', status: 'active', installment_count: 3, periods_paid: 1, ...over,
});

type Fixture =
  | 'invoice-paid-plan-period'
  | 'invoice-paid'
  | 'checkout-completed-invoice'
  | 'checkout-completed-booking'
  | 'checkout-completed-plan-foreign-links'
  | 'subscription-deleted';
/** The parts of a fixture event the scenarios patch. */
interface FixtureEvent {
  type: string;
  account?: string;
  data: { object: { metadata: Record<string, string>; [key: string]: unknown } };
}
type Patch = (ev: FixtureEvent) => void;

interface Run {
  rules?: Record<string, Rule>;
  owners?: Record<string, string | null>;
  patch?: Patch;
  ownerError?: unknown;
  bindError?: unknown;
  noStripeKey?: boolean;
}

async function run(fixture: Fixture, opts: Run = {}) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockCalls.length = 0;
  for (const k of Object.keys(mockCounts)) delete mockCounts[k];
  mockRules = opts.rules ?? {};
  mockOwners = opts.owners ?? OWNERS;
  mockOwnerError = opts.ownerError ?? null;
  mockBindError = opts.bindError ?? null;
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'connect', `${fixture}.json`), 'utf8'));
  opts.patch?.(ev);
  mockEvent = ev;
  const savedKey = process.env.STRIPE_SECRET_KEY;
  if (opts.noStripeKey) delete process.env.STRIPE_SECRET_KEY;
  try {
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
    await new Promise((r) => setTimeout(r, 10));
    return { status: res.status, body: await res.json() };
  } finally {
    process.env.STRIPE_SECRET_KEY = savedKey;
  }
}

const claimRelease = () =>
  mockOps.filter((o) => o.table === PWE && o.op === 'update').map((o) => o.chain[0][1] as { status: string; failure_message?: string });
const nonClaimOps = () => mockOps.filter((o) => o.table !== PWE);
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));
const writesTo = (table: string) => mockOps.filter((o) => o.table === table && WRITE_OPS.has(o.op));
const filters = (o: DbOp) => o.chain.filter((c) => c[0] !== 'update' && c[0] !== 'insert');

const G: Fixture = 'invoice-paid-plan-period';
const gBase = (plan: Record<string, unknown> = {}): Record<string, Rule> => ({
  [`${PLANS}:select:1`]: ok(planRow(plan)),
  [`${PT}:insert`]: ok({ id: 'tx-period-1' }),
  [`${PPI}:select:2`]: ok({ due_date: '2026-11-08', amount: '333.33' }),
  [`${PLANS}:update`]: ok(planRow()),
});
const hBase = (inv: Record<string, unknown> = {}): Record<string, Rule> => ({
  [`${PI}:select:1`]: ok(invoiceRow({ booking_id: 'bk-inv-1', ...inv })),
  [`${PT}:insert`]: ok({ id: 'tx-h-1' }),
});
const i4Base = (inv: Record<string, unknown> = {}): Record<string, Rule> => ({
  [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002', booking_id: 'bk-i4-1', ...inv })),
});
const mBase = (row: Record<string, unknown> = {}): Record<string, Rule> => ({ [`${PLANS}:select`]: ok(endRow(row)) });

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

// [site, fixture, rule key of the failing query, the rules that reach it]
type Site = [string, Fixture, string, Record<string, Rule>];
const SITES: Site[] = [
  ['G1 findInstallmentIdByStripeInvoiceId', G, `${PPI}:select:1`, gBase()],
  ['G3 markPeriodPaidFromStripe', G, `${PPI}:update`, gBase()],
  ['G4 findNextPendingPeriod', G, `${PPI}:select:2`, gBase()],
  ['G5 markPaidForOwner', G, `${SB}:update`, gBase()],
  ['H7 markPaidUnscoped', 'invoice-paid', `${SB}:update`, hBase()],
  ['I4 markPaidAndConfirmIfPending', 'checkout-completed-invoice', `${SB}:update`, i4Base()],
  ['I5 markPaidForOwnerCounted', 'checkout-completed-booking', `${SB}:update`, {}],
  ['M1 findEndStateBySubscriptionId', 'subscription-deleted', `${PLANS}:select`, {}],
  ['M2 endFromStripe', 'subscription-deleted', `${PLANS}:update`, mBase()],
  ['M3 cancelOpenPeriodsForEndedPlan', 'subscription-deleted', `${PPI}:update`, mBase()],
];

describe('QA CF-5 PR 4: a rejected or thrown query at a plan or booking site still fails the delivery (500, claim failed)', () => {
  const cases = SITES.flatMap(([site, fixture, key, rules]) => [
    [`${site}: rejects`, fixture, key, { ...rules, [key]: rejects() }, 'socket hang up'] as const,
    [`${site}: throws synchronously`, fixture, key, { ...rules, [key]: throwsSync() }, 'sync explode'] as const,
  ]);

  it.each(cases)('%s', async (_site, fixture, key, rules, message) => {
    const r = await run(fixture, { rules });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: message }]);
    expect(messages()).toContain('Webhook processing failed');
    // The failed query is the last thing the handler did: nothing downstream ran.
    const last = nonClaimOps().at(-1);
    expect(`${last?.table}:${last?.op}`).toBe(key.split(':').slice(0, 2).join(':'));
  });
});

describe('QA CF-5 PR 4: returned errors keep their old handling', () => {
  it('G3: a period-update error is ignored; the next period, the plan count and the booking are still written', async () => {
    const r = await run(G, { rules: { ...gBase(), [`${PPI}:update`]: dbError('inst upd') } });
    expect(r.status).toBe(200);
    expect(mockOps.map((o) => `${o.table}:${o.op}`).filter((k) => k !== `${PWE}:update`).slice(-4)).toEqual([
      `${PPI}:update`, `${PPI}:select`, `${PLANS}:update`, `${SB}:update`,
    ]);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('G4: a next-period read error leaves the next charge unknown (null), not a failure', async () => {
    const r = await run(G, { rules: { ...gBase(), [`${PPI}:select:2`]: dbError('next read') } });
    expect(r.status).toBe(200);
    const planUpdate = writesTo(PLANS)[0].chain[0][1] as Record<string, unknown>;
    expect(planUpdate).toMatchObject({ periods_paid: 1, next_charge_at: null, next_charge_amount: null });
  });

  it('G1: a period already recorded under this Stripe invoice writes nothing', async () => {
    const r = await run(G, { rules: { ...gBase(), [`${PPI}:select:1`]: ok({ id: 'inst-1' }) } });
    expect(r.status).toBe(200);
    expect([...writesTo(PT), ...writesTo(PPI), ...writesTo(PLANS), ...writesTo(SB)]).toEqual([]);
    expect(messages()).toContain('Plan period already recorded');
  });

  it('G3: the period is closed by plan row id and period number, with the transaction id', async () => {
    await run(G, { rules: gBase({ periods_paid: 1 }) });
    const [upd] = writesTo(PPI);
    expect(upd.chain[0][1]).toMatchObject({ status: 'paid', stripe_invoice_id: 'in_plan_period_1', transaction_id: 'tx-period-1' });
    expect(filters(upd)).toEqual([['eq', 'subscription_id', 'plan-1'], ['eq', 'installment_number', 2]]);
  });

  it('G5: a booking-update error is logged and the period still counts (200, completed)', async () => {
    const r = await run(G, { rules: { ...gBase(), [`${SB}:update`]: dbError('booking upd') } });
    expect(r.status).toBe(200);
    expect(messages()).toContain('Plan period recorded but the booking still reads unpaid');
    expect(messages()).toContain('Plan period recorded');
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('H7 and I4: a booking-update error is logged and the delivery completes', async () => {
    for (const [fixture, rules] of [['invoice-paid', hBase()], ['checkout-completed-invoice', i4Base()]] as const) {
      const r = await run(fixture, { rules: { ...rules, [`${SB}:update`]: dbError('upd') } });
      expect(r.status).toBe(200);
      expect(messages()).toContain('Failed to update booking payment status');
      expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
    }
  });

  it('I4: paid and confirmed only while still pending', async () => {
    await run('checkout-completed-invoice', { rules: i4Base() });
    const [upd] = writesTo(SB);
    expect(Object.keys(upd.chain[0][1] as object)).toEqual(['payment_status', 'status', 'updated_at']);
    expect(upd.chain[0][1]).toMatchObject({ payment_status: 'paid', status: 'confirmed' });
    expect(filters(upd)).toEqual([['eq', 'id', 'bk-i4-1'], ['eq', 'status', 'pending']]);
  });

  it.each([
    ['count 0 → refusal logged', { data: null, error: null, count: 0 }, 'Connect checkout names a booking owned by a different business - no row updated'],
    ['count 1 → updated', { data: null, error: null, count: 1 }, 'Booking payment status updated'],
    ['count null → not read as a refusal', { data: null, error: null, count: null }, 'Booking payment status updated'],
    ['count absent → not read as a refusal', { data: null, error: null }, 'Booking payment status updated'],
    ['error → logged', { ...dbError('i5 upd'), count: null }, 'Failed to update booking payment status'],
  ] as const)('I5: %s', async (_c, answer, message) => {
    const r = await run('checkout-completed-booking', { rules: { [`${SB}:update`]: answer } });
    expect(r.status).toBe(200);
    expect(messages()).toContain(message);
    const [upd] = writesTo(SB);
    expect(upd.chain[0]).toEqual(['update', { payment_status: 'paid', updated_at: expect.any(String) }, { count: 'exact' }]);
  });

  it('M2 and M3: returned errors are ignored (F-3: the M3 error is the one PostgREST answers today)', async () => {
    const r = await run('subscription-deleted', {
      rules: { ...mBase(), [`${PLANS}:update`]: dbError('m2'), [`${PPI}:update`]: dbError('invalid input syntax for type uuid: "sub_plan_1"') },
    });
    expect(r.status).toBe(200);
    expect(writesTo(PLANS)).toHaveLength(1);
    expect(writesTo(PPI)).toHaveLength(1);
    expect(messages()).toContain('Payment plan ended');
  });

  it.each([
    ['cancelled', endRow({ periods_paid: 1 }), 'cancelled_at', 1],
    ['completed', endRow({ periods_paid: 3 }), 'completed_at', 0],
  ] as const)('M2: an ended plan is %s with its own timestamp; M3 only when cancelled', async (outcome, row, stamp, m3) => {
    await run('subscription-deleted', { rules: { [`${PLANS}:select`]: ok(row) } });
    const [end] = writesTo(PLANS);
    expect(Object.keys(end.chain[0][1] as object)).toEqual(['status', stamp, 'updated_at']);
    expect((end.chain[0][1] as Record<string, unknown>).status).toBe(outcome);
    expect(filters(end)).toEqual([['eq', 'id', 'plan-1']]);
    expect(writesTo(PPI)).toHaveLength(m3);
  });
});

describe('QA CF-5 PR 4: tenant isolation', () => {
  it.each([
    ['G foreign plan', G, { rules: gBase({ user_id: 'owner-b' }) }],
    ['G unmapped account', G, { rules: gBase(), owners: {} }],
    ['H7 foreign invoice', 'invoice-paid', { rules: hBase({ user_id: 'owner-b' }) }],
    ['H7 unmapped account', 'invoice-paid', { rules: hBase(), owners: {} }],
    ['I4 foreign invoice', 'checkout-completed-invoice', { rules: i4Base({ user_id: 'owner-b' }) }],
    ['I4 unmapped account', 'checkout-completed-invoice', { rules: i4Base(), owners: {} }],
    ['I5 unmapped account', 'checkout-completed-booking', { owners: {} }],
    ['M foreign plan', 'subscription-deleted', { rules: mBase({ user_id: 'owner-b' }) }],
    ['M unmapped account', 'subscription-deleted', { rules: mBase(), owners: {} }],
  ] as const)('%s: no plan, period or booking row is written', async (_c, fixture, opts) => {
    const r = await run(fixture, opts as Run);
    expect(r.status).toBe(200);
    expect([...writesTo(PPI), ...writesTo(PLANS), ...writesTo(SB)]).toEqual([]);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('G5: the booking is marked paid only for the plan owner', async () => {
    await run(G, { rules: gBase() });
    const [upd] = writesTo(SB);
    expect(upd.chain[0][1]).toEqual({ payment_status: 'paid', updated_at: expect.any(String) });
    expect(filters(upd)).toEqual([['eq', 'id', 'bk-plan-1'], ['eq', 'user_id', 'owner-a']]);
  });

  it("I5: scoped to the SENDING account's owner, not to anything in the session", async () => {
    await run('checkout-completed-booking', {
      patch: (e) => {
        e.account = 'acct_foreign';
        e.data.object.metadata.owner_id = 'owner-a';
      },
      rules: { [`${SB}:update`]: { data: null, error: null, count: 0 } },
    });
    const [upd] = writesTo(SB);
    expect(filters(upd)).toEqual([['eq', 'id', 'bk-0001'], ['eq', 'user_id', 'owner-b']]);
  });

  it('H7: by booking id only, after the invoice owner check (FU-4, pre-existing and documented)', async () => {
    await run('invoice-paid', { rules: hBase() });
    const [upd] = writesTo(SB);
    expect(upd.chain[0][1]).toEqual({ payment_status: 'paid', updated_at: expect.any(String) });
    expect(filters(upd)).toEqual([['eq', 'id', 'bk-inv-1']]);
  });

  it("M3: scoped to the plan owner, and F-3 kept: filtered by Stripe's subscription id, never by our plan UUID", async () => {
    await run('subscription-deleted', { rules: mBase() });
    const [m3] = writesTo(PPI);
    expect(m3.chain[0][1]).toEqual({ status: 'cancelled', next_retry_at: null, updated_at: expect.any(String) });
    expect(filters(m3)).toEqual([
      ['eq', 'user_id', 'owner-a'],
      ['eq', 'subscription_id', 'sub_plan_1'],
      ['not', 'status', 'in', '(paid,cancelled)'],
    ]);
    expect(JSON.stringify(m3.chain)).not.toContain('plan-1');
  });
});

describe('QA CF-5 PR 4: the plan-checkout hoist (PR4-D1) changes one log line and nothing else', () => {
  const PC: Fixture = 'checkout-completed-plan-foreign-links';

  it('an owner lookup that throws: 500, claim failed, no bind, and no "Could not bound" line', async () => {
    const r = await run(PC, { ownerError: new Error('connect read down') });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: 'connect read down' }]);
    expect(mockCalls).toEqual(['stripe.client', 'resolveAccountOwner']);
    expect(messages()).not.toContain(COULD_NOT_BOUND);
    expect(messages()).toContain('Webhook processing failed');
  });

  it.each([
    ['with an owner id', undefined],
    ['without an owner id', (e: FixtureEvent) => { delete e.data.object.metadata.owner_id; }],
  ] as const)('STRIPE_SECRET_KEY unset (%s): 500, claim failed, no lookup, no bind, no "Could not bound" line', async (_c, patch) => {
    const r = await run(PC, { noStripeKey: true, patch: patch as Patch | undefined });
    expect(r.status).toBe(500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: 'Neither apiKey nor config.authenticator provided' }]);
    expect(mockCalls).toEqual(['stripe.client']);
    expect(messages()).not.toContain(COULD_NOT_BOUND);
    expect(messages()).toContain('Webhook processing failed');
  });

  it('a bind that throws still goes through the catch: logged once, 500, claim failed', async () => {
    const r = await run(PC, { bindError: new Error('schedule refused') });
    expect(r.status).toBe(500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: 'schedule refused' }]);
    expect(mockCalls).toEqual(['stripe.client', 'resolveAccountOwner', 'bind']);
    expect(messages().filter((m) => m === COULD_NOT_BOUND)).toHaveLength(1);
  });

  it.each([
    ['not owned', (e: FixtureEvent) => { e.data.object.metadata.owner_id = 'owner-b'; }, ['stripe.client', 'resolveAccountOwner']],
    ['no owner id (no lookup)', (e: FixtureEvent) => { delete e.data.object.metadata.owner_id; }, ['stripe.client']],
    ['empty owner id (no lookup)', (e: FixtureEvent) => { e.data.object.metadata.owner_id = ''; }, ['stripe.client']],
  ] as const)('%s: refused, 200, no bind', async (_c, patch, calls) => {
    // The fixture's booking_id is removed so the later booking path (its own owner lookup) does not run.
    const r = await run(PC, { patch: (e) => { (patch as Patch)(e); delete e.data.object.metadata.booking_id; } });
    expect(r.status).toBe(200);
    expect(mockCalls).toEqual(calls);
    expect(messages()).toContain('Plan checkout names an owner this account does not own - refusing');
    expect(messages()).not.toContain(COULD_NOT_BOUND);
  });
});
