/**
 * Characterisation harness: what the Stripe webhook DOES on the Connect path.
 *
 * WHY THIS EXISTS
 *
 * The webhook carries the live payments of Business OS clients (invoices,
 * bookings, payment plans, refunds, disputes), and before this file no test
 * executed it. This harness imports the real `POST`, feeds it synthetic Connect
 * events (Basil-shaped, `fixtures/connect/*.json`) and records everything the
 * route does to the outside world, in order:
 *
 *   - every Supabase operation: table, operation, the full builder chain
 *     (filters, payloads) and how it was terminated;
 *   - every Stripe client constructed;
 *   - every call to the side services the Connect path uses (account owner
 *     lookup, plan binding, plan repository, fee and payment-intent resolvers,
 *     booking sync, dispute alert, CRM activity, audit trail, quota service);
 *   - the HTTP status and body returned.
 *
 * The snapshot was recorded on the UNCONVERTED route (plan payments P-0, task
 * A3) and must stay byte-identical after the Pino conversion (task C3). It is
 * the standing Connect regression asset for later webhook slices (SR-10 /
 * AC-SR.3).
 *
 * LOGGING IS EXCLUDED FROM THE SNAPSHOT, ON PURPOSE (SA condition P0-C1).
 * The `@/lib/logger` mock is a no-op that records nothing, and `console` is
 * silenced without being captured. If either fed the snapshot, the conversion
 * would change it by construction and the before/after comparison would prove
 * nothing. Do not add a logger or console spy to the recorded effects.
 *
 * Timestamps the route takes from the clock (`new Date()`) are replaced with
 * `<NOW>`; timestamps derived from the fixtures are kept as they are.
 *
 * The route is re-imported for each scenario (`jest.isolateModules`) because it
 * keeps a module-level account-owner cache: without a fresh module, one
 * scenario's cache would decide whether the next one looks the owner up.
 *
 * PLAN PAYMENTS P-1 extended this file with platform scenarios (the Business OS
 * router, deny by default) in a second `describe`. The Connect snapshots must
 * stay byte-identical (SR-10, SA P1-C4). P-1 needs to assert WHICH deny reason
 * the route logged, so the logger mock now keeps lines in `mockLogLines`, a side
 * channel that the P-1 scenarios assert on explicitly and that `run()` never
 * returns: logging still does not reach any snapshot (P0-C1 holds).
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

// ─── Recorder ────────────────────────────────────────────────────────────────

type Answer = { data: unknown; error: unknown };

interface Scenario {
  fixture: string;
  /** Fixture folder under `fixtures/`. Default `connect` (the P-0 scenarios). */
  fixtureDir?: 'connect' | 'platform';
  /**
   * P-1: price id → lookup key the plan catalog should "know". Unset → the real
   * catalog (empty in P-1, so nothing is recognised).
   */
  knownPlanPrices?: Record<string, string>;
  /** Connected account → the business it maps to (resolveAccountOwner). */
  owners?: Record<string, string | null>;
  /** `table:operation` → answer, or answers consumed in order. Default: no rows, no error. */
  db?: Record<string, Answer | Answer[]>;
  planLookup?: Answer;
  invoicePaymentIntent?: string | null;
  processorFee?: { fee: number; net: number; feeCurrency: string } | null;
}

const mockEffects: unknown[] = [];
let mockScenario: Scenario = { fixture: '' };
let mockEvent: unknown = null;
const mockDbQueues: Record<string, Answer[]> = {};
/** Side channel for P-1 log assertions. Never part of a snapshot (P0-C1). */
const mockLogLines: Array<{ level: string; ctx: unknown; msg: unknown }> = [];

function mockRecord(effect: Record<string, unknown>): void {
  mockEffects.push(effect);
}

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

function mockAnswerFor(table: string, operation: string): Answer {
  const key = `${table}:${operation}`;
  const queue = mockDbQueues[key];
  if (queue && queue.length > 0) return queue.shift() as Answer;
  return { data: null, error: null };
}

