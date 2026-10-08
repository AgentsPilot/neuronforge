/**
 * QA (CF-5 PR 1, claim table and client): what the characterisation harness
 * cannot see, pinned at the route.
 *
 *   1. The route's client IS the shared `supabaseServer`: with that module
 *      mocked, every query (the claim repository's and the route's remaining
 *      direct ones) reaches the mocked client, and loading the route constructs
 *      no Supabase client of its own.
 *   2. Throws, not error results. The harness answers every query with
 *      `{ data, error }` and records no logs, so it cannot tell a repository
 *      that catches from one that does not (SA ruling PR1-D1):
 *        - a thrown claim READ is a 500 with no claim written and nothing to
 *          release (a catch would turn it into "process without a claim");
 *        - a thrown claim RELEASE is logged "Could not release failed event"
 *          (a catch would silence it), and the 500 body stays generic;
 *        - a release that RETURNS an error is not logged (pre-existing, FU-9).
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md
 * (QA Testing Report, PR 1). No snapshots, no database, no Stripe.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { NextRequest } from 'next/server';

type Rule =
  | { answer: { data: unknown; error: unknown } }
  | { reject: unknown }
  | { delayMs: number; answer?: { data: unknown; error: unknown } };

interface DbOp {
  client: string;
  table: string;
  op: string;
  chain: unknown[][];
}

const mockOps: DbOp[] = [];
const mockLogs: Array<{ level: string; args: unknown[] }> = [];
const mockCreateClientCalls: unknown[][] = [];
/** `table:op` of every query whose answer has been delivered, in order. */
const mockSettled: string[] = [];
let mockRules: Record<string, Rule> = {};
let mockEvent: unknown = null;

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockBuilder(client: string, table: string, calls: unknown[][]): unknown {
  const resolve = () => {
    const w = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const op = w ? String(w[0]) : 'select';
    mockOps.push({ client, table, op, chain: calls });
    const key = `${table}:${op}`;
    const rule = mockRules[key];
    if (rule && 'delayMs' in rule) {
      return new Promise((done) =>
        setTimeout(() => {
          mockSettled.push(key);
          done(rule.answer ?? { data: null, error: null });
        }, rule.delayMs)
      );
    }
    mockSettled.push(key);
    if (rule && 'reject' in rule) return Promise.reject(rule.reject);
    return Promise.resolve(rule && 'answer' in rule ? rule.answer : { data: null, error: null });
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => resolve().then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve();
        return (...args: unknown[]) => mockBuilder(client, table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

// The shared service-role singleton, replaced by a client that tags its queries.
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (t: string) => mockBuilder('supabaseServer', t, []) },
  createServerSupabaseClient: () => ({ from: (t: string) => mockBuilder('supabaseServer', t, []) }),
}));
// Any OTHER client constructed would be a stray one: record it.
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    mockCreateClientCalls.push(args);
    return { from: (t: string) => mockBuilder('stray', t, []) };
  },
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
  resolveAccountOwner: () => Promise.resolve('owner-a'),
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
jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));
jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({ allocateQuotasForUser: () => Promise.resolve({ success: true }) })),
}));
jest.mock('@/lib/utils/pricingConfig', () => ({ pilotCreditsToTokens: (n: unknown) => Promise.resolve(Number(n) * 10) }));

const PWE = 'processed_webhook_events';
const EVENT_ID = 'evt_connect_invoice_finalized';
const finalized = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'connect', 'invoice-finalized.json'), 'utf8'));

async function run(rules: Record<string, Rule> = {}) {
  mockOps.length = 0;
  mockLogs.length = 0;
  mockCreateClientCalls.length = 0;
  mockSettled.length = 0;
  mockRules = rules;
  mockEvent = finalized();
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
  // What had been answered when POST returned, before any further tick.
  const settledAtResponse = [...mockSettled];
  await new Promise((r) => setImmediate(r));
  return { status: res.status, body: await res.json(), settledAtResponse };
}

const claimOps = () => mockOps.filter((o) => o.table === PWE);
const messages = () => mockLogs.map((l) => l.args.find((a) => typeof a === 'string'));
const logOf = (msg: string) => mockLogs.find((l) => l.args.includes(msg));
const GENERIC_500 = { success: false, error: 'Webhook processing failed' };

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, m).mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe('QA CF-5 PR 1: the route uses the shared supabaseServer client', () => {
  it('every query of a delivery reaches supabaseServer; the route constructs no client of its own', async () => {
    const r = await run({
      'payment_invoices:select': { answer: { data: { id: 'pinv-1', invoice_number: 'INV-1', user_id: 'owner-a' }, error: null } },
    });
    expect(r.status).toBe(200);
    expect(mockCreateClientCalls).toEqual([]);
    // The claim (repository) and a remaining direct query (supabaseAdmin alias) both ran ...
    expect(claimOps().map((o) => o.op)).toEqual(['select', 'insert', 'update']);
    expect(mockOps.some((o) => o.table !== PWE)).toBe(true);
    // ... and all of them on the shared client.
    expect(mockOps.filter((o) => o.client !== 'supabaseServer')).toEqual([]);
  });

  it('route.ts has no createClient, no supabase-js value import and no Supabase env read (comments excluded)', () => {
    const file = path.join(__dirname, '..', 'route.ts');
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const identifiers: string[] = [];
    const supabaseJsValueImports: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) identifiers.push(n.text);
      if (
        ts.isImportDeclaration(n) &&
        ts.isStringLiteral(n.moduleSpecifier) &&
        n.moduleSpecifier.text === '@supabase/supabase-js' &&
        !n.importClause?.isTypeOnly
      ) {
        supabaseJsValueImports.push(n.getText(sf));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(identifiers).not.toContain('createClient');
    expect(identifiers).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(identifiers).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(supabaseJsValueImports).toEqual([]);
  });
});

