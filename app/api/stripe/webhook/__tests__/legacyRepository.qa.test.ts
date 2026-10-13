/**
 * QA (CF-5 PR 5, agent-platform legacy tables): what the characterisation
 * harness cannot see, pinned at the route.
 *
 *   1. Throws, not error results. The harness answers every query with
 *      `{ data, error }`, so it cannot tell a call site that catches from one
 *      that does not. Inline, a legacy query that REJECTED (or threw) left the
 *      handler: 500, the claim released as `failed`, Stripe retried. That must
 *      still hold at all 11 converted sites, and nothing downstream may run.
 *   2. Returned errors keep their old handling (ignored, logged, or a default:
 *      the grace period falls back to 3 days).
 *   3. Owner scoping: every `user_subscriptions` write is filtered by exactly
 *      the event's own `metadata.user_id`, every insert carries it, and an
 *      event with no `user_id` touches no legacy table.
 *   4. The three helpers still get the shared `supabaseServer` object (the
 *      removed alias pointed at it), not another client.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 5). No snapshots, no database, no Stripe network.
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
  terminal: string;
}

const mockOps: DbOp[] = [];
const mockLogs: Array<{ level: string; args: unknown[] }> = [];
const mockHelperClients: Array<{ helper: string; client: unknown }> = [];
const mockCounts: Record<string, number> = {};
let mockRules: Record<string, Rule> = {};
let mockEvent: unknown = null;
let mockDispatch: string | null = null;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = (terminal: string) => {
    const w = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const op = w ? String(w[0]) : 'select';
    mockOps.push({ table, op, chain: calls, terminal });
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
              p = resolve('await');
            } catch (e) {
              p = Promise.reject(e);
            }
            return p.then(f, r);
          };
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve(String(prop));
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

jest.mock('@/lib/supabaseServer', () => {
  const client = { from: (t: string) => mockBuilder(t, []) };
  return { supabaseServer: client, createServerSupabaseClient: () => ({ from: (t: string) => mockBuilder(t, []) }) };
});
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
// The legacy dunning handler is out of reach of POST today (the router keeps
// platform invoices away from it), so its scenarios override the router's
// outcome, as the harness's X2/X3 do.
jest.mock('@/lib/business-os/billing/webhookDispatcher', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/webhookDispatcher');
  return {
    ...actual,
    dispatchBusinessOsEvent: (...args: unknown[]) =>
      mockDispatch ? Promise.resolve({ kind: mockDispatch }) : actual.dispatchBusinessOsEvent(...args),
  };
});
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => ({ constructWebhookEvent: () => mockEvent }) }));
jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: (client: unknown) => {
    mockHelperClients.push({ helper: 'resolveAccountOwner', client });
    return Promise.resolve('owner-a');
  },
}));
jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));
jest.mock('@/lib/payments/invoicePaymentIntent', () => ({ resolveInvoicePaymentIntent: () => Promise.resolve(null) }));
jest.mock('@/lib/payments/bindPlanSubscription', () => ({ bindPlanSubscription: () => Promise.resolve({}) }));
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
  QuotaAllocationService: jest.fn().mockImplementation((client: unknown) => {
    mockHelperClients.push({ helper: 'QuotaAllocationService', client });
    return { allocateQuotasForUser: () => Promise.resolve({ success: true }) };
  }),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({
  pilotCreditsToTokens: (n: unknown, client: unknown) => {
    mockHelperClients.push({ helper: 'pilotCreditsToTokens', client });
    return Promise.resolve(Number(n) * 10);
  },
}));

// Each scenario loads the route afresh (isolateModules); the first load is slow on a busy runner.
jest.setTimeout(30000);

const PWE = 'processed_webhook_events';
const US = 'user_subscriptions';
const SSC = 'system_settings_config';
const BE = 'billing_events';
const CT = 'credit_transactions';
const BPP = 'boost_pack_purchases';
const LEGACY_TABLES = [US, SSC, BE, CT, BPP];
const GENERIC_500 = { success: false, error: 'Webhook processing failed' };

const ok = (data: unknown): Answer => ({ data, error: null });
const dbError = (message: string): Answer => ({ data: null, error: { code: 'XX000', message, details: null, hint: null } });
const rejects = (): Rule => ({ reject: new Error('socket hang up') });
const throwsSync = (): Rule => ({ throwSync: new TypeError('sync explode') });

type Fixture = 'dunning' | 'boost' | 'sub-updated' | 'sub-deleted' | 'connect';
const FIXTURES: Record<Fixture, string> = {
  dunning: 'platform/invoice-payment-failed-unknown-price.json',
  boost: 'platform/checkout-completed-boost-pack.json',
  'sub-updated': 'platform/subscription-updated-legacy.json',
  'sub-deleted': 'platform/subscription-deleted-legacy.json',
  connect: 'connect/invoice-finalized.json',
};
/** The `metadata.user_id` each platform fixture carries. */
const OWNER: Record<Exclude<Fixture, 'connect'>, string> = {
  dunning: 'victim-user',
  boost: 'buyer-user',
  'sub-updated': 'agent-platform-user',
  'sub-deleted': 'agent-platform-user',
};