/** A PostgREST builder that records its whole chain when it is resolved. */
function mockBuilder(table: string, calls: unknown[][]): unknown {
  const resolve = (terminal: string) => {
    const writeCall = calls.find((c) => WRITE_OPS.has(String(c[0])));
    const operation = writeCall ? String(writeCall[0]) : 'select';
    mockRecord({ type: 'db', table, operation, chain: calls, terminal });
    return Promise.resolve(mockAnswerFor(table, operation));
  };

  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
            resolve('await').then(onFulfilled, onRejected);
        }
        if (prop === 'single' || prop === 'maybeSingle') return () => resolve(String(prop));
        return (...args: unknown[]) => mockBuilder(table, [...calls, [String(prop), ...args]]);
      },
    }
  );
}

const mockSupabase = { __mockKind: 'supabase-admin', from: (table: string) => mockBuilder(table, []) };

// ─── Module mocks ────────────────────────────────────────────────────────────

// Logging: records nothing into the snapshot (P0-C1). Lines go only to the
// `mockLogLines` side channel, which `run()` does not return.
jest.mock('@/lib/logger', () => {
  const at = (level: string) => (ctx: unknown, msg?: unknown): void => {
    mockLogLines.push({ level, ctx, msg });
  };
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace: at('trace'), fatal: at('fatal'),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

// P-1: the plan catalog is the real one unless a scenario says which prices it knows.
jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return {
    ...actual,
    planPriceCatalog: {
      load: (...args: unknown[]) =>
        mockScenario.knownPlanPrices
          ? Promise.resolve({ byPriceId: new Map(Object.entries(mockScenario.knownPlanPrices)), fromCache: false })
          : actual.planPriceCatalog.load(...args),
    },
  };
});

jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupabase }));

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => {
    mockRecord({ type: 'stripe.client' });
    return { __mockKind: 'stripe-client' };
  })
);

jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({
    constructWebhookEvent: (_body: string, _signature: string, secret: string) => {
      mockRecord({ type: 'stripe.constructWebhookEvent', secret });
      return mockEvent;
    },
  }),
}));

jest.mock('@/lib/payments/stripeAccountContext', () => ({
  ...jest.requireActual('@/lib/payments/stripeAccountContext'),
  resolveAccountOwner: (...args: unknown[]) => {
    mockRecord({ type: 'resolveAccountOwner', args });
    const accountId = String(args[1]);
    return Promise.resolve(mockScenario.owners?.[accountId] ?? null);
  },
}));

jest.mock('@/lib/payments/processorFee', () => ({
  ...jest.requireActual('@/lib/payments/processorFee'),
  resolveProcessorFee: (...args: unknown[]) => {
    mockRecord({ type: 'resolveProcessorFee', args });
    return Promise.resolve(mockScenario.processorFee ?? null);
  },
}));

jest.mock('@/lib/payments/invoicePaymentIntent', () => ({
  resolveInvoicePaymentIntent: (...args: unknown[]) => {
    mockRecord({ type: 'resolveInvoicePaymentIntent', args });
    return Promise.resolve(mockScenario.invoicePaymentIntent ?? null);
  },
}));

jest.mock('@/lib/payments/bindPlanSubscription', () => ({
  bindPlanSubscription: (...args: unknown[]) => {
    mockRecord({ type: 'bindPlanSubscription', args });
    return Promise.resolve({ scheduleId: 'sub_sched_1' });
  },
}));

jest.mock('@/lib/payments/syncBookingPaymentState', () => ({
  syncBookingsForTransactions: (...args: unknown[]) => {
    mockRecord({ type: 'syncBookingsForTransactions', args });
    return Promise.resolve();
  },
}));

