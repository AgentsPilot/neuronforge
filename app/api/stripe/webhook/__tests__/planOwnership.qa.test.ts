/**
 * QA (Fix-1b, F-5): instalment-plan link ownership, end to end.
 *
 * The three webhook sites that bind a plan, each driven through the REAL route
 * and the REAL `bindPlanSubscription`:
 *
 *   T  customer.subscription.created (trialling)
 *   I  invoice.paid, first period of a booking-modal plan
 *   C  checkout.session.completed (hosted checkout)
 *
 * Only the Supabase client and Stripe are faked. The fake database is a small
 * in-memory PostgREST: it evaluates `eq` / `order` / `limit`, keeps state
 * between calls (so the row `bindPlanSubscription` writes is the row
 * `recordPlanPeriodPaid` later reads), and behaves like a `uuid` column where
 * it matters (case-insensitive match, canonical lower-case storage, 22P02 for
 * a value Postgres would not parse). Ownership is therefore modelled by data,
 * not by scripted answers: a "foreign" row is a row with another `user_id`.
 *
 * No snapshots. Nothing here touches the characterisation snapshot.
 *
 * Optional: `QA_PLAN_TRACE=<file>` appends a normalised write trace of every
 * test tagged `trace(...)`, so a run against the pre-Fix-1b code can be diffed
 * against this one ("identical to today" for a legitimate caller).
 */

import fs from 'fs';
import { NextRequest } from 'next/server';
import { phaseDurationFor } from '@/lib/payments/planSchedule';

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

const mockEffects: Effect[] = [];
const mockLogLines: Array<{ module: string; level: string; ctx: Record<string, unknown>; msg: unknown }> = [];
const mockDb: { tables: Record<string, Row[]>; failOwnershipReadOn: Set<string>; seq: number } = {
  tables: {},
  failOwnershipReadOn: new Set(),
  seq: 0,
};
let mockEvent: unknown = null;

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

