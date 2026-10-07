/**
 * QA (FU-5): a failed account-owner lookup is retried by Stripe, never refused.
 *
 * Driven through the REAL route and the REAL `resolveAccountOwner`. Only the
 * Supabase client, Stripe and the logger are faked. The fake database is a small
 * in-memory PostgREST (adapted from `planOwnership.qa.test.ts`) that keeps state
 * between calls, records every operation as an effect, and can:
 *
 *   - fail the owner-lookup read on `stripe_connect_accounts` or
 *     `plugin_connections` with a PostgREST-shaped error;
 *   - hold any operation at a gate until the test releases it, so two requests
 *     on one warm module instance can be interleaved at their awaits.
 *
 * Every write the route or a repository makes goes through the fake, so a "no
 * write" assertion here is real (SA code-review finding 3): each site case runs
 * a mapped control first and shows that the same path DOES record its write.
 *
 * `ROUTE_PATH` / `RESOLVER_PATH` are the only paths that name the code under
 * test. QA re-pointed them at the pre-FU-5 code (base 0f3dd447) in a temporary
 * copy to show which cases the fix changes.
 *
 * Optional: `QA_FU5_TRACE=<file>` appends a normalised trace of the cases tagged
 * `trace(...)`, so the mapped / unmapped outcomes can be diffed old vs new.
 *
 * No snapshots.
 */

import fs from 'fs';
import { NextRequest } from 'next/server';

const ROUTE_PATH = '../route';
const RESOLVER_PATH = '@/lib/payments/stripeAccountContext';

// ─── Fake database ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Filter = [kind: string, column: string, value: unknown];
type Answer = { data: unknown; error: unknown; count?: number | null };

interface Op {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  cols?: string;
  opts?: Record<string, unknown>;
  payload?: unknown;
  filters: Filter[];
  order?: [string, boolean];
  limit?: number;
  returning: boolean;
}

type Effect = Record<string, unknown> & { type: string };
type PgError = { code?: string; message: string; details?: string; hint?: string | null };

const mockEffects: Effect[] = [];
const mockLogLines: Array<{ module: string; level: string; ctx: Record<string, unknown>; msg: unknown }> = [];
const mockDb: { tables: Record<string, Row[]>; ownerReadError: Record<string, PgError | undefined>; seq: number } = {
  tables: {},
  ownerReadError: {},
  seq: 0,
};
let mockEvent: unknown = null;

/** Holds the first matching operation until released; `reached` resolves when it is hit. */
interface Gate {
  match: (op: Op) => boolean;
  reached: Promise<void>;
  hit: () => void;
  release: () => void;
  released: Promise<void>;
}
const mockGates: Gate[] = [];

const MOCK_OWNER_TABLES = ['stripe_connect_accounts', 'plugin_connections'];

/** Columns typed `uuid` in the tables these paths touch. */
const MOCK_UUID_COLUMNS: Record<string, string[]> = {
  scheduling_bookings: ['id', 'contact_id', 'payment_plan_id'],
  scheduling_services: ['id'],
  payment_plans: ['id', 'service_id'],
  crm_contacts: ['id'],
  payment_plan_subscriptions: ['booking_id', 'service_id', 'payment_plan_id', 'contact_id'],
  payment_plan_installments: ['booking_id', 'payment_plan_id', 'contact_id'],
  payment_transactions: ['booking_id', 'service_id', 'contact_id'],
};

const MOCK_DEFAULTS: Record<string, Row> = {
  payment_plan_subscriptions: { periods_paid: 0, stripe_subscription_id: null, stripe_schedule_id: null },
};

function mockPgUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let s = value;
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) return null;
    s = s.slice(1, -1);
  }
  if (!/^([0-9a-f]{4}-?){7}[0-9a-f]{4}$/i.test(s)) return null;
  const hex = s.replace(/-/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const mockUuidError = (value: unknown): Answer => ({
  data: null,
  error: { code: '22P02', message: `invalid input syntax for type uuid: "${String(value)}"` },
  count: null,
});

function mockExec(op: Op, terminal: string): Answer {
  mockEffects.push({ type: 'db', ...op, terminal });
  const rows = (mockDb.tables[op.table] ??= []);
  const uuidCols = MOCK_UUID_COLUMNS[op.table] ?? [];

  // FU-5: the owner lookup's read fails (network blip, statement timeout, ...).
  const ownerErr = mockDb.ownerReadError[op.table];
  if (op.action === 'select' && MOCK_OWNER_TABLES.includes(op.table) && ownerErr) {
    return { data: null, error: ownerErr, count: null };
  }

  for (const [kind, col, val] of op.filters) {
    if (kind === 'eq' && uuidCols.includes(col) && mockPgUuid(val) === null) return mockUuidError(val);
  }

  const matches = (row: Row) =>
    op.filters.every(([kind, col, val]) => {
      const rv = row[col];
      switch (kind) {
        case 'eq':
          return uuidCols.includes(col) ? rv === mockPgUuid(val) : rv === val;
        case 'neq':
          return rv !== val;
        case 'is':
          return val === null ? rv === null || rv === undefined : rv === val;
        case 'in':
          return Array.isArray(val) && val.includes(rv);
        default:
          return true;
      }
    });

  const canonicalise = (row: Row): Answer | null => {
    for (const col of uuidCols) {
      if (row[col] === null || row[col] === undefined) continue;
      const canonical = mockPgUuid(row[col]);
      if (!canonical) return mockUuidError(row[col]);
      row[col] = canonical;
    }
    return null;
  };

  let result: Row[];
  if (op.action === 'insert' || op.action === 'upsert') {
    const list = (Array.isArray(op.payload) ? op.payload : [op.payload]) as Row[];
    const staged: Row[] = [];
    for (const p of list) {
      const row: Row = { ...(MOCK_DEFAULTS[op.table] ?? {}), ...p };
      const bad = canonicalise(row);
      if (bad) return bad;
      if (!row.id) row.id = `${op.table}-${++mockDb.seq}`;
      staged.push(row);
    }
    rows.push(...staged);
    result = staged;
  } else if (op.action === 'update') {
    const patch = { ...(op.payload as Row) };
    const bad = canonicalise(patch);
    if (bad) return bad;
    result = rows.filter(matches);
    for (const row of result) Object.assign(row, patch);
  } else if (op.action === 'delete') {
    result = rows.filter(matches);
    mockDb.tables[op.table] = rows.filter((r) => !result.includes(r));
  } else {
    result = rows.filter(matches);
    if (op.order) {
      const [col, asc] = op.order;
      result = [...result].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (op.limit !== undefined) result = result.slice(0, op.limit);
  }

  const count = op.opts?.count === 'exact' ? result.length : null;
  if (op.opts?.head) return { data: null, error: null, count };
  if (op.action !== 'select' && !op.returning && terminal === 'await') return { data: null, error: null, count };

  const copy = result.map((r) => ({ ...r }));
  if (terminal === 'single') {
    return copy.length === 1
      ? { data: copy[0], error: null, count }
      : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count };
  }
  if (terminal === 'maybeSingle') return { data: copy[0] ?? null, error: null, count };
  return { data: copy, error: null, count };
}

/** Runs an operation, holding it first if a gate matches. Evaluated AFTER release, against current state. */
function mockRun(op: Op, terminal: string): Promise<Answer> {
  const i = mockGates.findIndex((g) => g.match(op));
  if (i < 0) return Promise.resolve(mockExec(op, terminal));
  const [gate] = mockGates.splice(i, 1);
  gate.hit();
  return gate.released.then(() => mockExec(op, terminal));
}

function mockBuilder(op: Op): unknown {
  const next = (patch: Partial<Op>) => mockBuilder({ ...op, ...patch, filters: patch.filters ?? op.filters });
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => mockRun(op, 'await').then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => mockRun(op, String(prop));
        return (...args: unknown[]) => {
          switch (prop) {
            case 'select':
              return op.action === 'select'
                ? next({ cols: args[0] as string, opts: { ...(op.opts ?? {}), ...((args[1] as object) ?? {}) } })
                : next({ returning: true });
            case 'insert':
            case 'update':
            case 'upsert':
            case 'delete':
              return next({ action: prop, payload: args[0], opts: { ...(op.opts ?? {}), ...((args[1] as object) ?? {}) } });
            case 'eq':
            case 'neq':
            case 'is':
            case 'in':
              return next({ filters: [...op.filters, [prop, String(args[0]), args[1]]] });
            case 'order':
              return next({ order: [String(args[0]), (args[1] as { ascending?: boolean } | undefined)?.ascending !== false] });
            case 'limit':
              return next({ limit: Number(args[0]) });
            default:
              return next({ filters: [...op.filters, [String(prop), String(args[0]), args[1]]] });
          }
        };
      },
    }
  );
}

const mockSupabase = {
  from: (table: string) => mockBuilder({ table, action: 'select', filters: [], returning: false }),
  rpc: (fn: string) => {
    mockEffects.push({ type: 'rpc', fn });
    return Promise.resolve({ data: null, error: null });
  },
};

// ─── Fake Stripe ────────────────────────────────────────────────────────────

const SCHEDULE_START = 1790000000;