interface FixtureEvent {
  data: { object: Record<string, unknown> & { metadata: Record<string, unknown> } };
}

let supabaseServerNow: unknown = null;

async function run(fixture: Fixture, rules: Record<string, Rule> = {}, patch?: (ev: FixtureEvent) => void) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockHelperClients.length = 0;
  for (const k of Object.keys(mockCounts)) delete mockCounts[k];
  mockRules = rules;
  mockDispatch = fixture === 'dunning' ? 'not_business_os' : null;
  const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', FIXTURES[fixture]), 'utf8'));
  patch?.(ev);
  mockEvent = ev;
  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('route not loaded');
  };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- fresh module per scenario */
    supabaseServerNow = require('@/lib/supabaseServer').supabaseServer;
    POST = require('../route').POST;
    /* eslint-enable @typescript-eslint/no-require-imports */
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
}

const claimRelease = () =>
  mockOps.filter((o) => o.table === PWE && o.op === 'update').map((o) => o.chain[0][1] as { status: string; failure_message?: string });
const legacyOps = () => mockOps.filter((o) => LEGACY_TABLES.includes(o.table));
const nonClaimOps = () => mockOps.filter((o) => o.table !== PWE);
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));
const writesTo = (table: string) => mockOps.filter((o) => o.table === table && WRITE_OPS.has(o.op));
const rowOf = (o: DbOp) => o.chain[0][1] as Record<string, unknown>;
const filters = (o: DbOp) => o.chain.filter((c) => !['update', 'insert', 'select'].includes(String(c[0])));
const noUserId = (ev: FixtureEvent) => {
  delete ev.data.object.metadata.user_id;
};

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
  ['A1 findDunningState', 'dunning', `${US}:select`, {}],
  ['A2 findRawValue', 'dunning', `${SSC}:select`, {}],
  ['A3 recordPaymentFailure', 'dunning', `${US}:update`, {}],
  ['A4 billingEventRepository.insert (renewal_failed)', 'dunning', `${BE}:insert`, {}],
  ['B2 findBalance', 'boost', `${US}:select`, {}],
  ['B3 applyBoostPackBalance', 'boost', `${US}:update`, {}],
  ['B4 insertReturningId', 'boost', `${CT}:insert`, {}],
  ['B5 legacyBoostPackPurchaseRepository.insert', 'boost', `${BPP}:insert`, { [`${CT}:insert`]: ok({ id: 'ctx-1' }) }],
  ['C1 mirrorStripeStatus', 'sub-updated', `${US}:update`, {}],
  ['N1 markCanceled', 'sub-deleted', `${US}:update`, {}],
  ['N2 billingEventRepository.insert (subscription_canceled)', 'sub-deleted', `${BE}:insert`, {}],
];

describe('QA CF-5 PR 5: a rejected or thrown query at a legacy site still fails the delivery (500, claim failed)', () => {
  const cases = SITES.flatMap(([site, fixture, key, rules]) => [
    [`${site}: rejects`, fixture, key, { ...rules, [key]: rejects() }, 'socket hang up'] as const,
    [`${site}: throws synchronously`, fixture, key, { ...rules, [key]: throwsSync() }, 'sync explode'] as const,
  ]);

  it.each(cases)('%s', async (_site, fixture, key, rules, message) => {
    const r = await run(fixture, rules);
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimRelease()).toEqual([{ status: 'failed', failure_message: message }]);
    expect(messages()).toContain('Webhook processing failed');
    // The failed query is the last thing the handler did: nothing downstream ran.
    const last = nonClaimOps().at(-1);
    expect(`${last?.table}:${last?.op}`).toBe(key);
  });
});