/** What Postgres `uuid_in` would accept, as its canonical text; null if 22P02. */
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

  for (const [kind, col, val] of op.filters) {
    if (kind === 'eq' && uuidCols.includes(col) && mockPgUuid(val) === null) return mockUuidError(val);
  }

  // A transient failure on an ownership read: `select('id')` filtered by id.
  if (
    op.action === 'select' &&
    op.cols === 'id' &&
    op.filters.some((f) => f[0] === 'eq' && f[1] === 'id') &&
    mockDb.failOwnershipReadOn.has(op.table)
  ) {
    return { data: null, error: { code: 'XX000', message: 'connection reset by peer' }, count: null };
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
      if (bad) return bad; // the whole statement fails, as in Postgres
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

function mockBuilder(op: Op): unknown {
  const next = (patch: Partial<Op>) => mockBuilder({ ...op, ...patch, filters: patch.filters ?? op.filters });
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => Promise.resolve(mockExec(op, 'await')).then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(mockExec(op, String(prop)));
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
              // Filters these paths do not rely on are recorded, not evaluated.
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
const mockStripeState: { existingScheduleId: string | null } = { existingScheduleId: null };

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
    subscriptions: {
      retrieve: rec('subscriptions.retrieve', (id) => Promise.resolve({ id, schedule: mockStripeState.existingScheduleId })),
    },
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

// ─── Module mocks (Supabase, Stripe, and a log recorder) ────────────────────

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
const ACCOUNT = 'acct_owner_a';

const OWN_CONTACT = 'c1c1c1c1-0c0c-4000-8000-0000000000c1';
const OWN_BOOKING = 'a1a1a1a1-0b0b-4000-8000-0000000000b1';
const OWN_SERVICE = 'a1a1a1a1-05e5-4000-8000-0000000000e1';
/** The plan the client was shown (metadata). Not the oldest. */
const OWN_PLAN_META = 'a1a1a1a1-0a1a-4000-8000-0000000000a2';
/** The owner's OLDEST active plan for OWN_SERVICE: what a dropped plan id falls back to. */
const OWN_PLAN_OLDEST = 'a1a1a1a1-0a1a-4000-8000-0000000000a1';

/** Another business's rows. Prefix `f0f0f0f0` is searched for in every write. */
const FOREIGN_PREFIX = 'f0f0f0f0';
const VICTIM_CONTACT = 'f0f0f0f0-0c0c-4000-8000-0000000000c9';
const FOREIGN_BOOKING = 'f0f0f0f0-0b0b-4000-8000-0000000000b9';
const FOREIGN_SERVICE = 'f0f0f0f0-05e5-4000-8000-0000000000e9';
const FOREIGN_PLAN = 'f0f0f0f0-0a1a-4000-8000-0000000000a9';
/** Owned by OTHER but on OWN_SERVICE, and the oldest of all: an unscoped fallback would pick it. */
const FOREIGN_PLAN_ON_OWN_SERVICE = 'f0f0f0f0-0a1a-4000-8000-0000000000a8';

const PADDED_BOOKING = ` ${OWN_BOOKING} `;
const INJECTION = "x'); drop table payment_plans--";
const NOT_A_UUID = 'plan-not-a-uuid';

const PLAN_TERMS = { plan_count: '3', plan_total: '900', plan_currency: 'USD', plan_frequency: 'monthly' };
const CAP = { end_behavior: 'cancel', duration: phaseDurationFor('monthly', 3) };
const DROP_MSG = 'Plan link not proved to belong to the owner - dropping it';
const LINK_TABLES = ['scheduling_bookings', 'scheduling_services', 'payment_plans'];

/**
 * Lines the hosted-checkout BOOKING branch (route.ts, not bind) has always
 * written with the raw `session.metadata.booking_id`. Pre-existing, outside
 * Fix-1b, tracked as SA code-review comment 1.
 */
const PRE_EXISTING_CHECKOUT_BOOKING_LINES = new Set([
  'Checkout session for booking',
  'Failed to update booking payment status',
  'Connect checkout names a booking owned by a different business - no row updated',
]);

const VICTIM_BOOKING_ROW = {
  id: FOREIGN_BOOKING, user_id: OTHER, contact_id: VICTIM_CONTACT, payment_status: 'pending', payment_plan_id: null, status: 'confirmed',
};

function seed() {
  mockDb.seq = 0;
  mockDb.failOwnershipReadOn = new Set();
  mockStripeState.existingScheduleId = null;
  mockDb.tables = {
    stripe_connect_accounts: [{ stripe_account_id: ACCOUNT, user_id: OWNER }],
    plugin_connections: [],
    scheduling_bookings: [
      { id: OWN_BOOKING, user_id: OWNER, contact_id: OWN_CONTACT, payment_status: 'pending', payment_plan_id: null, status: 'confirmed' },
      { ...VICTIM_BOOKING_ROW },
    ],
    scheduling_services: [
      { id: OWN_SERVICE, user_id: OWNER },
      { id: FOREIGN_SERVICE, user_id: OTHER },
    ],
    payment_plans: [
      { id: FOREIGN_PLAN_ON_OWN_SERVICE, user_id: OTHER, service_id: OWN_SERVICE, is_active: true, created_at: '2025-01-01T00:00:00Z' },
      { id: OWN_PLAN_OLDEST, user_id: OWNER, service_id: OWN_SERVICE, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: OWN_PLAN_META, user_id: OWNER, service_id: OWN_SERVICE, is_active: true, created_at: '2026-03-01T00:00:00Z' },
      { id: FOREIGN_PLAN, user_id: OTHER, service_id: FOREIGN_SERVICE, is_active: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    payment_plan_subscriptions: [],
    payment_plan_installments: [],
    payment_transactions: [],
    processed_webhook_events: [],
  };
}

// ─── Events ─────────────────────────────────────────────────────────────────

interface Links { booking?: string; service?: string; plan?: string }

function linkMeta({ booking, service, plan }: Links): Record<string, string> {
  const meta: Record<string, string> = {};
  if (booking !== undefined) meta.booking_id = booking;
  if (service !== undefined) meta.service_id = service;
  if (plan !== undefined) meta.payment_plan_id = plan;
  return meta;
}

type Site = 'T' | 'I' | 'C';
const SUB: Record<Site, string> = { T: 'sub_qa_trial', I: 'sub_qa_modal', C: 'sub_qa_checkout' };

function trialEvent(links: Links, eventId = 'evt_qa_trial_1', sub = SUB.T) {
  return {
    id: eventId, object: 'event', type: 'customer.subscription.created', account: ACCOUNT, livemode: false, created: 1790000600,
    data: {
      object: {
        id: sub, object: 'subscription', status: 'trialing', customer: 'cus_qa',
        metadata: { ...PLAN_TERMS, owner_id: OWNER, ...linkMeta(links) },
      },
    },
  };
}

function invoicePaidEvent(links: Links, eventId = 'evt_qa_invoice_1', sub = SUB.I, invoiceId = 'in_qa_first') {
  return {
    id: eventId, object: 'event', type: 'invoice.paid', account: ACCOUNT, livemode: false, created: 1790000700,
    data: {
      object: {
        id: invoiceId, object: 'invoice', customer: { id: 'cus_qa' }, currency: 'usd',
        amount_paid: 30000, amount_due: 30000, total: 30000, metadata: {},
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: sub, metadata: { ...PLAN_TERMS, owner_id: OWNER, ...linkMeta(links) } },
        },
      },
    },
  };
}

function checkoutEvent(links: Links, eventId = 'evt_qa_checkout_1', sub = SUB.C) {
  return {
    id: eventId, object: 'event', type: 'checkout.session.completed', account: ACCOUNT, livemode: false, created: 1790000800,
    data: {
      object: {
        id: 'cs_qa', object: 'checkout.session', mode: 'subscription', amount_total: 30000, payment_intent: null,
        customer: 'cus_qa', subscription: sub,
        // The hosted checkout never carries payment_plan_id (route passes none).
        metadata: { ...PLAN_TERMS, owner_id: OWNER, ...linkMeta({ ...links, plan: undefined }) },
      },
    },
  };
}

const EVENT: Record<Site, (l: Links, id?: string) => unknown> = { T: trialEvent, I: invoicePaidEvent, C: checkoutEvent };

// ─── Running ────────────────────────────────────────────────────────────────

type Post = (req: NextRequest) => Promise<Response>;

function loadRoute(): Post {
  let POST: Post = async () => {
    throw new Error('route not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module (owner cache) per load
    POST = require('../route').POST;
  });
  return POST;
}

async function post(POST: Post, event: unknown) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  mockEvent = event;
  const response = await POST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ placeholder: true }),
      headers: { 'stripe-signature': 't=1790000000,v1=deadbeef' },
    })
  );
  await new Promise((r) => setImmediate(r));
  return { status: response.status, body: await response.json(), effects: [...mockEffects], logs: [...mockLogLines] };
}