jest.mock('@/lib/repositories/PaymentPlanSubscriptionRepository', () => ({
  paymentPlanSubscriptionRepository: {
    findBySubscriptionId: (...args: unknown[]) => {
      mockRecord({ type: 'planRepo.findBySubscriptionId', args });
      return Promise.resolve(mockScenario.planLookup ?? { data: null, error: null });
    },
    recordPeriodPaid: (...args: unknown[]) => {
      mockRecord({ type: 'planRepo.recordPeriodPaid', args });
      return Promise.resolve({ data: null, error: null });
    },
    recordFailure: (...args: unknown[]) => {
      mockRecord({ type: 'planRepo.recordFailure', args });
      return Promise.resolve({ data: null, error: null });
    },
    close: (...args: unknown[]) => {
      mockRecord({ type: 'planRepo.close', args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: {
    create: (...args: unknown[]) => {
      mockRecord({ type: 'crmActivity.create', args });
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

jest.mock('@/lib/services/DisputeAlertService', () => ({
  notifyOwnerOfDispute: (...args: unknown[]) => {
    mockRecord({ type: 'notifyOwnerOfDispute', args });
    return Promise.resolve();
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  auditLog: (...args: unknown[]) => {
    mockRecord({ type: 'auditLog', args });
    return Promise.resolve();
  },
}));

jest.mock('@/lib/services/QuotaAllocationService', () => ({
  QuotaAllocationService: jest.fn().mockImplementation(() => ({
    allocateQuotasForUser: (...args: unknown[]) => {
      mockRecord({ type: 'quota.allocateQuotasForUser', args });
      return Promise.resolve({ success: true, storageQuotaMB: 100, executionQuota: null });
    },
  })),
}));

jest.mock('@/lib/utils/pricingConfig', () => ({
  pilotCreditsToTokens: (...args: unknown[]) => {
    mockRecord({ type: 'pilotCreditsToTokens', args: [args[0]] });
    return Promise.resolve(Number(args[0]) * 10);
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FIXTURES = path.join(__dirname, 'fixtures');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
let runStartedAt = Date.now();

/** Replace mock clients with markers and clock-derived timestamps with <NOW>. */
function sanitise(value: unknown): unknown {
  if (typeof value === 'string' && ISO.test(value)) {
    const t = Date.parse(value);
    return Math.abs(t - runStartedAt) < 10 * 60 * 1000 ? '<NOW>' : value;
  }
  if (Array.isArray(value)) return value.map(sanitise);
  if (value && typeof value === 'object') {
    const kind = (value as { __mockKind?: string }).__mockKind;
    if (kind) return `<${kind}>`;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitise(v)]));
  }
  return value;
}

async function run(scenario: Scenario) {
  mockEffects.length = 0;
  for (const key of Object.keys(mockDbQueues)) delete mockDbQueues[key];
  for (const [key, answer] of Object.entries(scenario.db ?? {})) {
    mockDbQueues[key] = Array.isArray(answer) ? [...answer] : [answer];
  }
  mockLogLines.length = 0;
  mockScenario = scenario;
  mockEvent = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, scenario.fixtureDir ?? 'connect', scenario.fixture), 'utf8')
  );
  runStartedAt = Date.now();

  let POST: (req: NextRequest) => Promise<Response> = async () => {
    throw new Error('route not loaded');
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module per scenario (owner cache)
    POST = require('../route').POST;
  });

  const request = new NextRequest('http://localhost/api/stripe/webhook', {
    method: 'POST',
    body: JSON.stringify({ placeholder: true }),
    headers: { 'stripe-signature': 't=1790000000,v1=deadbeef' },
  });

  const response = await POST(request);
  // Let fire-and-forget side effects (dispute alert, CRM activity) settle.
  await new Promise((r) => setImmediate(r));

  return sanitise({
    status: response.status,
    body: await response.json(),
    effects: [...mockEffects],
  });
}

const ok = (data: unknown = null): Answer => ({ data, error: null });
const OWNER_A = { acct_owner_a: 'owner-a' };
const OWNED_BY_OTHER = { acct_owner_a: 'owner-b' };

const PLATFORM_INVOICE = {
  id: 'pinv-0001',
  user_id: 'owner-a',
  contact_id: 'ct-1',
  invoice_number: 'INV-001',
  booking_id: 'bk-0001',
  amount: 150,
};

// ─── Scenarios ───────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_platform_test';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_harness';
  // Silenced, never captured: console output must not feed the snapshot (P0-C1).
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation(() => undefined);
  }
});

afterAll(() => jest.restoreAllMocks());

describe('Stripe webhook, Connect path characterisation (P-0 baseline)', () => {
  it('1a. invoice.paid, platform invoice found by stripe_invoice_id, owned, booking linked', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE) },
        invoicePaymentIntent: 'pi_invoice_1',
        processorFee: { fee: 4.65, net: 145.35, feeCurrency: 'USD' },
      })
    ).toMatchSnapshot();
  });

  /*
   * Renamed, not re-snapshotted quietly.
   *
   * This case used to characterise the amount-matching GUESS: an invoice with no
   * `booking_id` was bound, on payment, to whichever recent unpaid booking had a
   * service priced the same. That behaviour has been removed — it bound a
   * standalone invoice to an unrelated booking and marked that booking paid with
   * money that was never for it.
   *
   * The fixture still offers a booking that would have matched (`bk-guess`,
   * priced 150). The point of the case is now that it is NOT taken.
   */
  it('1b. invoice.paid with no booking_id is left unlinked — the booking is never guessed', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': [
            { data: null, error: { code: 'PGRST116', message: 'no rows' } },
            ok({ ...PLATFORM_INVOICE, booking_id: null }),
          ],
          'scheduling_bookings:select': ok({ id: 'bk-guess', service: { price: 150 } }),
        },
        invoicePaymentIntent: null,
        processorFee: null,
      })
    ).toMatchSnapshot();
  });

  it('2. invoice.paid naming an invoice owned by another business is refused', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNED_BY_OTHER,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE) },
      })
    ).toMatchSnapshot();
  });

  it('3. invoice.paid for a payment-plan period (Basil parent.subscription_details)', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok({
          id: 'plan-1',
          user_id: 'owner-a',
          contact_id: 'ct-2',
          booking_id: 'bk-plan-1',
          service_id: 'svc-1',
          currency: 'ILS',
          periods_paid: 0,
          installment_count: 3,
        }),
        db: {
          'payment_plan_installments:select': [ok(null), ok({ due_date: '2026-12-01', amount: '333.33' })],
          'payment_transactions:insert': ok({ id: 'tx-plan-1' }),
        },
        invoicePaymentIntent: 'pi_plan_1',
        processorFee: { fee: 12.5, net: 320.83, feeCurrency: 'ILS' },
      })
    ).toMatchSnapshot();
  });

  it('4a. checkout.session.completed for an invoice', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': ok({
            id: 'pinv-0002',
            user_id: 'owner-a',
            contact_id: 'ct-1',
            invoice_number: 'INV-002',
            currency: 'EUR',
            status: 'sent',
            booking_id: 'bk-0003',
          }),
        },
      })
    ).toMatchSnapshot();
  });

  it('4b. checkout.session.completed for a booking', async () => {
    expect(await run({ fixture: 'checkout-completed-booking.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('5a. payment_intent.succeeded, the owner owns the account', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        processorFee: { fee: 180, net: 4820, feeCurrency: 'JPY' },
      })
    ).toMatchSnapshot();
  });

  it('5b. payment_intent.succeeded claiming an owner that does not own the account is refused', async () => {
    expect(await run({ fixture: 'payment-intent-succeeded.json', owners: OWNED_BY_OTHER })).toMatchSnapshot();
  });

  it('6a. invoice.payment_failed marks the invoice overdue and logs CRM activity', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': [
            ok({ id: 'pinv-0003', invoice_number: 'INV-003', user_id: 'owner-a' }),
            ok({ contact_id: 'ct-1', amount: 120, currency: 'USD' }),
          ],
          'business_profiles:select': ok({ language: 'en' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('6b. invoice.finalized stores the hosted URL and PDF', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004' }) },
      })
    ).toMatchSnapshot();
  });

  it('6c. invoice.marked_uncollectible cancels the invoice', async () => {
    expect(
      await run({
        fixture: 'invoice-marked-uncollectible.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ id: 'pinv-0005', invoice_number: 'INV-005' }) },
      })
    ).toMatchSnapshot();
  });

  it('7a. charge.refunded on a Connect charge records each refund', async () => {
    expect(
      await run({
        fixture: 'charge-refunded.json',
        owners: OWNER_A,
        db: {
          'payment_transactions:select': ok([
            { id: 'tx-1', user_id: 'owner-a', invoice_id: 'pinv-0001', currency: 'usd' },
          ]),
        },
      })
    ).toMatchSnapshot();
  });

  it('7b. charge.dispute.created marks the payment disputed and alerts the owner', async () => {
    expect(
      await run({
        fixture: 'charge-dispute-created.json',
        owners: OWNER_A,
        db: {
          'payment_transactions:select': ok([
            {
              id: 'tx-1',
              user_id: 'owner-a',
              status: 'succeeded',
              amount: 150,
              currency: 'USD',
              contact_id: 'ct-1',
              metadata: { source: 'payment_intent_webhook' },
            },
          ]),
        },
      })
    ).toMatchSnapshot();
  });

  it('8. customer.subscription.deleted on a Connect account ends the plan', async () => {
    expect(
      await run({
        fixture: 'subscription-deleted.json',
        owners: OWNER_A,
        db: {
          'payment_plan_subscriptions:select': ok({
            id: 'plan-1',
            user_id: 'owner-a',
            status: 'active',
            installment_count: 3,
            periods_paid: 1,
          }),
        },
      })
    ).toMatchSnapshot();
  });

  it('9a. a duplicate delivery of a completed event is short-circuited', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: { 'processed_webhook_events:select': ok({ event_id: 'evt_connect_invoice_finalized', status: 'completed' }) },
      })
    ).toMatchSnapshot();
  });

  it('9b. an in-flight delivery (processing) is short-circuited', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: { 'processed_webhook_events:select': ok({ event_id: 'evt_connect_invoice_finalized', status: 'processing' }) },
      })
    ).toMatchSnapshot();
  });

  it('9c. a previously failed event is reclaimed and processed', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: {
          'processed_webhook_events:select': ok({ event_id: 'evt_connect_invoice_finalized', status: 'failed' }),
          'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('10. a handler that throws releases the claim to failed and returns 500', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        db: { 'payment_transactions:insert': { data: null, error: { code: 'XX000', message: 'insert rejected' } } },
      })
    ).toMatchSnapshot();
  });

  it('11. platform invoice.paid with no user_id anywhere returns early (sanity only)', async () => {
    expect(await run({ fixture: 'platform-invoice-paid-no-user.json' })).toMatchSnapshot();
  });
});