function mockStripeClient() {
  const rec =
    (method: string, impl: (...a: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) => {
      mockEffects.push({ type: 'stripe', method, args });
      return impl(...args);
    };
  const schedule = (id: string) => ({
    id,
    phases: [{ items: [{ price: 'price_plan_period', quantity: 1 }], start_date: SCHEDULE_START }],
  });
  const unreachable = () => Promise.reject(new Error('not modelled by the QA fake'));
  return {
    subscriptions: { retrieve: rec('subscriptions.retrieve', (id) => Promise.resolve({ id, schedule: null })) },
    subscriptionSchedules: {
      create: rec('subscriptionSchedules.create', (p) =>
        Promise.resolve(schedule(`sub_sched_${(p as { from_subscription: string }).from_subscription}`))
      ),
      retrieve: rec('subscriptionSchedules.retrieve', (id) => Promise.resolve(schedule(String(id)))),
      update: rec('subscriptionSchedules.update', (id) => Promise.resolve({ id })),
    },
    invoices: { retrieve: rec('invoices.retrieve', unreachable) },
    paymentIntents: { retrieve: rec('paymentIntents.retrieve', unreachable) },
    charges: { retrieve: rec('charges.retrieve', unreachable) },
    balanceTransactions: { retrieve: rec('balanceTransactions.retrieve', unreachable) },
  };
}

// ─── Module mocks ───────────────────────────────────────────────────────────

jest.mock('@/lib/logger', () => {
  const make = (bindings: Record<string, unknown>): Record<string, unknown> => {
    const at = (level: string) => (ctx: unknown, msg?: unknown) => {
      if (typeof ctx === 'string') {
        msg = ctx;
        ctx = {};
      }
      mockLogLines.push({
        module: String(bindings.module ?? bindings.service ?? ''),
        level,
        ctx: { ...bindings, ...((ctx ?? {}) as Record<string, unknown>) },
        msg,
      });
    };
    const l: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
    };
    l.child = (b: Record<string, unknown>) => make({ ...bindings, ...(b ?? {}) });
    return l;
  };
  return { createLogger: (b?: Record<string, unknown>) => make(b ?? {}) };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));

jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripeClient()));

jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({ constructWebhookEvent: () => mockEvent }),
}));

// ─── Data ───────────────────────────────────────────────────────────────────

const OWNER = 'owner-a';
const OTHER = 'owner-b';
/** Express-mapped (stripe_connect_accounts). */
const ACCOUNT = 'acct_owner_a';
/** OAuth-mapped (plugin_connections.profile_data only), so the second table is read. */
const OAUTH_ACCOUNT = 'acct_oauth_a';
const UNMAPPED = 'acct_unmapped';

const OWN_CONTACT = 'c1c1c1c1-0c0c-4000-8000-0000000000c1';
const OWN_BOOKING = 'a1a1a1a1-0b0b-4000-8000-0000000000b1';
const OWN_SERVICE = 'a1a1a1a1-05e5-4000-8000-0000000000e1';
const OWN_PLAN = 'a1a1a1a1-0a1a-4000-8000-0000000000a2';

const INVOICE_ID = 'pinv-1';
const STRIPE_INVOICE = 'in_connect_final_1';
const PLAN_SUB = 'sub_plan_1';
const PLAN_ROW_ID = 'plan-row-1';

const LOOKUP_ERROR: PgError = {
  code: 'XX000',
  // Deliberately full of things that must NOT reach failure_message.
  message: `connection reset by peer while reading ${ACCOUNT} for ${OWNER}`,
  details: `row user_id=${OWNER}`,
  hint: null,
};

const INVOICE_ROW = {
  id: INVOICE_ID, invoice_number: 'INV-1', user_id: OWNER, stripe_invoice_id: STRIPE_INVOICE,
  status: 'sent', stripe_hosted_invoice_url: null, stripe_invoice_pdf: null,
};

function planSubRow(userId: string): Row {
  return {
    id: PLAN_ROW_ID, user_id: userId, stripe_subscription_id: PLAN_SUB, status: 'active', installment_count: 3,
    periods_paid: 1, currency: 'USD', contact_id: null, booking_id: null, service_id: null, payment_plan_id: null,
  };
}

function seed(planOwner: string = OWNER) {
  mockDb.seq = 0;
  mockDb.ownerReadError = {};
  mockGates.length = 0;
  mockDb.tables = {
    stripe_connect_accounts: [{ stripe_account_id: ACCOUNT, user_id: OWNER }],
    plugin_connections: [
      { user_id: OWNER, plugin_key: 'stripe', status: 'active', profile_data: { stripe_account_id: OAUTH_ACCOUNT } },
    ],
    payment_invoices: [{ ...INVOICE_ROW }],
    scheduling_bookings: [
      { id: OWN_BOOKING, user_id: OWNER, contact_id: OWN_CONTACT, payment_status: 'pending', payment_plan_id: null, status: 'confirmed' },
    ],
    scheduling_services: [{ id: OWN_SERVICE, user_id: OWNER }],
    payment_plans: [{ id: OWN_PLAN, user_id: OWNER, service_id: OWN_SERVICE, is_active: true, created_at: '2026-01-01T00:00:00Z' }],
    payment_plan_subscriptions: [planSubRow(planOwner)],
    payment_plan_installments: [1, 2, 3].map((n) => ({
      id: `inst-${n}`, user_id: planOwner, subscription_id: PLAN_ROW_ID, installment_number: n,
      status: n === 1 ? 'paid' : 'pending', amount: 300, due_date: `2026-0${n}-01`,
    })),
    payment_transactions: [],
    processed_webhook_events: [],
  };
}