const run = (event: unknown) => post(loadRoute(), event);
type Result = Awaited<ReturnType<typeof run>>;

type DbEffect = Effect & Op;
const db = (r: Result) => r.effects.filter((e) => e.type === 'db') as DbEffect[];
const stripeCalls = (r: Result, method?: string) =>
  r.effects.filter((e) => e.type === 'stripe' && (!method || e.method === method)) as Array<Effect & { method: string; args: unknown[] }>;
const writes = (r: Result) => db(r).filter((e) => e.action !== 'select');
const ownershipReads = (r: Result) =>
  db(r).filter((e) => e.action === 'select' && e.cols === 'id' && LINK_TABLES.includes(e.table) && e.filters.some((f) => f[0] === 'eq' && f[1] === 'id'));
const linkTableReads = (r: Result) => db(r).filter((e) => e.action === 'select' && LINK_TABLES.includes(e.table));
const planFallbackReads = (r: Result) =>
  db(r).filter((e) => e.action === 'select' && e.table === 'payment_plans' && e.filters.some((f) => f[1] === 'service_id'));
const dropLogs = (r: Result) => r.logs.filter((l) => l.level === 'error' && l.msg === DROP_MSG).map((l) => l.ctx);
const rowsOf = (table: string) => mockDb.tables[table] ?? [];
const planRow = (sub: string) => rowsOf('payment_plan_subscriptions').find((p) => p.stripe_subscription_id === sub);
const periodsOf = (planId: unknown) => rowsOf('payment_plan_installments').filter((i) => i.subscription_id === planId);
const scheduleUpdate = (r: Result) => {
  const [call] = stripeCalls(r, 'subscriptionSchedules.update');
  return call?.args[1] as { end_behavior: string; phases: Array<Record<string, unknown>>; metadata: Record<string, string> } | undefined;
};
function claimStatus(): unknown {
  return rowsOf('processed_webhook_events')[0]?.status;
}

/** Everything the event WROTE (DB writes and Stripe calls), serialised. */
const writtenText = (r: Result) => JSON.stringify([writes(r), stripeCalls(r)]);

function expectCapHeld(r: Result) {
  expect(stripeCalls(r, 'subscriptionSchedules.update')).toHaveLength(1);
  const params = scheduleUpdate(r)!;
  expect(params.end_behavior).toBe(CAP.end_behavior);
  expect(params.phases).toHaveLength(1);
  expect(params.phases[0].duration).toEqual(CAP.duration);
  expect(params.phases[0].start_date).toBe(SCHEDULE_START);
}

function expectVictimUntouched() {
  expect(rowsOf('scheduling_bookings').find((b) => b.id === FOREIGN_BOOKING)).toEqual(VICTIM_BOOKING_ROW);
}