describe('QA CF-5 PR 1: claim throws keep the old route behaviour (no catch in the repository)', () => {
  it('a thrown claim read: 500, generic body, no claim written, nothing released', async () => {
    const r = await run({ [`${PWE}:select`]: { reject: new Error('socket hang up') } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    expect(claimOps().map((o) => o.op)).toEqual(['select']);
    expect(mockOps.filter((o) => o.table !== PWE)).toEqual([]);
    expect(messages()).toContain('Webhook processing failed');
    expect(messages()).not.toContain('Error checking for duplicate event');
    expect(messages()).not.toContain('Could not release failed event');
  });

  it('a handler throw releases the claim to failed with the message cut to 500 characters', async () => {
    const r = await run({ 'payment_invoices:select': { reject: new Error('m'.repeat(700)) } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    const release = claimOps()[claimOps().length - 1];
    expect(release.op).toBe('update');
    expect(release.chain).toEqual([
      ['update', { status: 'failed', failure_message: 'm'.repeat(500) }],
      ['eq', 'event_id', EVENT_ID],
    ]);
    expect(messages()).not.toContain('Could not release failed event');
  });

  it('a thrown release is logged "Could not release failed event" with the event id; body stays generic', async () => {
    const releaseError = new Error('connection reset');
    const r = await run({
      'payment_invoices:select': { reject: new Error('handler failed') },
      [`${PWE}:update`]: { reject: releaseError },
    });
    expect(r.status).toBe(500);
    expect(r.body).toEqual(GENERIC_500);
    const line = logOf('Could not release failed event');
    expect(line?.level).toBe('error');
    expect(line?.args[0]).toEqual({ err: releaseError, processedEventId: EVENT_ID });
    expect(JSON.stringify(r.body)).not.toContain('connection reset');
  });

  it('a release that RETURNS an error is not logged and still answers 500 (pre-existing, FU-9)', async () => {
    const r = await run({
      'payment_invoices:select': { reject: new Error('handler failed') },
      [`${PWE}:update`]: { answer: { data: null, error: { code: 'XX000', message: 'db down' } } },
    });
    expect(r.status).toBe(500);
    expect(claimOps().map((o) => o.op)).toEqual(['select', 'insert', 'update']);
    expect(messages()).not.toContain('Could not release failed event');
  });
});

describe('QA CF-5 PR 1: claim writes are awaited before the response', () => {
  // A serverless function may be frozen once it answers, so a claim write still
  // in flight at that point can be lost: an un-awaited completion leaves the row
  // `processing` and every later delivery is answered "duplicate". The harness
  // answers every query at once, so it cannot see a dropped `await`.
  it('the completion has been answered before POST returns 200', async () => {
    const r = await run({
      'payment_invoices:select': { answer: { data: { id: 'pinv-1', invoice_number: 'INV-1', user_id: 'owner-a' }, error: null } },
      [`${PWE}:update`]: { delayMs: 25 },
    });
    expect(r.status).toBe(200);
    expect(r.settledAtResponse).toContain(`${PWE}:update`);
  });

  it('the release has been answered before POST returns 500', async () => {
    const r = await run({
      'payment_invoices:select': { reject: new Error('handler failed') },
      [`${PWE}:update`]: { delayMs: 25 },
    });
    expect(r.status).toBe(500);
    expect(r.settledAtResponse).toContain(`${PWE}:update`);
  });

  it('the claim insert has been answered before the handler runs', async () => {
    const r = await run({
      [`${PWE}:insert`]: { delayMs: 25 },
      'payment_invoices:select': { answer: { data: { id: 'pinv-1', invoice_number: 'INV-1', user_id: 'owner-a' }, error: null } },
    });
    expect(r.status).toBe(200);
    const order = r.settledAtResponse;
    expect(order.indexOf(`${PWE}:insert`)).toBeGreaterThan(-1);
    expect(order.indexOf(`${PWE}:insert`)).toBeLessThan(order.indexOf('payment_invoices:select'));
  });
});