// ─── Events ─────────────────────────────────────────────────────────────────

function finalizedEvent(id = 'evt_fu5_final', account = ACCOUNT) {
  return {
    id, object: 'event', type: 'invoice.finalized', account, livemode: false, created: 1790000600,
    data: {
      object: {
        id: STRIPE_INVOICE, object: 'invoice', currency: 'usd',
        hosted_invoice_url: `https://invoice.stripe.test/i/${STRIPE_INVOICE}`,
        invoice_pdf: `https://invoice.stripe.test/i/${STRIPE_INVOICE}/pdf`,
        metadata: {}, parent: null,
      },
    },
  };
}

function subscriptionInvoice(type: string, id: string, metadata: Record<string, string> = {}) {
  return {
    id, object: 'event', type, account: ACCOUNT, livemode: false, created: 1790000700,
    data: {
      object: {
        id: 'in_plan_period_2', object: 'invoice', customer: { id: 'cus_qa' }, currency: 'usd',
        amount_paid: 30000, amount_due: 30000, total: 30000, metadata: {},
        parent: { type: 'subscription_details', subscription_details: { subscription: PLAN_SUB, metadata } },
      },
    },
  };
}

function subscriptionDeletedEvent(id: string) {
  return {
    id, object: 'event', type: 'customer.subscription.deleted', account: ACCOUNT, livemode: false, created: 1790000800,
    data: { object: { id: PLAN_SUB, object: 'subscription', status: 'canceled', customer: 'cus_qa', metadata: {} } },
  };
}

/** First period of a booking-modal plan: checks the owner at the bind (:1222) AND in recordPlanPeriodPaid (:809). */
function firstPeriodEvent(id: string, sub = 'sub_qa_modal') {
  return {
    id, object: 'event', type: 'invoice.paid', account: ACCOUNT, livemode: false, created: 1790000700,
    data: {
      object: {
        id: `in_first_${sub}`, object: 'invoice', customer: { id: 'cus_qa' }, currency: 'usd',
        amount_paid: 30000, amount_due: 30000, total: 30000, metadata: {},
        parent: {
          type: 'subscription_details',
          subscription_details: {
            subscription: sub,
            metadata: {
              plan_count: '3', plan_total: '900', plan_currency: 'USD', plan_frequency: 'monthly', owner_id: OWNER,
              booking_id: OWN_BOOKING, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN,
            },
          },
        },
      },
    },
  };
}

// ─── Running ────────────────────────────────────────────────────────────────

type Post = (req: NextRequest) => Promise<Response>;

function loadRoute(): Post {
  let POST: Post = async () => {
    throw new Error('route not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module (owner cache) per load
    POST = require(ROUTE_PATH).POST;
  });
  return POST;
}

function request() {
  return new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: JSON.stringify({ placeholder: true }),
    headers: { 'stripe-signature': 't=1790000000,v1=deadbeef' },
  });
}

async function post(POST: Post, event: unknown) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  mockEvent = event;
  const response = await POST(request());
  await new Promise((r) => setImmediate(r));
  return { status: response.status, body: await response.json(), effects: [...mockEffects], logs: [...mockLogLines] };
}

type Result = Awaited<ReturnType<typeof post>>;
type DbEffect = Effect & Op;

const dbOps = (effects: Effect[]) => effects.filter((e) => e.type === 'db') as DbEffect[];
const ownerReads = (effects: Effect[], table?: string) =>
  dbOps(effects).filter((e) => e.action === 'select' && MOCK_OWNER_TABLES.includes(e.table) && (!table || e.table === table));
/** Every DB write except the claim row, plus every Stripe call. */
const businessWrites = (effects: Effect[]) => [
  ...dbOps(effects).filter((e) => e.action !== 'select' && e.table !== 'processed_webhook_events'),
  ...effects.filter((e) => e.type === 'stripe' && !String(e.method).endsWith('.retrieve')),
];
const rowsOf = (table: string) => mockDb.tables[table] ?? [];
const claim = (eventId: string) => rowsOf('processed_webhook_events').find((r) => r.event_id === eventId);
const logged = (r: Result, msg: string) => r.logs.filter((l) => l.msg === msg);

function gate(match: (op: Op) => boolean): Gate {
  let hit!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((res) => (hit = res));
  const released = new Promise<void>((res) => (release = res));
  const g: Gate = { match, reached, hit, release, released };
  mockGates.push(g);
  return g;
}

const isOwnerRead = (table: string) => (op: Op) => op.action === 'select' && op.table === table;
const isInvoiceRead = (op: Op) => op.action === 'select' && op.table === 'payment_invoices';