/** Normalised write trace, for diffing this run against the pre-Fix-1b code. */
function trace(name: string, r: Result) {
  const file = process.env.QA_PLAN_TRACE;
  if (!file) return;
  const scrub = (_k: string, v: unknown) =>
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v) ? '<date>' : v;
  const shape = {
    status: r.status,
    writes: writes(r).map((w) => ({ table: w.table, action: w.action, payload: w.payload, filters: w.filters, opts: w.opts })),
    stripe: stripeCalls(r).map((c) => ({ method: c.method, args: c.args })),
    state: {
      plans: rowsOf('payment_plan_subscriptions'),
      periods: rowsOf('payment_plan_installments'),
      transactions: rowsOf('payment_transactions'),
      bookings: rowsOf('scheduling_bookings'),
    },
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

// ─── 1. Legitimate caller: own ids kept everywhere, outcome unchanged ───────

describe('Fix-1b QA: own ids are kept everywhere (legitimate caller unchanged)', () => {
  it.each<[Site]>([['T'], ['I']])('O-%s. all three own ids: Stripe metadata, plan row, every period and the booking link carry them', async (site) => {
    const r = await run(EVENT[site]({ booking: OWN_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));
    trace(`O-${site}`, r);

    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expectCapHeld(r);
    expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: OWN_BOOKING, owner_id: OWNER, service_id: OWN_SERVICE });

    const plan = planRow(SUB[site])!;
    expect(plan).toMatchObject({
      user_id: OWNER, contact_id: OWN_CONTACT, booking_id: OWN_BOOKING, service_id: OWN_SERVICE,
      payment_plan_id: OWN_PLAN_META, installment_count: 3, currency: 'USD', status: 'active',
    });
    const periods = periodsOf(plan.id);
    expect(periods).toHaveLength(3);
    for (const p of periods) {
      expect(p).toMatchObject({ user_id: OWNER, booking_id: OWN_BOOKING, payment_plan_id: OWN_PLAN_META, contact_id: OWN_CONTACT });
    }
    expect(periods.reduce((s, p) => s + Number(p.amount), 0)).toBeCloseTo(900, 2);
    expect(rowsOf('scheduling_bookings').find((b) => b.id === OWN_BOOKING)?.payment_plan_id).toBe(OWN_PLAN_META);
    // C-5: an owned plan id is used as-is; the "oldest active" fallback never runs.
    expect(planFallbackReads(r)).toEqual([]);
    expect(dropLogs(r)).toEqual([]);

    if (site === 'I') {
      // The trigger's input: the period payment carries the plan's stored links.
      const [tx] = rowsOf('payment_transactions');
      expect(rowsOf('payment_transactions')).toHaveLength(1);
      expect(tx).toMatchObject({ user_id: OWNER, booking_id: OWN_BOOKING, service_id: OWN_SERVICE, contact_id: OWN_CONTACT, amount: 300 });
      expect(rowsOf('scheduling_bookings').find((b) => b.id === OWN_BOOKING)?.payment_status).toBe('paid');
    }
  });

  it('O-C. checkout, own booking + own service: kept everywhere; plan from the owner\'s oldest active plan (unchanged path)', async () => {
    const r = await run(checkoutEvent({ booking: OWN_BOOKING, service: OWN_SERVICE }));
    trace('O-C', r);

    expect(r.status).toBe(200);
    expectCapHeld(r);
    expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: OWN_BOOKING, owner_id: OWNER, service_id: OWN_SERVICE });
    const plan = planRow(SUB.C)!;
    expect(plan).toMatchObject({ booking_id: OWN_BOOKING, service_id: OWN_SERVICE, contact_id: OWN_CONTACT, payment_plan_id: OWN_PLAN_OLDEST });
    for (const p of periodsOf(plan.id)) expect(p).toMatchObject({ booking_id: OWN_BOOKING, payment_plan_id: OWN_PLAN_OLDEST });
    expect(periodsOf(plan.id)).toHaveLength(3);
    // The fallback is user-scoped: the other business's older plan on the same service is not picked.
    const [fallback] = planFallbackReads(r);
    expect(fallback.filters).toEqual(expect.arrayContaining([['eq', 'user_id', OWNER], ['eq', 'service_id', OWN_SERVICE], ['eq', 'is_active', true]]));
    expect(rowsOf('scheduling_bookings').find((b) => b.id === OWN_BOOKING)).toMatchObject({ payment_status: 'paid', payment_plan_id: OWN_PLAN_OLDEST });
    expect(dropLogs(r)).toEqual([]);
  });

  it.each<[Site]>([['T'], ['I'], ['C']])('O-R-%s. the only added DB traffic for own ids is one user-scoped ownership read per link present', async (site) => {
    const r = await run(EVENT[site]({ booking: OWN_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));
    const reads = ownershipReads(r);
    const expected = site === 'C' ? ['scheduling_bookings', 'scheduling_services'] : LINK_TABLES;
    expect(reads.map((q) => q.table)).toEqual(expected);
    for (const q of reads) {
      expect(q.filters).toContainEqual(['eq', 'user_id', OWNER]);
      expect(q.terminal).toBe('maybeSingle');
    }
  });
});

// ─── 2. Foreign ids are dropped everywhere ──────────────────────────────────