describe('QA CF-5 PR 5: returned errors and defaults keep their old handling', () => {
  const dunningRow = () => rowOf(writesTo(BE)[0]);

  it('A1 error: read as no row; retry 1; the grace period comes from config, else 3 days', async () => {
    const r = await run('dunning', { [`${US}:select`]: dbError('no row') });
    expect(r.status).toBe(200);
    expect(rowOf(writesTo(US)[0])).toMatchObject({ payment_retry_count: 1, status: 'active', agents_paused: false });
    expect(mockOps.filter((o) => o.table === SSC)).toHaveLength(1);
    expect(dunningRow().description).toBe('Payment failed (attempt 1). Grace period active (3 days).');
  });

  it('A2 error: the grace period defaults to 3 days', async () => {
    await run('dunning', { [`${SSC}:select`]: dbError('cfg') });
    expect(dunningRow().description).toBe('Payment failed (attempt 1). Grace period active (3 days).');
  });

  it('A2 hit: the config value is used; a per-user grace skips the config read', async () => {
    await run('dunning', { [`${SSC}:select`]: ok({ value: '7' }) });
    expect(dunningRow().description).toBe('Payment failed (attempt 1). Grace period active (7 days).');
    await run('dunning', { [`${US}:select`]: ok({ payment_retry_count: 2, grace_period_days: 5, current_period_end: null }) });
    expect(mockOps.filter((o) => o.table === SSC)).toHaveLength(0);
    expect(dunningRow().description).toBe('Payment failed (attempt 3). Grace period active (5 days).');
  });

  it('past the default 3-day grace: past_due, agents paused', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    await run('dunning', { [`${US}:select`]: ok({ payment_retry_count: null, grace_period_days: null, current_period_end: fiveDaysAgo }) });
    expect(rowOf(writesTo(US)[0])).toMatchObject({ status: 'past_due', agents_paused: true });
    expect(dunningRow().description).toBe('Payment failed (attempt 1). Agents paused due to grace period exceeded.');
  });

  it('A3 and A4 errors are ignored: 200, claim completed', async () => {
    const r = await run('dunning', { [`${US}:update`]: dbError('upd'), [`${BE}:insert`]: dbError('ins') });
    expect(r.status).toBe(200);
    expect(writesTo(BE)).toHaveLength(1);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('the dunning billing row is kept byte for byte, stripe_event_id: invoice.id included (FU-1)', async () => {
    await run('dunning');
    expect(Object.keys(dunningRow())).toEqual([
      'user_id', 'event_type', 'credits_delta', 'description', 'stripe_event_id', 'stripe_invoice_id', 'amount_cents', 'currency',
    ]);
    expect(dunningRow()).toMatchObject({
      user_id: 'victim-user', event_type: 'renewal_failed', credits_delta: 0,
      stripe_event_id: 'in_platform_failed', stripe_invoice_id: 'in_platform_failed', amount_cents: 2000, currency: 'usd',
    });
  });

  it('B2 error: read as a zero balance; B3 error ignored; the ledger row is still written', async () => {
    const r = await run('boost', { [`${US}:select`]: dbError('bal'), [`${US}:update`]: dbError('upd'), [`${CT}:insert`]: ok({ id: 'ctx-1' }) });
    expect(r.status).toBe(200);
    expect(rowOf(writesTo(US)[0])).toEqual({ balance: 10000, total_earned: 10000, free_tier_expires_at: null, account_frozen: false });
    expect(rowOf(writesTo(CT)[0])).toMatchObject({ balance_before: 0, balance_after: 10000 });
  });

  it('B4 error: logged; the purchase row is still written with transaction_id null', async () => {
    const r = await run('boost', { [`${CT}:insert`]: dbError('ct') });
    expect(r.status).toBe(200);
    expect(messages()).toContain('Failed to create credit transaction for boost pack');
    expect(rowOf(writesTo(BPP)[0])).toMatchObject({ transaction_id: null });
  });

  it('B4 hit: the ledger id reaches the purchase row; insert then select(id) then single', async () => {
    await run('boost', { [`${US}:select`]: ok({ balance: 2500, total_earned: 9000 }), [`${CT}:insert`]: ok({ id: 'ctx-9' }) });
    const [ct] = writesTo(CT);
    expect(ct.chain.map((c) => c[0])).toEqual(['insert', 'select']);
    expect(ct.chain[1]).toEqual(['select', 'id']);
    expect(ct.terminal).toBe('single');
    expect(rowOf(writesTo(BPP)[0])).toMatchObject({ transaction_id: 'ctx-9', credits_purchased: 10000, price_paid_usd: 10 });
  });

  it('B5 error: logged, the delivery completes', async () => {
    const r = await run('boost', { [`${CT}:insert`]: ok({ id: 'ctx-1' }), [`${BPP}:insert`]: dbError('bpp') });
    expect(r.status).toBe(200);
    expect(messages()).toContain('Failed to insert into boost_pack_purchases');
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('no boost_pack_id: no purchase row', async () => {
    await run('boost', { [`${CT}:insert`]: ok({ id: 'ctx-1' }) }, (ev) => {
      delete ev.data.object.metadata.boost_pack_id;
    });
    expect(writesTo(BPP)).toEqual([]);
    expect(writesTo(CT)).toHaveLength(1);
  });

  it('C1, N1 and N2 errors are ignored: 200, claim completed; N2 still written after an N1 error', async () => {
    let r = await run('sub-updated', { [`${US}:update`]: dbError('c1') });
    expect(r.status).toBe(200);
    r = await run('sub-deleted', { [`${US}:update`]: dbError('n1'), [`${BE}:insert`]: dbError('n2') });
    expect(r.status).toBe(200);
    expect(writesTo(BE)).toHaveLength(1);
    expect(claimRelease()).toEqual([expect.objectContaining({ status: 'completed' })]);
  });

  it('the cancellation billing row has its four keys only', async () => {
    await run('sub-deleted');
    expect(rowOf(writesTo(BE)[0])).toEqual({
      user_id: 'agent-platform-user', event_type: 'subscription_canceled', credits_delta: 0, description: 'Subscription canceled',
    });
  });
});

describe('QA CF-5 PR 5: owner scoping (tenant isolation)', () => {
  it.each(['dunning', 'boost', 'sub-updated', 'sub-deleted'] as const)(
    '%s: every user_subscriptions query has exactly one filter, user_id = the event metadata user; every insert carries it',
    async (fixture) => {
      await run(fixture, { [`${CT}:insert`]: ok({ id: 'ctx-1' }) });
      const owner = OWNER[fixture];
      const us = mockOps.filter((o) => o.table === US);
      expect(us.length).toBeGreaterThan(0);
      for (const o of us) expect(filters(o)).toEqual([['eq', 'user_id', owner]]);
      const inserts = legacyOps().filter((o) => o.op === 'insert');
      for (const o of inserts) expect(rowOf(o).user_id).toBe(owner);
      // Nothing is written for anyone else.
      for (const o of legacyOps().filter((x) => WRITE_OPS.has(x.op))) {
        expect(JSON.stringify(o.chain)).not.toMatch(/"user_id","(?!victim-user|buyer-user|agent-platform-user)/);
      }
    }
  );

  it.each(['dunning', 'boost', 'sub-updated', 'sub-deleted'] as const)('%s with no metadata user_id: no legacy table is touched', async (fixture) => {
    const r = await run(fixture, {}, noUserId);
    expect(r.status).toBe(200);
    expect(legacyOps()).toEqual([]);
  });

  it('the dunning config read is by its fixed key only', async () => {
    await run('dunning');
    const [cfg] = mockOps.filter((o) => o.table === SSC);
    expect(cfg.chain).toEqual([['select', 'value'], ['eq', 'key', 'payment_grace_period_days']]);
    expect(cfg.terminal).toBe('maybeSingle');
  });
});

describe('QA CF-5 PR 5: the helpers get the shared supabaseServer client (the removed alias pointed at it)', () => {
  it('boost checkout: pilotCreditsToTokens and QuotaAllocationService', async () => {
    await run('boost', { [`${CT}:insert`]: ok({ id: 'ctx-1' }) });
    expect(mockHelperClients.map((h) => h.helper)).toEqual(['pilotCreditsToTokens', 'QuotaAllocationService']);
    for (const h of mockHelperClients) expect(h.client).toBe(supabaseServerNow);
  });

  it('Connect event: resolveAccountOwner', async () => {
    await run('connect', { 'payment_invoices:select': ok({ id: 'pinv-1', invoice_number: 'INV-1', user_id: 'owner-a' }) });
    expect(mockHelperClients.map((h) => h.helper)).toEqual(['resolveAccountOwner']);
    expect(mockHelperClients[0].client).toBe(supabaseServerNow);
  });
});