function trace(name: string, r: Result) {
  const file = process.env.QA_FU5_TRACE;
  if (!file) return;
  const scrub = (_k: string, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v) ? '<date>' : v;
  const shape = {
    status: r.status,
    body: r.body,
    ops: dbOps(r.effects).map((w) => ({ table: w.table, action: w.action, cols: w.cols, payload: w.payload, filters: w.filters })),
    stripe: r.effects.filter((e) => e.type === 'stripe').map((c) => ({ method: c.method, args: c.args })),
    warnsAndErrors: r.logs.filter((l) => l.level === 'warn' || l.level === 'error').map((l) => l.msg),
    state: mockDb.tables,
  };
  fs.appendFileSync(file, `${name}\t${JSON.stringify(shape, scrub)}\n`);
}

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => undefined);
  }
});

beforeEach(() => seed());
afterAll(() => jest.restoreAllMocks());

/** The two lookup tables, each with the account that makes the resolver reach it. */
const TABLE_CASES: Array<[table: string, account: string]> = [
  ['stripe_connect_accounts', ACCOUNT],
  ['plugin_connections', OAUTH_ACCOUNT],
];

// ─── 1. Fresh delivery: a lookup error releases the claim ───────────────────

describe('FU-5 QA 1: fresh delivery, real resolver, a read error on either lookup table', () => {
  it.each(TABLE_CASES)('FD-%s. 500, claim failed with table + code only, nothing written', async (table, account) => {
    mockDb.ownerReadError[table] = LOOKUP_ERROR;
    const r = await post(loadRoute(), finalizedEvent('evt_fd', account));

    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'Webhook processing failed' });

    const row = claim('evt_fd')!;
    expect(row.status).toBe('failed');
    expect(row.failure_message).toBe(`Account owner lookup failed on ${table} (code XX000)`);
    for (const leak of [ACCOUNT, OAUTH_ACCOUNT, OWNER, 'connection reset', 'user_id']) {
      expect(String(row.failure_message)).not.toContain(leak);
    }

    // The thrown error carries no cause (deviation 2, stricter than C-3).
    const [failed] = logged(r, 'Webhook processing failed');
    const err = failed.ctx.err as Error & { cause?: unknown };
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(`Account owner lookup failed on ${table} (code XX000)`);
    expect(err.cause).toBeUndefined();

    // Real "nothing written": every route/repository write goes through the fake.
    expect(businessWrites(r.effects)).toEqual([]);
    expect(rowsOf('payment_invoices')).toEqual([INVOICE_ROW]);
    // The refusal and the "maps to no business" warning never ran.
    expect(logged(r, 'Connect invoice.finalized names an invoice owned by a different business - refusing')).toEqual([]);
    expect(logged(r, 'Connect account maps to no known business')).toEqual([]);

    // Lookup order kept: express first; the plugin table only after an express miss.
    const reads = ownerReads(r.effects).map((e) => e.table);
    expect(reads).toEqual(table === 'stripe_connect_accounts' ? ['stripe_connect_accounts'] : MOCK_OWNER_TABLES);
  });

  it.each<[string, PgError]>([
    ["code ''", { code: '', message: 'FetchError: network down' }],
    ['no code', { message: 'FetchError: network down' }],
  ])('FD-unknown (%s): failure_message ends "(code unknown)", never "(code )" (SA finding 2)', async (_label, error) => {
    mockDb.ownerReadError.stripe_connect_accounts = error;
    const r = await post(loadRoute(), finalizedEvent('evt_fd_unknown'));
    expect(r.status).toBe(500);
    expect(claim('evt_fd_unknown')!.failure_message).toBe('Account owner lookup failed on stripe_connect_accounts (code unknown)');
  });
});

describe('FU-5 QA 1b: the real resolver, directly (SA finding 2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- path is swapped for the old-code run
  const { resolveAccountOwner } = require(RESOLVER_PATH) as {
    resolveAccountOwner: (db: unknown, id: string) => Promise<string | null>;
  };

  it.each<[string, string, string]>([
    ['stripe_connect_accounts', '', 'unknown'],
    ['plugin_connections', '', 'unknown'],
    ['stripe_connect_accounts', '57014', '57014'],
  ])('R-%s code=%p -> "(code %s)"', async (table, code, shown) => {
    mockDb.ownerReadError[table] = { code, message: `boom ${ACCOUNT}` };
    const account = table === 'stripe_connect_accounts' ? ACCOUNT : OAUTH_ACCOUNT;
    await expect(resolveAccountOwner(mockSupabase, account)).rejects.toThrow(
      new Error(`Account owner lookup failed on ${table} (code ${shown})`)
    );
  });
});

// ─── 2. Redelivery after recovery on the same warm instance ─────────────────