// ─── P-1: platform events through the Business OS router ─────────────────────

type Effect = Record<string, unknown>;
const effectsOf = (result: unknown): Effect[] => (result as { effects: Effect[] }).effects;
const statusOf = (result: unknown): number => (result as { status: number }).status;

/** Tables the Pilot-Credit conversions wrote. */
const CREDIT_TABLES = ['user_subscriptions', 'credit_transactions', 'billing_events', 'subscription_invoices'];

function writesTo(result: unknown, tables: string[]): string[] {
  return effectsOf(result)
    .filter((e) => e.type === 'db' && e.operation !== 'select' && tables.includes(String(e.table)))
    .map((e) => `${e.table}:${e.operation}`);
}

/** The status the last claim update set, if any. */
function claimStatus(result: unknown): string | undefined {
  const updates = effectsOf(result).filter(
    (e) => e.type === 'db' && e.table === 'processed_webhook_events' && e.operation === 'update'
  );
  const last = updates[updates.length - 1] as { chain: unknown[][] } | undefined;
  return (last?.chain[0][1] as { status?: string } | undefined)?.status;
}

/** A Stripe client constructed = a Stripe API call was about to be made (retrieve / list). */
const stripeTouched = (result: unknown): boolean => effectsOf(result).some((e) => e.type === 'stripe.client');