describe('Fix-1b QA: a foreign booking, service or plan id is dropped everywhere', () => {
  it.each<[Site]>([['T'], ['I']])(
    'F-%s-1. foreign booking + foreign plan, own service: both dropped; plan falls back to the owner\'s oldest active plan (user-scoped); cap holds',
    async (site) => {
      const r = await run(EVENT[site]({ booking: FOREIGN_BOOKING, service: OWN_SERVICE, plan: FOREIGN_PLAN }));

      expect(r.status).toBe(200);
      expect(claimStatus()).toBe('completed');
      expectCapHeld(r);
      expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: '', owner_id: OWNER, service_id: OWN_SERVICE });

      const plan = planRow(SUB[site])!;
      expect(plan).toMatchObject({ user_id: OWNER, booking_id: null, contact_id: null, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN_OLDEST });
      const periods = periodsOf(plan.id);
      expect(periods).toHaveLength(3);
      for (const p of periods) expect(p).toMatchObject({ booking_id: null, contact_id: null, payment_plan_id: OWN_PLAN_OLDEST });

      const [fallback] = planFallbackReads(r);
      expect(fallback.filters).toEqual(expect.arrayContaining([['eq', 'user_id', OWNER], ['eq', 'service_id', OWN_SERVICE]]));

      expect(writtenText(r)).not.toContain(FOREIGN_PREFIX);
      expectVictimUntouched();
      expect(dropLogs(r)).toEqual([
        expect.objectContaining({ subscriptionId: SUB[site], connectAccountId: ACCOUNT, ownerId: OWNER, field: 'booking_id', reason: 'not_owned', id: FOREIGN_BOOKING }),
        expect.objectContaining({ subscriptionId: SUB[site], field: 'payment_plan_id', reason: 'not_owned', id: FOREIGN_PLAN }),
      ]);

      if (site === 'I') {
        expect(rowsOf('payment_transactions')).toHaveLength(1);
        expect(rowsOf('payment_transactions')[0]).toMatchObject({ user_id: OWNER, booking_id: null, service_id: OWN_SERVICE, contact_id: null });
      }
    }
  );

  it.each<[Site]>([['T'], ['I'], ['C']])(
    'F-%s-2. all links foreign: every one dropped, no plan selected from a foreign service, no periods, cap still holds',
    async (site) => {
      const r = await run(EVENT[site]({ booking: FOREIGN_BOOKING, service: FOREIGN_SERVICE, plan: FOREIGN_PLAN }));

      expect(r.status).toBe(200);
      expectCapHeld(r);
      expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: '', owner_id: OWNER, service_id: '' });
      const plan = planRow(SUB[site])!;
      expect(plan).toMatchObject({ user_id: OWNER, booking_id: null, service_id: null, contact_id: null, payment_plan_id: null });
      expect(periodsOf(plan.id)).toEqual([]);
      expect(planFallbackReads(r)).toEqual([]);
      if (site === 'C') {
        // The route's checkout booking branch (Fix-1, unchanged) still FILTERS by
        // the metadata id, scoped by user_id = owner; it matches no row.
        expect(JSON.stringify([writes(r).filter((w) => w.table !== 'scheduling_bookings'), stripeCalls(r)])).not.toContain(FOREIGN_PREFIX);
        for (const u of writes(r).filter((w) => w.table === 'scheduling_bookings')) expect(u.filters).toContainEqual(['eq', 'user_id', OWNER]);
      } else {
        expect(writtenText(r)).not.toContain(FOREIGN_PREFIX);
      }
      expectVictimUntouched();
      const fields = site === 'C' ? ['booking_id', 'service_id'] : ['booking_id', 'service_id', 'payment_plan_id'];
      expect(dropLogs(r).map((c) => [c.field, c.reason, c.subscriptionId])).toEqual(fields.map((f) => [f, 'not_owned', SUB[site]]));
      if (site === 'I') expect(rowsOf('payment_transactions')[0]).toMatchObject({ booking_id: null, service_id: null });
    }
  );

  it('F-C-1. checkout, foreign booking + own service: booking dropped from bind; the route\'s own booking update is user-scoped and changes nothing', async () => {
    const r = await run(checkoutEvent({ booking: FOREIGN_BOOKING, service: OWN_SERVICE }));
    expect(r.status).toBe(200);
    expectCapHeld(r);
    expect(scheduleUpdate(r)!.metadata.booking_id).toBe('');
    const plan = planRow(SUB.C)!;
    expect(plan).toMatchObject({ booking_id: null, contact_id: null, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN_OLDEST });
    for (const p of periodsOf(plan.id)) expect(p.booking_id).toBeNull();
    // The plan path's writes carry no foreign id. The route's booking branch
    // (Fix-1, unchanged) filters by the foreign id but also by user_id = owner.
    const planWrites = writes(r).filter((w) => w.table.startsWith('payment_plan'));
    expect(JSON.stringify(planWrites)).not.toContain(FOREIGN_PREFIX);
    const bookingUpdates = writes(r).filter((w) => w.table === 'scheduling_bookings');
    for (const u of bookingUpdates) expect(u.filters).toContainEqual(['eq', 'user_id', OWNER]);
    expectVictimUntouched();
  });

  it('F-TI. trialling plan bound with a foreign booking, then its first invoice.paid: the period payment (trigger input) carries no foreign id', async () => {
    const POST = loadRoute();
    const first = await post(POST, trialEvent({ booking: FOREIGN_BOOKING, service: OWN_SERVICE, plan: FOREIGN_PLAN }, 'evt_qa_chain_1', 'sub_qa_chain'));
    expect(first.status).toBe(200);
    const second = await post(POST, invoicePaidEvent({ booking: FOREIGN_BOOKING, service: OWN_SERVICE, plan: FOREIGN_PLAN }, 'evt_qa_chain_2', 'sub_qa_chain'));
    expect(second.status).toBe(200);

    // Second delivery found the plan bound and projected: no ownership read, no schedule call.
    expect(linkTableReads(second)).toEqual([]);
    expect(stripeCalls(second).filter((c) => c.method.startsWith('subscriptionSchedules'))).toEqual([]);

    expect(rowsOf('payment_transactions')).toHaveLength(1);
    expect(rowsOf('payment_transactions')[0]).toMatchObject({ user_id: OWNER, booking_id: null, service_id: OWN_SERVICE });
    expect(JSON.stringify(rowsOf('payment_transactions'))).not.toContain(FOREIGN_PREFIX);
    expect(periodsOf(planRow('sub_qa_chain')!.id).filter((p) => p.status === 'paid')).toHaveLength(1);
    expectVictimUntouched();
  });
});