describe('FU-5 QA 2: redelivery after recovery, same warm module instance', () => {
  it.each(TABLE_CASES)('RD-%s. the failed claim is reclaimed, a fresh lookup runs, the event is processed', async (table, account) => {
    const POST = loadRoute();

    mockDb.ownerReadError[table] = LOOKUP_ERROR;
    const first = await post(POST, finalizedEvent('evt_rd', account));
    expect(first.status).toBe(500);
    expect(claim('evt_rd')!.status).toBe('failed');

    // The database recovers. Stripe redelivers the SAME event id.
    mockDb.ownerReadError = {};
    const second = await post(POST, finalizedEvent('evt_rd', account));

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ received: true });
    expect(logged(second, 'Retrying previously failed event')).toHaveLength(1);
    // Reclaim path (harness 9c): failed -> processing (failure_message cleared) -> completed.
    const claimWrites = dbOps(second.effects).filter((e) => e.table === 'processed_webhook_events' && e.action !== 'select');
    expect(claimWrites.map((e) => [e.action, (e.payload as Row).status])).toEqual([['update', 'processing'], ['update', 'completed']]);
    expect((claimWrites[0].payload as Row).failure_message).toBeNull();
    expect(rowsOf('processed_webhook_events')).toHaveLength(1);
    expect(claim('evt_rd')).toMatchObject({ status: 'completed', failure_message: null });

    // No poisoning: a fresh lookup on the same instance, and the row is written.
    expect(ownerReads(second.effects).map((e) => e.table)).toEqual(
      table === 'stripe_connect_accounts' ? ['stripe_connect_accounts'] : MOCK_OWNER_TABLES
    );
    expect(rowsOf('payment_invoices')[0]).toMatchObject({
      stripe_hosted_invoice_url: `https://invoice.stripe.test/i/${STRIPE_INVOICE}`,
      stripe_invoice_pdf: `https://invoice.stripe.test/i/${STRIPE_INVOICE}/pdf`,
    });
    expect(logged(second, 'Connect invoice finalized processed')).toHaveLength(1);
  });
});

// ─── 3. A truly unmapped account: unchanged policy ──────────────────────────

describe('FU-5 QA 3: a truly unmapped account (both reads succeed, no match)', () => {
  it('U-1. 200, event completed, nothing written, refusal logged (same as the old code)', async () => {
    const r = await post(loadRoute(), finalizedEvent('evt_unmapped', UNMAPPED));
    trace('U-1', r);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true });
    expect(claim('evt_unmapped')!.status).toBe('completed');
    expect(businessWrites(r.effects)).toEqual([]);
    expect(rowsOf('payment_invoices')).toEqual([INVOICE_ROW]);
    expect(logged(r, 'Connect account maps to no known business')).toHaveLength(1);
    expect(logged(r, 'Connect invoice.finalized names an invoice owned by a different business - refusing')).toHaveLength(1);
    expect(ownerReads(r.effects).map((e) => e.table)).toEqual(MOCK_OWNER_TABLES);
  });

  it('U-2. a second event for the unmapped account on the warm instance looks up again (null not cached; intended change)', async () => {
    const POST = loadRoute();
    await post(POST, finalizedEvent('evt_unmapped_1', UNMAPPED));
    const second = await post(POST, finalizedEvent('evt_unmapped_2', UNMAPPED));
    expect(second.status).toBe(200);
    expect(claim('evt_unmapped_2')!.status).toBe('completed');
    expect(ownerReads(second.effects).map((e) => e.table)).toEqual(MOCK_OWNER_TABLES);
    expect(businessWrites(second.effects)).toEqual([]);
  });

  it('U-3. once the account maps, the next event on the warm instance is written (real-resolver version of flipped C-2)', async () => {
    const POST = loadRoute();
    const first = await post(POST, finalizedEvent('evt_late_1', UNMAPPED));
    expect(first.status).toBe(200);
    expect(businessWrites(first.effects)).toEqual([]);

    mockDb.tables.stripe_connect_accounts.push({ stripe_account_id: UNMAPPED, user_id: OWNER });
    const second = await post(POST, finalizedEvent('evt_late_2', UNMAPPED));
    expect(second.status).toBe(200);
    expect(claim('evt_late_2')!.status).toBe('completed');
    expect(businessWrites(second.effects).map((e) => e.table)).toEqual(['payment_invoices']);
  });
});

// ─── 4. A mapped account: unchanged outcome, one lookup per request ─────────

