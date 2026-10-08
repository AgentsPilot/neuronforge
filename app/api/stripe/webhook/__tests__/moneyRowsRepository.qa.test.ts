/**
 * QA (CF-5 PR 3, money rows): what the characterisation harness cannot see,
 * pinned at the route.
 *
 *   1. Throws, not error results. The harness answers every query with
 *      `{ data, error }`, so it cannot tell a repository method (or a call site)
 *      that catches from one that does not. Inline, a `payment_transactions` or
 *      `payment_refunds` query that REJECTED (or threw) left the handler: 500,
 *      the claim released as `failed`, and Stripe retried. That must still hold
 *      at all 12 converted sites, and nothing downstream of the failed query may
 *      run.
 *   2. Returned errors keep their old handling (logged and ignored, logged and
 *      returned, or thrown), including G2 rethrowing the raw error object.
 *   3. Tenant isolation: a foreign or unmapped owner on every owner-checked
 *      money write (F2, G2, H4/#257/H5, I2) writes no money row, and each insert
 *      carries the proved owner as `user_id`, never a metadata claim.
 *   4. Two value rules the harness fixtures do not exercise: a zero-decimal
 *      refund amount, and the dispute restore rule.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 3). No snapshots, no database, no Stripe.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown };
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
let mockPI: string | null = null;

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
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => ({ constructWebhookEvent: () => mockEvent }) }));
jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: (_client: unknown, account: string) =>
    Promise.resolve(account in mockOwners ? mockOwners[account] : null),
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve(mockPI) }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({ bindPlanSubscription: () => Promise.resolve({}) }));
jest.mock('@/lib/payments/syncBookingPaymentState', () => ({
  syncBookingsForTransactions: () => {
    mockCalls.push('syncBookings');
    return Promise.resolve();
  },
}));
jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: { create: () => Promise.resolve({ data: null, error: null }) },
}));
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendPaymentReceipt: () => {
      mockCalls.push('receipt');
      return Promise.resolve({ sent: true });
    },
  },
}));
jest.mock('@/lib/services/DisputeAlertService', () => ({
  notifyOwnerOfDispute: () => {
    mockCalls.push('disputeAlert');
    return Promise.resolve();
  },
}));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({ allocateQuotasForUser: () => Promise.resolve({ success: true }) })),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({ pilotCreditsToTokens: (n: unknown) => Promise.resolve(Number(n) * 10) }));

// Each scenario loads the route afresh (isolateModules); the first load is slow on a busy runner.
jest.setTimeout(30000);

const PWE = 'processed_webhook_events';
const PT = 'payment_transactions';
const PR = 'payment_refunds';
const PI = 'payment_invoices';
const PLANS = 'payment_plan_subscriptions';
const GENERIC_500 = { success: false, error: 'Webhook processing failed' };
const OWNERS = { acct_owner_a: 'owner-a', acct_foreign: 'owner-b' };

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
const disputeRow = (over: Record<string, unknown> = {}) => ({
  id: 'tx-1', user_id: 'owner-a', status: 'succeeded', amount: 150, currency: 'USD', contact_id: null, metadata: null, ...over,
});
const refundRow = { id: 'tx-1', user_id: 'owner-a', invoice_id: 'pinv-1', currency: 'USD' };
const unattached = ok({ id: 'tx-by-intent', invoice_id: null });

type Fixture =
  | 'payment-intent-succeeded'
  | 'invoice-paid-plan-period'
  | 'invoice-paid'
  | 'checkout-completed-invoice'
  | 'charge-dispute-created'
  | 'charge-refunded';
type Patch = (ev: { type: string; account?: string; data: { object: Record<string, unknown> } }) => void;

interface Run {
  rules?: Record<string, Rule>;
  owners?: Record<string, string | null>;
  pi?: string | null;
  patch?: Patch;
}

async function run(fixture: Fixture, opts: Run = {}) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockCalls.length = 0;
  for (const k of Object.keys(mockCounts)) delete mockCounts[k];
  mockRules = opts.rules ?? {};
  mockOwners = opts.owners ?? OWNERS;
  mockPI = opts.pi ?? null;
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'connect', `${fixture}.json`), 'utf8'));
  opts.patch?.(ev);
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
  // Let the fire-and-forget work (receipt, dispute alert) finish.
  await new Promise((r) => setTimeout(r, 10));
  return { status: res.status, body: await res.json() };
}

const claimRelease = () =>
  mockOps.filter((o) => o.table === PWE && o.op === 'update').map((o) => o.chain[0][1] as { status: string; failure_message?: string });
const moneyOps = () => mockOps.filter((o) => o.table === PT || o.table === PR);
const nonClaimOps = () => mockOps.filter((o) => o.table !== PWE);
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));
const inserts = () => mockOps.filter((o) => o.table === PT && o.op === 'insert').map((o) => o.chain[0][1] as Record<string, unknown>);

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

// [site, fixture, rule key of the failing query, the rules that reach it, resolved payment intent]
type Site = [string, Fixture, string, Record<string, Rule>, (string | null)?, Patch?];
const SITES: Site[] = [
  ['D1 findFirstByStripeReference (dispute)', 'charge-dispute-created', `${PT}:select`, {}],
  ['D2 recordDisputeState', 'charge-dispute-created', `${PT}:update`, { [`${PT}:select`]: ok([disputeRow()]) }],
  ['E1 findFirstByStripeReference (refund)', 'charge-refunded', `${PT}:select`, {}],
  ['E2 upsertFromStripe', 'charge-refunded', `${PR}:upsert`, { [`${PT}:select`]: ok([refundRow]) }],
  ['F1 findByPaymentIntentId (id)', 'payment-intent-succeeded', `${PT}:select`, {}],
  ['F2 insertFromWebhook (standalone)', 'payment-intent-succeeded', `${PT}:insert`, {}],
  ['G2 insertFromWebhookReturningId (plan period)', 'invoice-paid-plan-period', `${PT}:insert`, { [`${PLANS}:select`]: ok(planRow()) }, 'pi_plan_1'],
  ['H4 findSettledIdForInvoice', 'invoice-paid', `${PT}:select:1`, { [`${PI}:select:1`]: ok(invoiceRow()) }, 'pi_invoice_1'],
  ['#257 findByPaymentIntentId (attach columns)', 'invoice-paid', `${PT}:select:2`, { [`${PI}:select:1`]: ok(invoiceRow()) }, 'pi_invoice_1'],
  ['#257 attachToInvoice', 'invoice-paid', `${PT}:update`, { [`${PI}:select:1`]: ok(invoiceRow()), [`${PT}:select:2`]: unattached }, 'pi_invoice_1'],
  ['H5 insertFromWebhook (invoice)', 'invoice-paid', `${PT}:insert`, { [`${PI}:select:1`]: ok(invoiceRow()) }, 'pi_invoice_1'],
  ['I2 insertFromWebhook (checkout)', 'checkout-completed-invoice', `${PT}:insert`, { [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002' })) }],
];

describe('QA CF-5 PR 3: a rejected or thrown query at a money-row site still fails the delivery (500, claim failed)', () => {
  const cases = SITES.flatMap(([site, fixture, key, rules, pi]) => [
    [`${site}: rejects`, fixture, key, { ...rules, [key]: rejects() }, pi ?? null, 'socket hang up'] as const,
    [`${site}: throws synchronously`, fixture, key, { ...rules, [key]: throwsSync() }, pi ?? null, 'sync explode'] as const,
  ]);

  it.each(cases)('%s', async (_site, fixture, key, rules, pi, message) => {
    const r = await run(fixture, { rules, pi });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: message }]);
    expect(messages()).toContain('Webhook processing failed');
    // The failed query is the last thing the handler did: nothing downstream ran.
    const last = nonClaimOps().at(-1);
    expect(`${last?.table}:${last?.op}`).toBe(key.split(':').slice(0, 2).join(':'));
    expect(mockCalls).toEqual([]);
  });
});

describe('QA CF-5 PR 3: returned errors keep their old handling', () => {
  it('D2: an update error is logged and the delivery completes, with no owner alert', async () => {
    const r = await run('charge-dispute-created', { rules: { [`${PT}:select`]: ok([disputeRow()]), [`${PT}:update`]: dbError('upd') } });
    expect(r.status).toBe(200);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(messages()).toContain('Failed to record dispute');
    expect(mockCalls).toEqual([]);
  });

  it('#257: an attach error is logged, nothing is inserted, and the invoice is still marked paid', async () => {
    const r = await run('invoice-paid', {
      pi: 'pi_invoice_1',
      rules: { [`${PI}:select:1`]: ok(invoiceRow()), [`${PT}:select:2`]: unattached, [`${PT}:update`]: dbError('attach failed') },
    });
    expect(r.status).toBe(200);
    expect(messages()).toContain('Could not attach an existing payment row to its invoice');
    expect(inserts()).toEqual([]);
    expect(mockOps.filter((o) => o.table === PI && o.op === 'update')).toHaveLength(1);
  });

  it.each([
    ['F1', 'payment-intent-succeeded', `${PT}:select`, {}],
    ['H4', 'invoice-paid', `${PT}:select:1`, { [`${PI}:select:1`]: ok(invoiceRow()) }],
    ['#257 lookup', 'invoice-paid', `${PT}:select:2`, { [`${PI}:select:1`]: ok(invoiceRow()) }],
  ] as const)('%s: a returned read error is ignored, as inline (the payment is recorded)', async (_s, fixture, key, rules) => {
    const r = await run(fixture, { pi: 'pi_invoice_1', rules: { ...rules, [key]: dbError('read failed') } });
    expect(r.status).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  it('G2: an insert error rethrows the raw error object (its message is the claim failure)', async () => {
    const r = await run('invoice-paid-plan-period', {
      pi: 'pi_plan_1',
      rules: { [`${PLANS}:select`]: ok(planRow()), [`${PT}:insert`]: dbError('plan tx failed') },
    });
    expect(r.status).toBe(500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: 'plan tx failed' }]);
    expect(mockOps.filter((o) => o.table === 'payment_plan_installments' && o.op === 'update')).toEqual([]);
  });

  it('G2: the returned id links the period, read with select(id).single()', async () => {
    await run('invoice-paid-plan-period', {
      pi: 'pi_plan_1',
      rules: { [`${PLANS}:select`]: ok(planRow()), [`${PT}:insert`]: ok({ id: 'tx-plan-1' }) },
    });
    const insert = mockOps.find((o) => o.table === PT && o.op === 'insert');
    expect(insert?.chain.slice(1)).toEqual([['select', 'id']]);
    const period = mockOps.find((o) => o.table === 'payment_plan_installments' && o.op === 'update');
    expect((period?.chain[0][1] as Record<string, unknown>).transaction_id).toBe('tx-plan-1');
  });

  it('E2: the first refund error stops the loop and fails the delivery with its message', async () => {
    const r = await run('charge-refunded', { rules: { [`${PT}:select`]: ok([refundRow]), [`${PR}:upsert:1`]: dbError('ref fail') } });
    expect(r.status).toBe(500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: 'Failed to record refund re_1: ref fail' }]);
    expect(mockOps.filter((o) => o.table === PR)).toHaveLength(1);
    expect(mockCalls).toEqual([]);
  });

  it.each([
    ['F2', 'payment-intent-succeeded', {}, 'Failed to record payment pi_website_1: dup'],
    ['H5', 'invoice-paid', { [`${PI}:select:1`]: ok(invoiceRow()) }, 'Failed to record payment for invoice pinv-0001: dup'],
    ['I2', 'checkout-completed-invoice', { [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002' })) }, 'Failed to record payment for invoice pinv-0002: dup'],
  ] as const)('%s: an insert error fails the delivery and the invoice is not marked paid', async (_s, fixture, rules, failure) => {
    const r = await run(fixture, { rules: { ...rules, [`${PT}:insert`]: dbError('dup') } });
    expect(r.status).toBe(500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: failure }]);
    expect(mockOps.filter((o) => o.table === PI && o.op === 'update')).toEqual([]);
  });
});

describe('QA CF-5 PR 3: tenant isolation on every owner-checked money write', () => {
  const refusals: Array<[string, Fixture, Run]> = [
    ['F2: metadata claims another owner', 'payment-intent-succeeded', { patch: (ev) => { (ev.data.object.metadata as Record<string, string>).owner_id = 'owner-b'; } }],
    ['F2: unmapped account', 'payment-intent-succeeded', { owners: {} }],
    ['G2: plan owned by another business', 'invoice-paid-plan-period', { pi: 'pi_plan_1', rules: { [`${PLANS}:select`]: ok(planRow({ user_id: 'owner-b' })) } }],
    ['G2: unmapped account', 'invoice-paid-plan-period', { owners: {}, pi: 'pi_plan_1', rules: { [`${PLANS}:select`]: ok(planRow()) } }],
    ['H4/#257/H5: invoice by Stripe id owned by another business', 'invoice-paid', { pi: 'pi_invoice_1', rules: { [`${PI}:select:1`]: ok(invoiceRow({ user_id: 'owner-b' })), [`${PT}:select`]: unattached } }],
    ['H4/#257/H5: invoice by metadata owned by another business', 'invoice-paid', { pi: 'pi_invoice_1', rules: { [`${PI}:select:2`]: ok(invoiceRow({ user_id: 'owner-b' })), [`${PT}:select`]: unattached } }],
    ['H4/#257/H5: unmapped account', 'invoice-paid', { owners: {}, pi: 'pi_invoice_1', rules: { [`${PI}:select:1`]: ok(invoiceRow()), [`${PT}:select`]: unattached } }],
    ['I2: invoice owned by another business', 'checkout-completed-invoice', { rules: { [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002', user_id: 'owner-b' })) } }],
    ['I2: unmapped account', 'checkout-completed-invoice', { owners: {}, rules: { [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002' })) } }],
  ];

  it.each(refusals)('%s: no money row is read or written, and the claim completes', async (_s, fixture, opts) => {
    const r = await run(fixture, opts);
    expect(r.status).toBe(200);
    expect(moneyOps()).toEqual([]);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
    expect(mockCalls).toEqual([]);
  });

  it('F2: the row carries the metadata owner only after it is proved, and its links are vetted', async () => {
    await run('payment-intent-succeeded');
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]).toMatchObject({ user_id: 'owner-a', contact_id: null, booking_id: null, service_id: null });
  });

  it('G2: the row carries the plan owner', async () => {
    await run('invoice-paid-plan-period', { pi: 'pi_plan_1', rules: { [`${PLANS}:select`]: ok(planRow({ user_id: 'owner-a' })), [`${PT}:insert`]: ok({ id: 'tx' }) } });
    expect(inserts().map((i) => i.user_id)).toEqual(['owner-a']);
  });

  it('H5: the row carries the invoice owner', async () => {
    await run('invoice-paid', { pi: 'pi_invoice_1', rules: { [`${PI}:select:1`]: ok(invoiceRow()) } });
    expect(inserts().map((i) => [i.user_id, i.invoice_id])).toEqual([['owner-a', 'pinv-0001']]);
  });

  it('I2: the row carries the invoice owner, not an owner_id in the session metadata', async () => {
    await run('checkout-completed-invoice', {
      patch: (ev) => { (ev.data.object.metadata as Record<string, string>).owner_id = 'owner-b'; },
      rules: { [`${PI}:select`]: ok(invoiceRow({ id: 'pinv-0002' })) },
    });
    expect(inserts().map((i) => i.user_id)).toEqual(['owner-a']);
  });

  it('#257: the attach writes only invoice_id, on the row found by the intent, for an owned invoice', async () => {
    await run('invoice-paid', { pi: 'pi_invoice_1', rules: { [`${PI}:select:1`]: ok(invoiceRow()), [`${PT}:select:2`]: unattached } });
    const attach = mockOps.filter((o) => o.table === PT && o.op === 'update');
    expect(attach.map((o) => o.chain)).toEqual([[['update', { invoice_id: 'pinv-0001' }], ['eq', 'id', 'tx-by-intent']]]);
    expect(inserts()).toEqual([]);
  });

  it('E2 (FU-3, unchanged): the refund row copies the owner from the payment row, not from the event account', async () => {
    await run('charge-refunded', { patch: (ev) => { ev.account = 'acct_foreign'; }, rules: { [`${PT}:select`]: ok([refundRow]) } });
    const rows = mockOps.filter((o) => o.table === PR).map((o) => o.chain[0][1] as Record<string, unknown>);
    expect(rows.map((x) => [x.user_id, x.transaction_id, x.invoice_id])).toEqual([
      ['owner-a', 'tx-1', 'pinv-1'],
      ['owner-a', 'tx-1', 'pinv-1'],
    ]);
  });
});

describe('QA CF-5 PR 3: value rules the harness fixtures do not reach', () => {
  it('E2: a zero-decimal refund is recorded in major units (no / 100), falling back to the payment currency', async () => {
    await run('charge-refunded', {
      patch: (ev) => {
        const refunds = (ev.data.object.refunds as { data: Array<Record<string, unknown>> }).data;
        refunds[0].currency = null;
        refunds[0].amount = 5000;
      },
      rules: { [`${PT}:select`]: ok([{ ...refundRow, currency: 'JPY' }]) },
    });
    const first = mockOps.find((o) => o.table === PR)?.chain;
    expect(first?.[0][1]).toMatchObject({ amount: 5000, amount_minor: 5000, currency: 'JPY', status: 'succeeded' });
    expect(first?.[0][2]).toEqual({ onConflict: 'processor_refund_id' });
  });

  it.each([
    ['opened keeps the status before the dispute', 'charge.dispute.created', 'needs_response', 'succeeded', null, 'disputed', 'succeeded'],
    ['won restores it', 'charge.dispute.closed', 'won', 'disputed', { status_before_dispute: 'refunded' }, 'refunded', 'refunded'],
    ['won with nothing kept restores succeeded', 'charge.dispute.closed', 'won', 'disputed', {}, 'succeeded', undefined],
    ['lost stays disputed and keeps it', 'charge.dispute.closed', 'lost', 'disputed', { status_before_dispute: 'refunded' }, 'disputed', 'refunded'],
    ['funds reinstated restores it', 'charge.dispute.funds_reinstated', 'needs_response', 'disputed', { status_before_dispute: 'refunded' }, 'refunded', 'refunded'],
  ] as const)('dispute: %s', async (_s, type, status, rowStatus, metadata, next, kept) => {
    await run('charge-dispute-created', {
      patch: (ev) => { ev.type = type; ev.data.object.status = status; },
      rules: { [`${PT}:select`]: ok([disputeRow({ status: rowStatus, metadata })]) },
    });
    const update = mockOps.filter((o) => o.table === PT && o.op === 'update');
    expect(update).toHaveLength(1);
    const payload = update[0].chain[0][1] as { status: string; metadata: Record<string, unknown>; updated_at: string };
    expect(payload.status).toBe(next);
    expect(payload.metadata.status_before_dispute).toBe(kept);
    expect(Object.keys(payload)).toEqual(['status', 'metadata', 'updated_at']);
    expect(update[0].chain[1]).toEqual(['eq', 'id', 'tx-1']);
  });
});