// ─── 3. Malformed ids never reach a log, a read or a write ──────────────────

describe('Fix-1b QA: a malformed id never reaches any log raw', () => {
  const RAW = [PADDED_BOOKING, INJECTION, NOT_A_UUID];
  const rawFound = (text: string) => RAW.filter((v) => text.includes(JSON.stringify(v).slice(1, -1)) || text.includes(v));

  it.each<[Site]>([['T'], ['I'], ['C']])('M-%s. padded / injected / non-UUID links: no read, idLength only, absent from every log line and every write', async (site) => {
    const r = await run(EVENT[site]({ booking: PADDED_BOOKING, service: INJECTION, plan: NOT_A_UUID }));

    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expectCapHeld(r);
    expect(ownershipReads(r)).toEqual([]);
    expect(planRow(SUB[site])).toMatchObject({ booking_id: null, service_id: null, payment_plan_id: null, contact_id: null });

    const expected: Array<[string, number]> = [['booking_id', PADDED_BOOKING.length], ['service_id', INJECTION.length]];
    if (site !== 'C') expected.push(['payment_plan_id', NOT_A_UUID.length]);
    const drops = dropLogs(r);
    expect(drops.map((c) => [c.field, c.idLength])).toEqual(expected);
    for (const c of drops) {
      expect(c.reason).toBe('malformed');
      expect(c).not.toHaveProperty('id');
      expect(c.subscriptionId).toBe(SUB[site]);
    }

    // Bind's writes and Stripe calls never carry them.
    const planWrites = writes(r).filter((w) => w.table.startsWith('payment_plan'));
    expect(rawFound(JSON.stringify([planWrites, stripeCalls(r)]))).toEqual([]);

    // No log line anywhere carries them, except the checkout BOOKING branch of
    // the route, which pre-dates Fix-1b and is tracked (SA comment 1).
    const logs = r.logs.filter((l) => !(site === 'C' && PRE_EXISTING_CHECKOUT_BOOKING_LINES.has(String(l.msg))));
    expect(rawFound(JSON.stringify(logs))).toEqual([]);
    // And bind's own logger never does, at any site.
    expect(rawFound(JSON.stringify(r.logs.filter((l) => l.module === 'BindPlanSubscription')))).toEqual([]);
  });
});

// ─── 4. Ownership read errors ───────────────────────────────────────────────

