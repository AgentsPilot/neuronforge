/**
 * QA (Fix-1, webhook Connect tenant ownership): attack, failure and edge cases
 * the characterisation harness does not cover.
 *
 * No snapshots; nothing here touches the characterisation snapshot file. No
 * Stripe call and no database: every client is mocked, the same way the
 * harness mocks them (a recording PostgREST builder, a no-op Stripe client,
 * a stubbed `resolveAccountOwner`).
 *
 * The fake database cannot evaluate filters, so a "foreign" row is modelled by
 * the answer the real query would give (no row for a user-scoped read). What
 * these tests prove is the ORDER and SCOPE of the route's reads and writes and
 * the values it writes, not PostgREST semantics.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

type Answer = { data: unknown; error: unknown; count?: number | null };
type Effect = Record<string, unknown> & { type: string };

interface QaScenario {
  owners?: Record<string, string | null>;
  /** FU-5: accounts whose owner lookup fails with a read error (the stub rejects). */
  ownerErrors?: string[];
  /** FU-5: what `findBySubscriptionId` answers. Default: no plan. */
  planBySubscription?: Answer;
  db?: Record<string, Answer | Answer[]>;
  /**
   * CF-5 PR 4: `bindPlanSubscription` rejects with this message. Unset → it
   * resolves, as it always did, so no earlier test sees a difference.
   */
  bindError?: string;
}

const mockEffects: Effect[] = [];
const mockLogLines: Array<{ level: string; ctx: Record<string, unknown>; msg: unknown }> = [];
let mockScenario: QaScenario = {};
let mockEvent: unknown = null;
const mockDbQueues: Record<string, Answer[]> = {};

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockAnswerFor(table: string, operation: string): Answer {
  const queue = mockDbQueues[`${table}:${operation}`];
  if (queue && queue.length > 0) return queue.shift() as Answer;
  return { data: null, error: null };
}

function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = (terminal: string) => {
    const writeCall = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const operation = writeCall ? String(writeCall[0]) : 'select';
    mockEffects.push({ type: 'db', table, operation, chain: calls, terminal });
    return Promise.resolve(mockAnswerFor(table, operation));
  };
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (f: (v: unknown) => unknown, r: (e: unknown) => unknown) => resolve('await').then(f, r);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve(String(prop));
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

const mockSupabase = { from: (table: string) => mockBuilder(table, []) };

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const at = (level: string) => (ctx: unknown, msg?: unknown) => {
      mockLogLines.push({ level, ctx: (ctx ?? {}) as Record<string, unknown>, msg });
    };
    const l: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
    };
    l.child = () => l;
    return l;
  };
  return { createLogger: () => make() };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));

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
  resolveAccountOwner: (...args: unknown[]) => {
    const accountId = String(args[1]);
    mockEffects.push({ type: 'resolveAccountOwner', accountId });
    if (mockScenario.ownerErrors?.includes(accountId)) {
      // The message the real resolver throws (stripeAccountContext.ts, FU-5).
      return Promise.reject(new Error('Account owner lookup failed on stripe_connect_accounts (code XX000)'));
    }
    return Promise.resolve(mockScenario.owners?.[accountId] ?? null);
  },
}));

jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: () => Promise.resolve(null),
}));

jest.mock('@/lib/payments/invoicePaymentIntent', () => ({
  resolveInvoicePaymentIntent: () => Promise.resolve(null),
}));

jest.mock('@/lib/payments/bindPlanSubscription', () => ({
  bindPlanSubscription: (...args: unknown[]) => {
    mockEffects.push({ type: 'bindPlanSubscription', args });
    if (mockScenario.bindError) return Promise.reject(new Error(mockScenario.bindError));
    return Promise.resolve({ scheduleId: 'sub_sched_1' });
  },
}));

jest.mock('@/lib/payments/syncBookingPaymentState', () => ({
  syncBookingsForTransactions: () => Promise.resolve(),
}));

jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  paymentPlanSubscriptionRepository: {
    findBySubscriptionId: () => Promise.resolve(mockScenario.planBySubscription ?? { data: null, error: null }),
    recordPeriodPaid: () => Promise.resolve({ data: null, error: null }),
    recordFailure: () => Promise.resolve({ data: null, error: null }),
    close: () => Promise.resolve({ data: null, error: null }),
    // CF-5 PR 4's two methods, delegated to the real repository by name (SA C-4,
    // as in the characterisation harness), so the `:2151` site below keeps
    // reading `payment_plan_subscriptions` through `mockSupabase` once PR 4
    // moves that query. Resolved at call time: the methods arrive in PR 4.
    findEndStateBySubscriptionId: (...args: unknown[]) =>
      jest.requireActual('@/lib/repositories/PaymentPlanSubscriptionRepository')
        .paymentPlanSubscriptionRepository.findEndStateBySubscriptionId(...args),
    endFromStripe: (...args: unknown[]) =>
      jest.requireActual('@/lib/repositories/PaymentPlanSubscriptionRepository')
        .paymentPlanSubscriptionRepository.endFromStripe(...args),
  },
}));

jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: {
    create: (...args: unknown[]) => {
      mockEffects.push({ type: 'crmActivity.create', args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

jest.mock('@/lib/services/DisputeAlertService', () => ({ notifyOwnerOfDispute: () => Promise.resolve() }));
jest.mock('@/lib/services/AuditTrailService', () => ({ auditLog: () => Promise.resolve() }));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures', 'connect');
type Post = (req: NextRequest) => Promise<Response>;

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

/** A fixture with `data.object.metadata` replaced (and the event id varied). */
function withMetadata(name: string, metadata: Record<string, string>, eventId?: string): Record<string, unknown> {
  const event = fixture(name);
  const object = (event.data as { object: Record<string, unknown> }).object;
  object.metadata = metadata;
  if (eventId) event.id = eventId;
  return event;
}

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

/** Post one event to an already-loaded route (so its module-level cache persists). */
async function post(POST: Post, event: unknown, scenario: QaScenario) {
  mockEffects.length = 0;
  mockLogLines.length = 0;
  for (const key of Object.keys(mockDbQueues)) delete mockDbQueues[key];
  for (const [key, answer] of Object.entries(scenario.db ?? {})) {
    mockDbQueues[key] = Array.isArray(answer) ? [...answer] : [answer];
  }
  mockScenario = scenario;
  mockEvent = event;

  const response = await POST(
    new NextRequest('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ placeholder: true }),
      headers: { 'stripe-signature': 't=1790000000,v1=deadbeef' },
    })
  );
  await new Promise((r) => setImmediate(r));
  return { status: response.status, body: await response.json(), effects: [...mockEffects] };
}

const run = (event: unknown, scenario: QaScenario) => post(loadRoute(), event, scenario);
type Result = Awaited<ReturnType<typeof run>>;

const dbEffects = (r: Result) => r.effects.filter((e) => e.type === 'db') as Array<Effect & { table: string; operation: string; chain: unknown[][] }>;
const writes = (r: Result, tables: string[]) =>
  dbEffects(r).filter((e) => e.operation !== 'select' && tables.includes(e.table));
const reads = (r: Result, table: string) => dbEffects(r).filter((e) => e.operation === 'select' && e.table === table);
const ownerLookups = (r: Result) => r.effects.filter((e) => e.type === 'resolveAccountOwner');

function claimStatus(r: Result): string | undefined {
  const updates = writes(r, ['processed_webhook_events']).filter((e) => e.operation === 'update');
  const last = updates[updates.length - 1];
  return (last?.chain[0][1] as { status?: string } | undefined)?.status;
}

function insertPayload(r: Result, table: string): Record<string, unknown> | undefined {
  const insert = dbEffects(r).find((e) => e.table === table && e.operation === 'insert');
  return insert?.chain[0][1] as Record<string, unknown> | undefined;
}

const errorsLogged = (message: string) =>
  mockLogLines.filter((l) => l.level === 'error' && l.msg === message).map((l) => l.ctx);

const ok = (data: unknown): Answer => ({ data, error: null });
const NOT_FOUND: Answer = { data: null, error: null };
const PGRST116: Answer = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
const UUID_CAST: Answer = { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
const OWNER_A = { acct_owner_a: 'owner-a' };
const OWNED_BY_OTHER = { acct_owner_a: 'owner-b' };
const VICTIM_TABLES = ['payment_invoices', 'payment_transactions', 'scheduling_bookings'];
const LINK_DROPPED = 'payment_intent.succeeded link not proved to belong to the owner - dropping it';
const INVOICE_PAID_REFUSAL = 'Connect invoice.paid names an invoice owned by a different business - refusing';

/**
 * The link ids `payment-intent-succeeded.json` carries. UUID-shaped since
 * Fix-1b: any other shape is now dropped as `malformed` before a read.
 */
const LINK_CONTACT = 'c7c7c7c7-0001-4000-8000-00000000c701';
const LINK_BOOKING = 'b7b7b7b7-0002-4000-8000-00000000b702';
const LINK_SERVICE = 'e7e7e7e7-0002-4000-8000-00000000e702';
/** Rows of another business (A-10). */
const VICTIM_CONTACT = 'deadbeef-0c0c-4000-8000-00000000000c';
const VICTIM_BOOKING = 'deadbeef-0b0b-4000-8000-00000000000b';
const VICTIM_SERVICE = 'deadbeef-0e0e-4000-8000-00000000000e';

const VICTIM_INVOICE = { id: 'pinv-0001', user_id: 'owner-a', contact_id: 'ct-1', invoice_number: 'INV-001', booking_id: 'bk-0001', amount: 150 };

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_qa';
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => undefined);
  }
});

afterAll(() => jest.restoreAllMocks());

// ─── 1. Happy paths for the rightful owner ───────────────────────────────────