function logged(event: string): Array<{ level: string; reason: unknown; alert: unknown }> {
  return mockLogLines
    .filter((l) => (l.ctx as { event?: string } | null)?.event === event)
    .map((l) => ({
      level: l.level,
      reason: (l.ctx as { reason?: unknown }).reason,
      alert: (l.ctx as { alert?: unknown }).alert,
    }));
}

describe('Stripe webhook, platform path through the Business OS router (P-1)', () => {
  it('P1. hazard: invoice.paid, unknown price, legacy user_id + credits metadata is denied, nothing credited', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'invoice-paid-unknown-price-legacy-metadata.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(stripeTouched(result)).toBe(false);
    expect(logged('bos_billing_event_denied')).toEqual([{ level: 'warn', reason: 'unknown_price', alert: undefined }]);
  });

  it('P2. fallback shape: invoice.paid, unknown price, no metadata: the customer fallback is never consulted', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'invoice-paid-unknown-price-no-metadata.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(stripeTouched(result)).toBe(false);
    expect(logged('bos_billing_event_denied')).toEqual([{ level: 'warn', reason: 'unknown_price', alert: undefined }]);
  });

  it('P3. invoice.paid on a price the catalog knows: no handler yet, claim released, 500', async () => {
    const result = await run({
      fixtureDir: 'platform',
      fixture: 'invoice-paid-known-price.json',
      knownPlanPrices: { price_bos_probe_a: 'bos_router_fixture_probe_a' },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(500);
    expect(claimStatus(result)).toBe('failed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(logged('bos_billing_event_denied')).toEqual([]);
    expect(logged('bos_billing_plan_unhandled')).toEqual([{ level: 'warn', reason: undefined, alert: undefined }]);
  });

  it('P4. invoice.paid, unknown price but a Business OS marker: denied and alerted', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'invoice-paid-unknown-price-bos-marker.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(logged('bos_billing_event_denied')).toEqual([{ level: 'error', reason: 'metadata_mismatch', alert: true }]);
  });

  it('P5. subscription-mode checkout.session.completed with credits metadata is denied, nothing credited', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'checkout-completed-subscription.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(logged('bos_billing_event_denied')).toEqual([
      { level: 'warn', reason: 'legacy_subscription_checkout', alert: undefined },
    ]);
  });

  it('P6. boost-pack checkout.session.completed still runs the boost-pack branch (TK-5)', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'checkout-completed-boost-pack.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(logged('bos_billing_event_denied')).toEqual([]);
    expect(writesTo(result, ['credit_transactions'])).toEqual(['credit_transactions:insert']);
  });

  it('P7. invoice.payment_failed, unknown price is denied: the legacy dunning does not run (SA Q-1)', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'invoice-payment-failed-unknown-price.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(logged('bos_billing_event_denied')).toEqual([{ level: 'warn', reason: 'unknown_price', alert: undefined }]);
  });
});