describe('Fix-1b QA: an ownership read error drops the link (read_failed) and logs subscriptionId', () => {
  it.each<[Site]>([['T'], ['I'], ['C']])('R-%s. all reads fail: links dropped, reason read_failed with subscriptionId and id, cap holds, 200', async (site) => {
    for (const t of LINK_TABLES) mockDb.failOwnershipReadOn.add(t);
    const r = await run(EVENT[site]({ booking: OWN_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));

    expect(r.status).toBe(200);
    expect(claimStatus()).toBe('completed');
    expectCapHeld(r);
    expect(planRow(SUB[site])).toMatchObject({ booking_id: null, service_id: null, payment_plan_id: null });
    const fields: Array<[string, string]> = [['booking_id', OWN_BOOKING], ['service_id', OWN_SERVICE]];
    if (site !== 'C') fields.push(['payment_plan_id', OWN_PLAN_META]);
    expect(dropLogs(r)).toEqual(
      fields.map(([field, id]) =>
        expect.objectContaining({ subscriptionId: SUB[site], connectAccountId: ACCOUNT, ownerId: OWNER, field, reason: 'read_failed', id })
      )
    );
    for (const c of dropLogs(r)) expect(c).not.toHaveProperty('idLength');
  });

  it('R-1. only the booking read fails: booking dropped (read_failed), service and plan kept as today', async () => {
    mockDb.failOwnershipReadOn.add('scheduling_bookings');
    const r = await run(trialEvent({ booking: OWN_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));
    expect(planRow(SUB.T)).toMatchObject({ booking_id: null, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN_META });
    expect(dropLogs(r).map((c) => [c.field, c.reason])).toEqual([['booking_id', 'read_failed']]);
  });
});

// ─── 5. Redelivery ──────────────────────────────────────────────────────────

describe('Fix-1b QA: a redelivery makes no extra reads', () => {
  it.each<[Site]>([['T'], ['I'], ['C']])('D-%s. second delivery of a bound + projected plan: no link-table read, no Stripe schedule call, no new write to plan tables', async (site) => {
    const POST = loadRoute();
    const links = { booking: FOREIGN_BOOKING, service: OWN_SERVICE, plan: FOREIGN_PLAN };
    await post(POST, (EVENT[site] as (l: Links, id: string) => unknown)(links, `evt_qa_redeliver_${site}_1`));
    const plansBefore = JSON.stringify(rowsOf('payment_plan_subscriptions'));
    const periodsBefore = rowsOf('payment_plan_installments').length;

    const again = await post(POST, (EVENT[site] as (l: Links, id: string) => unknown)(links, `evt_qa_redeliver_${site}_2`));
    trace(`D-${site}`, again);
    expect(again.status).toBe(200);
    expect(ownershipReads(again)).toEqual([]);
    expect(planFallbackReads(again)).toEqual([]);
    expect(stripeCalls(again).filter((c) => c.method.startsWith('subscriptionSchedules') || c.method === 'subscriptions.retrieve')).toEqual([]);
    expect(rowsOf('payment_plan_installments')).toHaveLength(periodsBefore);
    if (site !== 'I') expect(JSON.stringify(rowsOf('payment_plan_subscriptions'))).toBe(plansBefore);
    expect(dropLogs(again)).toEqual([]);
  });
});

// ─── 6. Edge cases ──────────────────────────────────────────────────────────

describe('Fix-1b QA: edge cases', () => {
  it('X-1. upper-case own UUIDs (SA comment 2): kept; DB stores the canonical id; Stripe metadata now gets the repository\'s lower-case id', async () => {
    const r = await run(
      trialEvent({ booking: OWN_BOOKING.toUpperCase(), service: OWN_SERVICE.toUpperCase(), plan: OWN_PLAN_META.toUpperCase() })
    );
    trace('X-1', r);
    expect(r.status).toBe(200);
    expect(dropLogs(r)).toEqual([]);
    const plan = planRow(SUB.T)!;
    expect(plan).toMatchObject({ booking_id: OWN_BOOKING, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN_META, contact_id: OWN_CONTACT });
    for (const p of periodsOf(plan.id)) expect(p).toMatchObject({ booking_id: OWN_BOOKING, payment_plan_id: OWN_PLAN_META });
    expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: OWN_BOOKING, owner_id: OWNER, service_id: OWN_SERVICE });
  });

  it('X-2. padded own booking id: dropped as malformed (never trimmed into an id); the plan is still recorded with the other links', async () => {
    const r = await run(trialEvent({ booking: PADDED_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));
    expect(r.status).toBe(200);
    expectCapHeld(r);
    expect(planRow(SUB.T)).toMatchObject({ booking_id: null, service_id: OWN_SERVICE, payment_plan_id: OWN_PLAN_META });
    expect(periodsOf(planRow(SUB.T)!.id)).toHaveLength(3);
    expect(dropLogs(r).map((c) => [c.field, c.reason, c.idLength])).toEqual([['booking_id', 'malformed', PADDED_BOOKING.length]]);
  });

  it.each<[Site]>([['T'], ['I'], ['C']])('X-3-%s. links absent entirely: no ownership read, no drop log, no plan row id (unchanged)', async (site) => {
    const r = await run(EVENT[site]({}));
    trace(`X-3-${site}`, r);
    expect(r.status).toBe(200);
    expectCapHeld(r);
    expect(linkTableReads(r)).toEqual([]);
    expect(dropLogs(r)).toEqual([]);
    expect(scheduleUpdate(r)!.metadata).toEqual({ booking_id: '', owner_id: OWNER, service_id: '' });
    expect(planRow(SUB[site])).toMatchObject({ booking_id: null, service_id: null, payment_plan_id: null, contact_id: null });
  });

  it.each<[Site]>([['T'], ['I'], ['C']])('X-4-%s. links present as empty strings: same as absent', async (site) => {
    const r = await run(EVENT[site]({ booking: '', service: '', plan: '' }));
    trace(`X-4-${site}`, r);
    expect(r.status).toBe(200);
    expect(linkTableReads(r)).toEqual([]);
    expect(dropLogs(r)).toEqual([]);
    expect(planRow(SUB[site])).toMatchObject({ booking_id: null, service_id: null, payment_plan_id: null });
  });

  it('X-5. bind called directly with empty strings (no site coercion): treated as absent, nothing read, nothing logged', async () => {
    let bind!: typeof import('@/lib/payments/bindPlanSubscription').bindPlanSubscription;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- same module registry as the mocks
      bind = require('@/lib/payments/bindPlanSubscription').bindPlanSubscription;
    });
    mockEffects.length = 0;
    mockLogLines.length = 0;
    const out = await bind({
      stripe: mockStripeClient() as never,
      connectAccountId: ACCOUNT, subscriptionId: 'sub_qa_direct', customerId: null, ownerId: OWNER,
      bookingId: '', serviceId: '', paymentPlanId: '',
      planTotal: 900, planCurrency: 'USD', planCount: 3, planFrequency: 'monthly',
    });
    expect(out.alreadyBound).toBe(false);
    expect(mockEffects.filter((e) => e.type === 'db' && LINK_TABLES.includes(String(e.table)))).toEqual([]);
    expect(mockLogLines.filter((l) => l.msg === DROP_MSG)).toEqual([]);
  });

  describe('repair path (recorded, never projected)', () => {
    const seedHalfWritten = (sub: string) =>
      rowsOf('payment_plan_subscriptions').push({
        id: 'pps-half', user_id: OWNER, stripe_subscription_id: sub, stripe_schedule_id: 'sub_sched_prev',
        booking_id: null, service_id: null, payment_plan_id: null, contact_id: null,
        installment_count: 3, currency: 'USD', periods_paid: 0, status: 'active',
      });

    it.each<[Site]>([['T'], ['I']])('X-6-%s. foreign booking + foreign plan: re-projected periods carry neither; no Stripe schedule call', async (site) => {
      seedHalfWritten(SUB[site]);
      const r = await run(EVENT[site]({ booking: FOREIGN_BOOKING, service: OWN_SERVICE, plan: FOREIGN_PLAN }));
      expect(r.status).toBe(200);
      expect(stripeCalls(r).filter((c) => c.method.startsWith('subscriptionSchedules'))).toEqual([]);
      const periods = periodsOf('pps-half');
      expect(periods).toHaveLength(3);
      for (const p of periods) expect(p).toMatchObject({ booking_id: null, contact_id: null, payment_plan_id: OWN_PLAN_OLDEST });
      expect(JSON.stringify(writes(r).filter((w) => w.table.startsWith('payment_plan')))).not.toContain(FOREIGN_PREFIX);
      expectVictimUntouched();
      expect(dropLogs(r).map((c) => [c.field, c.reason, c.subscriptionId])).toEqual([
        ['booking_id', 'not_owned', SUB[site]], ['payment_plan_id', 'not_owned', SUB[site]],
      ]);
      if (site === 'I') expect(rowsOf('payment_transactions')[0]).toMatchObject({ booking_id: null });
    });

    it('X-6-own. own ids: re-projected periods carry them exactly as before (unchanged)', async () => {
      seedHalfWritten(SUB.T);
      const r = await run(trialEvent({ booking: OWN_BOOKING, service: OWN_SERVICE, plan: OWN_PLAN_META }));
      trace('X-6-own', r);
      const periods = periodsOf('pps-half');
      expect(periods).toHaveLength(3);
      for (const p of periods) expect(p).toMatchObject({ booking_id: OWN_BOOKING, contact_id: OWN_CONTACT, payment_plan_id: OWN_PLAN_META });
      expect(rowsOf('scheduling_bookings').find((b) => b.id === OWN_BOOKING)?.payment_plan_id).toBe(OWN_PLAN_META);
      expect(dropLogs(r)).toEqual([]);
    });
  });
});