describe('Fix-1 QA: the rightful owner still gets today\'s result', () => {
  it('H-1. invoice.paid via metadata fallback, owned: stripe_invoice_id written, one owner lookup (cache)', async () => {
    const r = await run(fixture('invoice-paid.json'), {
      owners: OWNER_A,
      db: { 'payment_invoices:select': [PGRST116, ok({ ...VICTIM_INVOICE, booking_id: null })] },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const invoiceUpdates = writes(r, ['payment_invoices']);
    expect(invoiceUpdates[0].chain[0][1]).toMatchObject({ stripe_invoice_id: 'in_connect_1' });
    expect(invoiceUpdates[0].chain).toContainEqual(['eq', 'id', 'pinv-0001']);
    expect(insertPayload(r, 'payment_transactions')).toMatchObject({ user_id: 'owner-a' });
    // Two accountOwns calls on this path (before H3 and the H1 guard), one lookup.
    expect(ownerLookups(r)).toHaveLength(1);
    expect(errorsLogged(INVOICE_PAID_REFUSAL)).toEqual([]);
  });

  it('H-2. payment_failed / finalized / uncollectible, owned: the row is written', async () => {
    const cases: Array<[string, string]> = [
      ['invoice-payment-failed.json', 'overdue'],
      ['invoice-finalized.json', 'hosted_invoice_url'],
      ['invoice-marked-uncollectible.json', 'cancelled'],
    ];
    for (const [name, marker] of cases) {
      const r = await run(fixture(name), {
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ id: 'pinv-9', invoice_number: 'INV-9', user_id: 'owner-a' }) },
      });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      const updates = writes(r, ['payment_invoices']);
      expect(updates).toHaveLength(1);
      expect(JSON.stringify(updates[0].chain[0][1])).toContain(marker);
      expect(updates[0].chain).toContainEqual(['eq', 'id', 'pinv-9']);
    }
  });

  it('H-3. checkout booking, owned: one counted, owner-scoped update, no refusal line', async () => {
    const r = await run(fixture('checkout-completed-booking.json'), {
      owners: OWNER_A,
      db: { 'scheduling_bookings:update': { data: null, error: null, count: 1 } },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const [w] = writes(r, ['scheduling_bookings']);
    expect(w.chain[0]).toEqual(['update', expect.objectContaining({ payment_status: 'paid' }), { count: 'exact' }]);
    expect(w.chain).toContainEqual(['eq', 'id', 'bk-0001']);
    expect(w.chain).toContainEqual(['eq', 'user_id', 'owner-a']);
    expect(w.chain.some((c) => c[0] === 'select')).toBe(false);
    expect(mockLogLines.filter((l) => l.level === 'error')).toEqual([]);
  });

  it('H-4. payment_intent.succeeded, all links owned: all three kept, columns and metadata copy', async () => {
    const r = await run(fixture('payment-intent-succeeded.json'), {
      owners: OWNER_A,
      db: {
        'crm_contacts:select': ok({ id: LINK_CONTACT }),
        'scheduling_bookings:select': ok({ id: LINK_BOOKING }),
        'scheduling_services:select': ok({ id: LINK_SERVICE }),
      },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const row = insertPayload(r, 'payment_transactions');
    expect(row).toMatchObject({ user_id: 'owner-a', contact_id: LINK_CONTACT, booking_id: LINK_BOOKING, service_id: LINK_SERVICE });
    expect(row?.metadata).toEqual({ booking_id: LINK_BOOKING, service_id: LINK_SERVICE, source: 'payment_intent_webhook' });
    // Every ownership read is user-scoped to the proved owner.
    for (const table of ['crm_contacts', 'scheduling_bookings', 'scheduling_services']) {
      const [q] = reads(r, table);
      expect(q.chain).toEqual([['select', 'id'], ['eq', 'id', expect.any(String)], ['eq', 'user_id', 'owner-a']]);
      expect(q.terminal).toBe('maybeSingle');
    }
    expect(errorsLogged(LINK_DROPPED)).toEqual([]);
  });
});

// ─── 2. Failure and attack paths ─────────────────────────────────────────────

describe('Fix-1 QA: attacks and failures write nothing to another business', () => {
  it('A-1. invoice.paid metadata UUID naming a row with user_id NULL is refused before H3', async () => {
    const r = await run(fixture('invoice-paid.json'), {
      owners: OWNER_A,
      db: { 'payment_invoices:select': [PGRST116, ok({ ...VICTIM_INVOICE, user_id: null })] },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
    expect(errorsLogged(INVOICE_PAID_REFUSAL)).toHaveLength(1);
  });

  it('A-2. invoice.paid using the legacy `invoice_id` metadata key, foreign: refused before H3', async () => {
    const r = await run(withMetadata('invoice-paid.json', { invoice_id: 'pinv-0001' }), {
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': [PGRST116, ok(VICTIM_INVOICE)] },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
    expect(errorsLogged(INVOICE_PAID_REFUSAL)).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-0001' }]);
  });

  it('A-3. invoice.paid H1 path (row already carries this stripe_invoice_id) but owned by another business: refused', async () => {
    const r = await run(fixture('invoice-paid.json'), {
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': ok(VICTIM_INVOICE) },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
  });

  it('A-4. planted stripe_invoice_id on J/K/L with a row whose user_id is NULL: refused, nothing written', async () => {
    for (const name of ['invoice-payment-failed.json', 'invoice-finalized.json', 'invoice-marked-uncollectible.json']) {
      const r = await run(fixture(name), {
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ id: 'pinv-x', invoice_number: 'INV-X', user_id: null }) },
      });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      expect(writes(r, VICTIM_TABLES)).toEqual([]);
      expect(r.effects.some((e) => e.type === 'crmActivity.create')).toBe(false);
    }
  });

  it('A-5. J/K/L from an unmapped account: refused with the event-specific message, nothing written', async () => {
    const cases: Array<[string, string]> = [
      ['invoice-payment-failed.json', 'invoice.payment_failed'],
      ['invoice-finalized.json', 'invoice.finalized'],
      ['invoice-marked-uncollectible.json', 'invoice.marked_uncollectible'],
    ];
    for (const [name, label] of cases) {
      const r = await run(fixture(name), {
        owners: {},
        db: { 'payment_invoices:select': ok({ id: 'pinv-x', invoice_number: 'INV-X', user_id: 'owner-a' }) },
      });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      expect(writes(r, VICTIM_TABLES)).toEqual([]);
      expect(
        errorsLogged(`Connect ${label} names an invoice owned by a different business - refusing`)
      ).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-x' }]);
      expect(mockLogLines.some((l) => l.level === 'warn' && l.msg === 'Connect account maps to no known business')).toBe(true);
    }
  });

  it('A-6. J/K/L lookup read error: no owner lookup, nothing written, 200', async () => {
    for (const name of ['invoice-payment-failed.json', 'invoice-finalized.json', 'invoice-marked-uncollectible.json']) {
      const r = await run(fixture(name), {
        owners: OWNER_A,
        db: { 'payment_invoices:select': { data: null, error: { code: 'XX000', message: 'read failed' } } },
      });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      expect(writes(r, VICTIM_TABLES)).toEqual([]);
    }
  });

  it('A-7. invoice.paid metadata lookup read error: no H3 write, nothing recorded', async () => {
    const r = await run(fixture('invoice-paid.json'), {
      owners: OWNER_A,
      db: { 'payment_invoices:select': [PGRST116, { data: null, error: { code: 'XX000', message: 'read failed' } }] },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
  });

  it('A-8. checkout foreign booking with an update error: logged as an error, not as "0 rows", 200', async () => {
    const r = await run(fixture('checkout-completed-booking.json'), {
      owners: OWNED_BY_OTHER,
      db: { 'scheduling_bookings:update': { data: null, error: { code: 'XX000', message: 'x' }, count: null } },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const bookingWrites = writes(r, ['scheduling_bookings']);
    expect(bookingWrites).toHaveLength(1);
    expect(bookingWrites[0].chain).toContainEqual(['eq', 'user_id', 'owner-b']);
    expect(errorsLogged('Failed to update booking payment status')).toHaveLength(1);
    expect(errorsLogged('Connect checkout names a booking owned by a different business - no row updated')).toEqual([]);
  });

  it('A-9. checkout carrying BOTH a foreign invoice_id and a foreign booking_id: invoice branch refuses, booking never written', async () => {
    const r = await run(withMetadata('checkout-completed-booking.json', { invoice_id: 'pinv-0001', booking_id: 'bk-0001' }), {
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': ok({ ...VICTIM_INVOICE, status: 'sent', currency: 'USD' }) },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
  });

  it('A-10. payment_intent.succeeded with ALL three links foreign: all dropped, no raw foreign id anywhere in the row', async () => {
    const r = await run(
      withMetadata('payment-intent-succeeded.json', {
        owner_id: 'owner-a', contact_id: VICTIM_CONTACT, booking_id: VICTIM_BOOKING, service_id: VICTIM_SERVICE,
      }),
      { owners: OWNER_A, db: { 'crm_contacts:select': NOT_FOUND, 'scheduling_bookings:select': NOT_FOUND, 'scheduling_services:select': NOT_FOUND } }
    );
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const row = insertPayload(r, 'payment_transactions');
    expect(row).toMatchObject({ user_id: 'owner-a', contact_id: null, booking_id: null, service_id: null });
    expect(row?.metadata).toEqual({ booking_id: null, service_id: null, source: 'payment_intent_webhook' });
    expect(JSON.stringify(row)).not.toMatch(/deadbeef/);
    expect(errorsLogged(LINK_DROPPED).map((c) => [c.field, c.reason])).toEqual([
      ['contact_id', 'not_owned'], ['booking_id', 'not_owned'], ['service_id', 'not_owned'],
    ]);
    // The only writes are the claim rows and the one payment insert.
    expect(writes(r, ['scheduling_bookings', 'crm_contacts', 'scheduling_services', 'payment_invoices'])).toEqual([]);
  });

  it('A-11. payment_intent.succeeded, foreign booking AND the insert fails: 500, claim released, the attempted row had no booking', async () => {
    const r = await run(fixture('payment-intent-succeeded.json'), {
      owners: OWNER_A,
      db: {
        'crm_contacts:select': ok({ id: LINK_CONTACT }),
        'scheduling_bookings:select': NOT_FOUND,
        'scheduling_services:select': ok({ id: LINK_SERVICE }),
        'payment_transactions:insert': { data: null, error: { code: 'XX000', message: 'insert rejected' } },
      },
    });
    expect(r.status).toBe(500);
    expect(claimStatus(r)).toBe('failed');
    expect(insertPayload(r, 'payment_transactions')).toMatchObject({ booking_id: null });
    expect(writes(r, ['scheduling_bookings'])).toEqual([]);
  });

  it('A-12. payment_intent.succeeded from an unmapped account: refused before any link read or insert', async () => {
    const r = await run(fixture('payment-intent-succeeded.json'), { owners: {} });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
    for (const t of ['crm_contacts', 'scheduling_bookings', 'scheduling_services']) expect(reads(r, t)).toEqual([]);
  });

  it('A-13. every link read errors: all dropped with read_failed, money still recorded', async () => {
    const err: Answer = { data: null, error: { code: 'XX000', message: 'read failed' } };
    const r = await run(fixture('payment-intent-succeeded.json'), {
      owners: OWNER_A,
      db: { 'crm_contacts:select': err, 'scheduling_bookings:select': err, 'scheduling_services:select': err },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(insertPayload(r, 'payment_transactions')).toMatchObject({ contact_id: null, booking_id: null, service_id: null });
    expect(errorsLogged(LINK_DROPPED).map((c) => c.reason)).toEqual(['read_failed', 'read_failed', 'read_failed']);
  });
});

// ─── 3. Empty, absent, malformed, whitespace and case ────────────────────────

describe('Fix-1 QA: id shape edge cases', () => {
  it('E-1. empty-string link ids: no read, null, no log (same as the old `|| null`)', async () => {
    const r = await run(
      withMetadata('payment-intent-succeeded.json', { owner_id: 'owner-a', contact_id: '', booking_id: '', service_id: '' }),
      { owners: OWNER_A }
    );
    expect(r.status).toBe(200);
    for (const t of ['crm_contacts', 'scheduling_bookings', 'scheduling_services']) expect(reads(r, t)).toEqual([]);
    expect(insertPayload(r, 'payment_transactions')).toMatchObject({ contact_id: null, booking_id: null, service_id: null });
    expect(errorsLogged(LINK_DROPPED)).toEqual([]);
  });

  it('E-2. malformed / whitespace link ids: dropped as malformed with NO read, only their length logged (Fix-1b)', async () => {
    const r = await run(
      withMetadata('payment-intent-succeeded.json', {
        owner_id: 'owner-a', contact_id: '   ', booking_id: ` ${LINK_BOOKING} `, service_id: "x'); drop table--",
      }),
      { owners: OWNER_A, db: { 'crm_contacts:select': UUID_CAST, 'scheduling_bookings:select': UUID_CAST, 'scheduling_services:select': UUID_CAST } }
    );
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    // Fix-1b: a non-UUID cannot name a row, so it is never sent to the database.
    for (const t of ['crm_contacts', 'scheduling_bookings', 'scheduling_services']) expect(reads(r, t)).toEqual([]);
    expect(insertPayload(r, 'payment_transactions')).toMatchObject({ contact_id: null, booking_id: null, service_id: null });
    // Was `read_failed` (QA observation on Fix-1); now its own label, with the length instead of the value.
    expect(errorsLogged(LINK_DROPPED).map((c) => [c.field, c.reason, c.idLength, c.id])).toEqual([
      ['contact_id', 'malformed', 3, undefined],
      ['booking_id', 'malformed', 38, undefined],
      ['service_id', 'malformed', 17, undefined],
    ]);
    expect(JSON.stringify(mockLogLines)).not.toMatch(/drop table|b7b7b7b7/);
  });

  it('E-3. different-case link id: the stored value is the id the repository returned, not the raw metadata', async () => {
    const r = await run(
      withMetadata('payment-intent-succeeded.json', { owner_id: 'owner-a', booking_id: LINK_BOOKING.toUpperCase() }),
      { owners: OWNER_A, db: { 'scheduling_bookings:select': ok({ id: LINK_BOOKING }) } }
    );
    expect(reads(r, 'scheduling_bookings')[0].chain).toContainEqual(['eq', 'id', LINK_BOOKING.toUpperCase()]);
    const row = insertPayload(r, 'payment_transactions');
    expect(row).toMatchObject({ booking_id: LINK_BOOKING });
    expect((row?.metadata as Record<string, unknown>).booking_id).toBe(LINK_BOOKING);
  });

  it('E-4. different-case owner_id: refused by the pre-existing strict owner equality (fail closed, unchanged)', async () => {
    const r = await run(
      withMetadata('payment-intent-succeeded.json', { owner_id: 'OWNER-A', booking_id: 'bk-0002' }),
      { owners: OWNER_A }
    );
    expect(r.status).toBe(200);
    expect(writes(r, VICTIM_TABLES)).toEqual([]);
    expect(reads(r, 'scheduling_bookings')).toEqual([]);
  });

  it('E-5. checkout with an empty booking_id skips the booking branch (no owner lookup, no write)', async () => {
    const r = await run(withMetadata('checkout-completed-booking.json', { booking_id: '' }), { owners: OWNER_A });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    expect(writes(r, ['scheduling_bookings'])).toEqual([]);
    expect(ownerLookups(r)).toEqual([]);
  });

  it('E-6. checkout with a whitespace / malformed booking_id: the write is still owner-scoped; a uuid error is logged, 200', async () => {
    const r = await run(withMetadata('checkout-completed-booking.json', { booking_id: ' bk-0001 ' }), {
      owners: OWNER_A,
      db: { 'scheduling_bookings:update': { ...UUID_CAST, count: null } },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    const [w] = writes(r, ['scheduling_bookings']);
    expect(w.chain).toContainEqual(['eq', 'user_id', 'owner-a']);
  });

  it('E-7. invoice.paid with empty / absent metadata invoice id: no fallback lookup, no write', async () => {
    for (const metadata of [{ neuronforge_invoice_id: '' }, {}] as Record<string, string>[]) {
      const r = await run(withMetadata('invoice-paid.json', metadata), {
        owners: OWNER_A,
        db: { 'payment_invoices:select': PGRST116 },
      });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      expect(reads(r, 'payment_invoices')).toHaveLength(1);
      expect(writes(r, VICTIM_TABLES)).toEqual([]);
    }
  });
});

// ─── 4. Dedupe before ownership reads; owner cache ───────────────────────────

describe('Fix-1 QA: dedupe order and the account-owner cache', () => {
  it('D-1. a duplicate (completed) event runs no handler: no owner lookup, no ownership read, no write', async () => {
    const r = await run(fixture('payment-intent-succeeded.json'), {
      owners: OWNER_A,
      db: { 'processed_webhook_events:select': ok({ event_id: 'evt_connect_pi_succeeded', status: 'completed' }) },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, duplicate: true });
    expect(ownerLookups(r)).toEqual([]);
    expect(dbEffects(r).map((e) => `${e.table}:${e.operation}`)).toEqual(['processed_webhook_events:select']);
  });

  it('D-2. a payment already recorded (F1 dedupe) costs no link reads and no insert', async () => {
    const r = await run(fixture('payment-intent-succeeded.json'), {
      owners: OWNER_A,
      db: { 'payment_transactions:select': ok({ id: 'tx-existing' }) },
    });
    expect(r.status).toBe(200);
    expect(claimStatus(r)).toBe('completed');
    for (const t of ['crm_contacts', 'scheduling_bookings', 'scheduling_services']) expect(reads(r, t)).toEqual([]);
    expect(insertPayload(r, 'payment_transactions')).toBeUndefined();
  });

  it('C-1. one warm instance, two accounts: B\'s event is not decided by A\'s owner, and A\'s owner is looked up again on a later request (FU-5)', async () => {
    const POST = loadRoute();
    const owners = { acct_owner_a: 'owner-a', acct_owner_b: 'owner-b' };

    const first = await post(POST, fixture('checkout-completed-booking.json'), {
      owners, db: { 'scheduling_bookings:update': { data: null, error: null, count: 1 } },
    });
    expect(writes(first, ['scheduling_bookings'])[0].chain).toContainEqual(['eq', 'user_id', 'owner-a']);

    const fromB = { ...fixture('checkout-completed-booking.json'), id: 'evt_from_b', account: 'acct_owner_b' };
    const second = await post(POST, fromB, {
      owners, db: { 'scheduling_bookings:update': { data: null, error: null, count: 0 } },
    });
    expect(ownerLookups(second)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_b' }]);
    const [w] = writes(second, ['scheduling_bookings']);
    expect(w.chain).toContainEqual(['eq', 'user_id', 'owner-b']);
    expect(w.chain).not.toContainEqual(['eq', 'user_id', 'owner-a']);
    expect(errorsLogged('Connect checkout names a booking owned by a different business - no row updated')).toHaveLength(1);

    // And A again: FU-5 clears the cache at the start of every request, so A's
    // owner is looked up afresh (not served from the first request), still A's.
    const third = await post(POST, { ...fixture('checkout-completed-booking.json'), id: 'evt_a_again' }, {
      owners, db: { 'scheduling_bookings:update': { data: null, error: null, count: 1 } },
    });
    expect(ownerLookups(third)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
    expect(writes(third, ['scheduling_bookings'])[0].chain).toContainEqual(['eq', 'user_id', 'owner-a']);
  });

  it('C-2. FU-5 (QA note N-3, flipped): a null owner is not cached; once the account maps, the next event on the warm instance is written', async () => {
    // Before FU-5 the null from the first event was cached for the life of the
    // instance, so the second event was refused too (no lookup, no write).
    const POST = loadRoute();
    const finalized = (id: string) => ({ ...fixture('invoice-finalized.json'), id });
    const answer = { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }) };

    const first = await post(POST, finalized('evt_fu5_1'), { owners: {}, db: answer });
    expect(writes(first, VICTIM_TABLES)).toEqual([]);

    const second = await post(POST, finalized('evt_fu5_2'), { owners: OWNER_A, db: answer });
    expect(ownerLookups(second)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
    const [update] = writes(second, VICTIM_TABLES);
    expect(update.table).toBe('payment_invoices');
    expect(JSON.stringify(update.chain[0][1])).toContain('hosted_invoice_url');
    expect(update.chain).toContainEqual(['eq', 'id', 'pinv-0004']);
    expect(second.status).toBe(200);
    expect(claimStatus(second)).toBe('completed');
  });
});

// ─── 5. FU-5: a failed owner lookup is retried, never refused ─────────────────

/**
 * Before FU-5 a read error in the owner lookup came back as "maps to no
 * business": every owner check below refused, completed the claim, and Stripe
 * never retried. Now the resolver throws and the route's existing catch
 * releases the claim (`failed`) and answers 500.
 *
 * Each case carries a CONTROL: the same event and data with a foreign (or
 * absent) owner, which must hit that site's own refusal. That proves the error
 * case reached the site it names, not an earlier one.
 */
describe('FU-5 QA: an owner lookup error releases the claim on every owner-check site', () => {
  const LOOKUP_FAILED = 'Account owner lookup failed on stripe_connect_accounts (code XX000)';
  const OWNED_PLAN = ok({ id: 'plan-1', user_id: 'owner-a', status: 'active', installment_count: 3, periods_paid: 1 });
  const INVOICE_ROW = ok({ id: 'pinv-9', invoice_number: 'INV-9', user_id: 'owner-a' });
  const PLAN_TABLES = ['payment_plan_subscriptions', 'payment_plan_installments'];

  /** Basil invoice parent naming a subscription, optionally without plan terms. */
  function withSubscription(event: Record<string, unknown>, subscription: string, metadata: Record<string, string> = {}) {
    const object = (event.data as { object: Record<string, unknown> }).object;
    object.parent = { type: 'subscription_details', subscription_details: { subscription, metadata } };
    return event;
  }

  const logged = (msg: string) => mockLogLines.filter((l) => l.msg === msg);

  function failureMessage(r: Result): unknown {
    const updates = writes(r, ['processed_webhook_events']).filter((e) => e.operation === 'update');
    return (updates[updates.length - 1]?.chain[0][1] as { failure_message?: unknown } | undefined)?.failure_message;
  }

  interface Site {
    line: string;
    event: () => Record<string, unknown>;
    scenario: Omit<QaScenario, 'owners' | 'ownerErrors'>;
    /** Owners for the control run, and the line that proves the site was reached. */
    control: { owners: Record<string, string | null>; msg: string };
  }

  const SITES: Site[] = [
    {
      line: ':683 payment_intent.succeeded',
      event: () => fixture('payment-intent-succeeded.json'),
      scenario: {},
      control: { owners: OWNED_BY_OTHER, msg: 'payment_intent.succeeded claims an owner that does not own this account - refusing' },
    },
    {
      line: ':809 invoice.paid plan period (recordPlanPeriodPaid)',
      // No plan terms on the invoice, so the bind check (:1213) is skipped.
      event: () => withSubscription(fixture('invoice-paid-plan-period.json'), 'sub_plan_1'),
      scenario: { planBySubscription: OWNED_PLAN },
      control: { owners: OWNED_BY_OTHER, msg: 'Plan period from an account that does not own the plan - refusing' },
    },
    {
      line: ':1084 trialling plan (customer.subscription.created)',
      event: () => fixture('subscription-created-trialing-plan.json'),
      scenario: {},
      control: { owners: OWNED_BY_OTHER, msg: 'Trialling plan claims an owner this account does not own - refusing' },
    },
    {
      line: ':1213 invoice.paid first plan period (bind)',
      event: () => fixture('invoice-paid-plan-first-period-foreign-links.json'),
      scenario: {},
      control: { owners: OWNED_BY_OTHER, msg: 'Plan metadata claims an owner this account does not own - refusing' },
    },
    {
      line: ':1310 invoice.paid metadata path',
      event: () => fixture('invoice-paid.json'),
      scenario: { db: { 'payment_invoices:select': [PGRST116, ok({ ...VICTIM_INVOICE, booking_id: null })] } },
      control: { owners: OWNED_BY_OTHER, msg: INVOICE_PAID_REFUSAL },
    },
    {
      line: ':1331 invoice.paid H1 path (found by stripe_invoice_id)',
      event: () => fixture('invoice-paid.json'),
      scenario: { db: { 'payment_invoices:select': ok({ ...VICTIM_INVOICE, booking_id: null }) } },
      control: { owners: OWNED_BY_OTHER, msg: INVOICE_PAID_REFUSAL },
    },
    {
      line: ':1669 plan checkout (above the rethrowing try since CF-5 PR 4)',
      event: () => fixture('checkout-completed-plan-foreign-links.json'),
      scenario: {},
      control: { owners: OWNED_BY_OTHER, msg: 'Plan checkout names an owner this account does not own - refusing' },
    },
    {
      line: ':1717 checkout invoice',
      event: () => fixture('checkout-completed-invoice.json'),
      scenario: { db: { 'payment_invoices:select': ok({ ...VICTIM_INVOICE, id: 'pinv-0002' }) } },
      control: { owners: OWNED_BY_OTHER, msg: 'Connect checkout names an invoice owned by a different business - refusing' },
    },
    {
      line: ':1857 checkout booking (unmapped-account refusal)',
      event: () => fixture('checkout-completed-booking.json'),
      scenario: {},
      control: { owners: {}, msg: 'Connect checkout names a booking on an account that maps to no business - refusing' },
    },
    {
      line: ':1918 invoice.payment_failed plan branch',
      event: () => withSubscription(fixture('invoice-payment-failed.json'), 'sub_plan_1'),
      scenario: { planBySubscription: OWNED_PLAN },
      // Owned, the plan branch logs this and returns; it is the branch's only line.
      control: { owners: OWNER_A, msg: 'Plan marked past_due' },
    },
    {
      line: ':1944 invoice.payment_failed',
      event: () => fixture('invoice-payment-failed.json'),
      scenario: { db: { 'payment_invoices:select': INVOICE_ROW } },
      control: { owners: OWNED_BY_OTHER, msg: 'Connect invoice.payment_failed names an invoice owned by a different business - refusing' },
    },
    {
      line: ':2037 invoice.finalized',
      event: () => fixture('invoice-finalized.json'),
      scenario: { db: { 'payment_invoices:select': INVOICE_ROW } },
      control: { owners: OWNED_BY_OTHER, msg: 'Connect invoice.finalized names an invoice owned by a different business - refusing' },
    },
    {
      line: ':2087 invoice.marked_uncollectible',
      event: () => fixture('invoice-marked-uncollectible.json'),
      scenario: { db: { 'payment_invoices:select': INVOICE_ROW } },
      control: { owners: OWNED_BY_OTHER, msg: 'Connect invoice.marked_uncollectible names an invoice owned by a different business - refusing' },
    },
    {
      line: ':2151 Connect customer.subscription.deleted',
      event: () => fixture('subscription-deleted.json'),
      scenario: { db: { 'payment_plan_subscriptions:select': OWNED_PLAN } },
      control: { owners: OWNED_BY_OTHER, msg: 'Subscription ended on an account that does not own the plan it names' },
    },
  ];

  it('covers all 14 owner-check sites', () => {
    expect(SITES).toHaveLength(14);
  });

  it.each(SITES.map((s) => [s.line, s] as const))('FU5-E %s: 500, claim failed (table + code only), nothing written', async (_line, site) => {
    // Control: the data reaches this site's own owner check.
    const control = await run(site.event(), { ...site.scenario, owners: site.control.owners });
    expect(logged(site.control.msg)).toHaveLength(1);
    expect(control.status).toBe(200);
    expect(ownerLookups(control)).toHaveLength(1);

    const r = await run(site.event(), { ...site.scenario, owners: OWNER_A, ownerErrors: ['acct_owner_a'] });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ success: false, error: 'Webhook processing failed' });
    expect(claimStatus(r)).toBe('failed');
    expect(failureMessage(r)).toBe(LOOKUP_FAILED);
    expect(ownerLookups(r)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
    expect(logged(site.control.msg)).toEqual([]);
    expect(writes(r, [...VICTIM_TABLES, ...PLAN_TABLES])).toEqual([]);
    expect(r.effects.filter((e) => e.type === 'bindPlanSubscription' || e.type === 'crmActivity.create')).toEqual([]);
  });

  /*
   * CF-5 PR 4 moved this owner check above the plan-checkout `try` (FU-5 SA Q-3).
   * The outcome is unchanged (500, claim released, Stripe retries); the error no
   * longer passes through the catch, so it is no longer mislogged as an unbounded
   * plan. Before PR 4 this asserted that line once. A bind that throws still
   * gets it: Q3-1 at the end of this file.
   */
  it('FU5-E :1669: the error is thrown above the plan-checkout catch, so it is not logged as an unbounded plan (SA Q-3, CF-5 PR 4)', async () => {
    const r = await run(fixture('checkout-completed-plan-foreign-links.json'), { owners: OWNER_A, ownerErrors: ['acct_owner_a'] });
    expect(r.status).toBe(500);
    expect(errorsLogged('Could not bound a payment plan - subscription may bill indefinitely')).toEqual([]);
  });
});

describe('FU-5 QA: recovery, true unmapped, and the per-request cache', () => {
  const finalized = (id: string) => ({ ...fixture('invoice-finalized.json'), id });
  const answer = { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }) };

  it('FU5-R. warm instance: a lookup error gives 500; the redelivery of the same event after recovery is written', async () => {
    const POST = loadRoute();

    const first = await post(POST, finalized('evt_fu5_r'), { owners: OWNER_A, ownerErrors: ['acct_owner_a'], db: answer });
    expect(first.status).toBe(500);
    expect(claimStatus(first)).toBe('failed');
    expect(writes(first, VICTIM_TABLES)).toEqual([]);

    // The redelivery finds its claim `failed`, reclaims it, and looks the owner
    // up afresh: nothing from the failed attempt was cached.
    const second = await post(POST, finalized('evt_fu5_r'), {
      owners: OWNER_A,
      db: { ...answer, 'processed_webhook_events:select': ok({ event_id: 'evt_fu5_r', status: 'failed' }) },
    });
    expect(second.status).toBe(200);
    expect(ownerLookups(second)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
    const [update] = writes(second, VICTIM_TABLES);
    expect(update.table).toBe('payment_invoices');
    expect(update.chain).toContainEqual(['eq', 'id', 'pinv-0004']);
    expect(claimStatus(second)).toBe('completed');
  });

  it('FU5-U. a truly unmapped account still refuses with 200 and completes; each event looks again (null is not cached)', async () => {
    const POST = loadRoute();
    for (const id of ['evt_fu5_u1', 'evt_fu5_u2']) {
      const r = await post(POST, finalized(id), { owners: {}, db: answer });
      expect(r.status).toBe(200);
      expect(claimStatus(r)).toBe('completed');
      expect(writes(r, VICTIM_TABLES)).toEqual([]);
      expect(ownerLookups(r)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
      expect(errorsLogged('Connect invoice.finalized names an invoice owned by a different business - refusing')).toHaveLength(1);
    }
  });

  it('FU5-Q. one request checking the same mapped account twice (plan bind :1213, then the period :809) looks it up once', async () => {
    const r = await run(fixture('invoice-paid-plan-period.json'), {
      owners: OWNER_A,
      planBySubscription: ok({ id: 'plan-1', user_id: 'owner-a', status: 'active', installment_count: 3, periods_paid: 1 }),
    });
    expect(r.status).toBe(200);
    expect(r.effects.filter((e) => e.type === 'bindPlanSubscription')).toHaveLength(1);
    expect(mockLogLines.some((l) => l.msg === 'Plan period from an account that does not own the plan - refusing')).toBe(false);
    expect(ownerLookups(r)).toEqual([{ type: 'resolveAccountOwner', accountId: 'acct_owner_a' }]);
  });
});

// ─── CF-5 PR 4: the plan-checkout catch ──────────────────────────────────────

/*
 * CF-5 PR 4 moves the plan-checkout owner check above its `try` (FU-5 SA Q-3),
 * so an owner-lookup failure is no longer logged as an unbounded plan (the
 * FU5-E `:1669` test above). This pins the other half: a bind that throws still
 * goes through that catch exactly as before. Written against the untouched
 * route first (workplan §7.3.5).
 */
describe('CF-5 PR 4: a failed bind still goes through the plan-checkout catch (FU-5 SA Q-3)', () => {
  it('Q3-1. bindPlanSubscription throws: 500, claim failed with its message, logged once as a possibly unbounded plan', async () => {
    const r = await run(fixture('checkout-completed-plan-foreign-links.json'), {
      owners: OWNER_A,
      bindError: 'Stripe refused the schedule',
    });

    expect(r.status).toBe(500);
    expect(claimStatus(r)).toBe('failed');
    const releases = writes(r, ['processed_webhook_events']).filter((e) => e.operation === 'update');
    expect((releases[releases.length - 1].chain[0][1] as { failure_message?: unknown }).failure_message).toBe(
      'Stripe refused the schedule'
    );
    expect(errorsLogged('Could not bound a payment plan - subscription may bill indefinitely')).toHaveLength(1);
    expect(errorsLogged('Plan checkout names an owner this account does not own - refusing')).toEqual([]);
    // Same order as before the hoist: the Stripe client, the owner lookup, then the bind.
    expect(
      r.effects
        .filter((e) => ['stripe.client', 'resolveAccountOwner', 'bindPlanSubscription'].includes(e.type))
        .map((e) => e.type)
    ).toEqual(['stripe.client', 'resolveAccountOwner', 'bindPlanSubscription']);
  });
});