describe('FU-5 QA 4: a mapped account', () => {
  it('M-1. invoice.finalized: processed as before, one lookup (express hit, plugin table not read)', async () => {
    const r = await post(loadRoute(), finalizedEvent('evt_mapped'));
    trace('M-1', r);

    expect(r.status).toBe(200);
    expect(claim('evt_mapped')!.status).toBe('completed');
    expect(ownerReads(r.effects).map((e) => e.table)).toEqual(['stripe_connect_accounts']);
    const writes = businessWrites(r.effects);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: 'payment_invoices', action: 'update', filters: [['eq', 'id', INVOICE_ID]] });
  });

  it('M-2. one request that checks the same account twice (plan bind :1222 + recordPlanPeriodPaid :809): exactly one lookup', async () => {
    const r = await post(loadRoute(), firstPeriodEvent('evt_first_period'));
    trace('M-2', r);

    expect(r.status).toBe(200);
    expect(claim('evt_first_period')!.status).toBe('completed');
    expect(ownerReads(r.effects).map((e) => e.table)).toEqual(['stripe_connect_accounts']);
    // Both checks passed: the plan was bound (schedule capped) and the period recorded.
    expect(r.effects.filter((e) => e.type === 'stripe' && e.method === 'subscriptionSchedules.update')).toHaveLength(1);
    expect(rowsOf('payment_transactions')).toHaveLength(1);
    expect(rowsOf('payment_transactions')[0]).toMatchObject({ user_id: OWNER, amount: 300 });
  });

  it('M-3. warm instance, two requests for the same mapped account: one lookup EACH (cache cleared per request; intended change)', async () => {
    const POST = loadRoute();
    const a = await post(POST, finalizedEvent('evt_m3_a'));
    const b = await post(POST, finalizedEvent('evt_m3_b'));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(ownerReads(a.effects)).toHaveLength(1);
    expect(ownerReads(b.effects)).toHaveLength(1);
  });
});

// ─── 5. Interleaving on one warm instance ───────────────────────────────────

describe('FU-5 QA 5: two overlapping requests for one account on one warm instance', () => {
  const start = (POST: Post, event: unknown) => {
    mockEvent = event; // read synchronously by the route before its first await that matters
    return POST(request());
  };

  it('IL-1. both lookups in flight; A\'s fails, B\'s succeeds: A 500/failed, B processed from its own read', async () => {
    mockEffects.length = 0;
    const POST = loadRoute();
    const gA = gate(isOwnerRead('stripe_connect_accounts'));
    const gB = gate(isOwnerRead('stripe_connect_accounts'));

    const pA = start(POST, finalizedEvent('evt_il1_a'));
    await gA.reached;
    const pB = start(POST, finalizedEvent('evt_il1_b'));
    await gB.reached;

    mockDb.ownerReadError.stripe_connect_accounts = LOOKUP_ERROR;
    gA.release();
    const rA = await pA;
    mockDb.ownerReadError = {};
    gB.release();
    const rB = await pB;

    expect(rA.status).toBe(500);
    expect(claim('evt_il1_a')!.status).toBe('failed');
    expect(rB.status).toBe(200);
    expect(claim('evt_il1_b')!.status).toBe('completed');
    expect(ownerReads(mockEffects)).toHaveLength(2);
    expect(rowsOf('payment_invoices')[0].stripe_hosted_invoice_url).toBe(`https://invoice.stripe.test/i/${STRIPE_INVOICE}`);
  });

  it('IL-2. A fails completely while B is in flight before its lookup: B does its OWN lookup and is processed (no cached failure/null)', async () => {
    mockEffects.length = 0;
    mockLogLines.length = 0;
    const POST = loadRoute();

    // B is started first and held on its invoice read, i.e. before its owner check.
    const gB = gate(isInvoiceRead);
    const pB = start(POST, finalizedEvent('evt_il2_b'));
    await gB.reached;

    mockDb.ownerReadError.stripe_connect_accounts = LOOKUP_ERROR;
    const rA = await start(POST, finalizedEvent('evt_il2_a'));
    expect(rA.status).toBe(500);
    expect(claim('evt_il2_a')!.status).toBe('failed');
    const readsAfterA = ownerReads(mockEffects).length;
    expect(readsAfterA).toBe(1);

    mockDb.ownerReadError = {};
    gB.release();
    const rB = await pB;

    expect(rB.status).toBe(200);
    expect(claim('evt_il2_b')!.status).toBe('completed');
    expect(ownerReads(mockEffects)).toHaveLength(2); // B read for itself
    expect(rowsOf('payment_invoices')[0].stripe_hosted_invoice_url).toBe(`https://invoice.stripe.test/i/${STRIPE_INVOICE}`);
    expect(mockLogLines.filter((l) => l.msg === 'Connect invoice.finalized names an invoice owned by a different business - refusing')).toEqual([]);
  });

  it('IL-3. documented (SA C-2): a POSITIVE owner found by A may be reused by an overlapping B', async () => {
    mockEffects.length = 0;
    const POST = loadRoute();

    const gB = gate(isInvoiceRead);
    const pB = start(POST, finalizedEvent('evt_il3_b'));
    await gB.reached; // B has already run clear()

    const rA = await start(POST, finalizedEvent('evt_il3_a')); // clear(), lookup, caches OWNER
    expect(rA.status).toBe(200);
    gB.release();
    const rB = await pB;

    expect(rB.status).toBe(200);
    expect(claim('evt_il3_b')!.status).toBe('completed');
    // One lookup for both: B was served A's positive owner.
    expect(ownerReads(mockEffects)).toHaveLength(1);
  });

  it.each<[string, string, number]>([
    // B is for another account: its clear() wiped A's entry, so A's second check looks ACCOUNT up again.
    ['another account', UNMAPPED, 2],
    // B is for the same account: B's own positive lookup refills the entry, and A's second check reads it (SA C-2).
    ['the same account', ACCOUNT, 2],
  ])("IL-4 (%s). B's clear() lands between A's two checks: A is still processed; it costs at most a repeat lookup", async (_label, bAccount, accountReads) => {
    mockEffects.length = 0;
    const POST = loadRoute();
    // A = first-period invoice.paid: checks at the bind, then again in recordPlanPeriodPaid.
    // Hold A between the two checks: on the SECOND plan-by-subscription read, which is
    // recordPlanPeriodPaid's (the first is bindPlanSubscription's), just before :809.
    let planReads = 0;
    const gA = gate((op) => op.action === 'select' && op.table === 'payment_plan_subscriptions' && op.cols === '*' && ++planReads === 2);
    const pA = start(POST, firstPeriodEvent('evt_il4_a'));
    await gA.reached;
    expect(ownerReads(mockEffects)).toHaveLength(1);

    const rB = await start(POST, finalizedEvent('evt_il4_b', bAccount)); // clear() + its own lookup
    expect(rB.status).toBe(200);
    gA.release();
    const rA = await pA;

    expect(rA.status).toBe(200);
    expect(claim('evt_il4_a')!.status).toBe('completed');
    expect(rowsOf('payment_transactions')).toHaveLength(1);
    const readsOfA = ownerReads(mockEffects, 'stripe_connect_accounts').filter((e) =>
      e.filters.some((f) => f[1] === 'stripe_account_id' && f[2] === ACCOUNT)
    );
    expect(readsOfA).toHaveLength(accountReads);
  });
});