// ─── P-10: the agent-platform subscription status mirror ─────────────────────

//
// Both scenarios were recorded against the UNMODIFIED route first (SA P10-C3);
// the pre-edit P10-1 snapshot is kept in the P-10 workplan evidence log because
// this file's copy is overwritten by the after-run. Before P-10, P10-1 also
// wrote `monthly_credits` / `monthly_amount_usd`, inserted a `billing_events`
// row and called the quota service. P10-2 never wrote anything, before or after.

/** The payloads of every `user_subscriptions` update, in order. */
function userSubscriptionUpdates(result: unknown): Array<Record<string, unknown>> {
  return effectsOf(result)
    .filter((e) => e.type === 'db' && e.table === 'user_subscriptions' && e.operation === 'update')
    .map((e) => (e as { chain: unknown[][] }).chain[0][1] as Record<string, unknown>);
}

describe('Stripe webhook, platform customer.subscription.updated (P-10)', () => {
  it('P10-1. legacy user_id + credits metadata: only the status mirror is written', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'subscription-updated-legacy.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual(['user_subscriptions:update']);
    expect(userSubscriptionUpdates(result).map((payload) => Object.keys(payload).sort())).toEqual([
      ['cancel_at_period_end', 'canceled_at', 'status'],
    ]);
    expect(effectsOf(result).some((e) => e.type === 'quota.allocateQuotasForUser')).toBe(false);
  });

  it('P10-2. no credits metadata: nothing is written', async () => {
    const result = await run({ fixtureDir: 'platform', fixture: 'subscription-updated-no-credits.json' });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, CREDIT_TABLES)).toEqual([]);
    expect(effectsOf(result).some((e) => e.type === 'quota.allocateQuotasForUser')).toBe(false);
  });
});