// ─── 6. SA finding 3: the "no write" checks at :809 / :1927 / :2160, made real ─

describe('FU-5 QA 6: lookup error at the plan sites, with writes recorded by the real repositories', () => {
  interface PlanSite {
    line: string;
    event: (id: string) => unknown;
    /** Logged only when the mapped control reached the site's write. */
    writtenMsg: string;
    /** Logged only when a foreign-owner control reached the site's check and refused. */
    refusedMsg: string;
  }

  const SITES: PlanSite[] = [
    {
      line: ':809 invoice.paid plan period (recordPlanPeriodPaid)',
      event: (id) => subscriptionInvoice('invoice.paid', id),
      writtenMsg: 'Plan period recorded',
      refusedMsg: 'Plan period from an account that does not own the plan - refusing',
    },
    {
      line: ':1927 invoice.payment_failed plan',
      event: (id) => subscriptionInvoice('invoice.payment_failed', id),
      writtenMsg: 'Plan marked past_due',
      // A foreign plan falls through to the platform-invoice path, which finds none.
      refusedMsg: 'No platform invoice found for Stripe invoice',
    },
    {
      line: ':2160 customer.subscription.deleted (handlePlanSubscriptionEnded)',
      event: (id) => subscriptionDeletedEvent(id),
      writtenMsg: 'Payment plan ended',
      refusedMsg: 'Subscription ended on an account that does not own the plan it names',
    },
  ];

  it.each(SITES.map((s) => [s.line, s] as const))('S %s: controls show the path writes / refuses; the error run writes nothing', async (_line, site) => {
    // Control 1 (mapped): the same path DOES record plan writes, so "none" below is meaningful.
    const mapped = await post(loadRoute(), site.event('evt_site_mapped'));
    expect(mapped.status).toBe(200);
    expect(businessWrites(mapped.effects).filter((e) => String(e.table).startsWith('payment_plan')).length).toBeGreaterThan(0);
    expect(mapped.logs.some((l) => String(l.msg).startsWith(site.writtenMsg))).toBe(true);

    // Control 2 (foreign owner on the plan): reaches this site's check and refuses.
    seed(OTHER);
    const foreign = await post(loadRoute(), site.event('evt_site_foreign'));
    expect(foreign.status).toBe(200);
    expect(logged(foreign, site.refusedMsg)).toHaveLength(1);
    expect(businessWrites(foreign.effects)).toEqual([]);

    // The error run.
    seed();
    const before = JSON.parse(JSON.stringify(mockDb.tables));
    mockDb.ownerReadError.stripe_connect_accounts = LOOKUP_ERROR;
    const r = await post(loadRoute(), site.event('evt_site_error'));

    expect(r.status).toBe(500);
    expect(claim('evt_site_error')).toMatchObject({
      status: 'failed', failure_message: 'Account owner lookup failed on stripe_connect_accounts (code XX000)',
    });
    expect(ownerReads(r.effects)).toHaveLength(1);
    expect(businessWrites(r.effects)).toEqual([]);
    for (const t of ['payment_plan_subscriptions', 'payment_plan_installments', 'payment_transactions', 'payment_invoices']) {
      expect(rowsOf(t)).toEqual(before[t]);
    }
    expect(r.logs.some((l) => String(l.msg).startsWith(site.writtenMsg))).toBe(false);
    expect(logged(r, site.refusedMsg)).toEqual([]);
  });
});
