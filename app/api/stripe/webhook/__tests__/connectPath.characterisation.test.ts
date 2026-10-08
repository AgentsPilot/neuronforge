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
 *
 * CF-5 PR 0 (webhook queries to repositories) added the last `describe`, the
 * `eventPatch` and `dispatch` knobs, and two named delegations on the plan
 * subscription repository mock. The 45 entries before it are byte-identical.
 * This file is not edited again during CF-5 PRs 1 to 5: they prove themselves
 * against it as it stands. One exception: CF-5 PR 3 added its own `describe`
 * (X56 to X58) for #257's attach arms, which landed after PR 0, written against
 * the untouched route before PR 3 moved them.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

// ─── Recorder ────────────────────────────────────────────────────────────────

/** `count` only for a write sent with `{ count: 'exact' }` (Fix-1, F-2). */
type Answer = { data: unknown; error: unknown; count?: number | null };

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
  /**
   * FU-5: accounts whose owner lookup fails with a read error. The stub rejects
   * with the message the real resolver throws.
   */
  ownerLookupFails?: string[];
  /** `table:operation` → answer, or answers consumed in order. Default: no rows, no error. */
  db?: Record<string, Answer | Answer[]>;
  planLookup?: Answer;
  invoicePaymentIntent?: string | null;
  processorFee?: { fee: number; net: number; feeCurrency: string } | null;
  /**
   * CF-5 PR 0: deep-merged into the fixture before the run. Plain objects merge;
   * anything else (`null` included) replaces. Unset → the fixture as read.
   */
  eventPatch?: Record<string, unknown>;
  /**
   * CF-5 PR 0: overrides the Business OS router's outcome for this scenario
   * only, and records that it did. Unset → the real dispatcher, unrecorded.
   * Used to reach `handleInvoicePaymentFailed`, which the router keeps out of
   * reach of `POST` today (workplan §7.3.1, X2/X3).
   */
  dispatch?: 'not_business_os';
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

// The plan catalog knows exactly the prices a scenario names, and none otherwise
// (P-2b, workplan §3.3). Never the real catalog: once the lookup keys are filled
// and the recognition switch is on, it would ask Stripe.
jest.mock('@/lib/business-os/billing/planPriceCatalog', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/planPriceCatalog');
  return {
    ...actual,
    planPriceCatalog: {
      load: () =>
        Promise.resolve({ byPriceId: new Map(Object.entries(mockScenario.knownPlanPrices ?? {})), fromCache: false }),
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
    if (mockScenario.ownerLookupFails?.includes(accountId)) {
      return Promise.reject(new Error('Account owner lookup failed on stripe_connect_accounts (code XX000)'));
    }
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
    /*
     * CF-5 PR 4's two methods (workplan §3), delegated to the REAL repository by
     * name, so they record nothing of their own: their query records through
     * `mockSupabase` exactly as the inline query in `handlePlanSubscriptionEnded`
     * does today, and entries 8, X6, X40, X41 and X51 must not move when PR 4
     * lands.
     * An explicit list, not a catch-all (SA C-4): any other unlisted method is
     * still a TypeError, not a silent trip to the DB mock. Resolved at call time
     * because the methods do not exist until PR 4.
     */
    findEndStateBySubscriptionId: (...args: unknown[]) =>
      jest.requireActual('@/lib/repositories/PaymentPlanSubscriptionRepository')
        .paymentPlanSubscriptionRepository.findEndStateBySubscriptionId(...args),
    endFromStripe: (...args: unknown[]) =>
      jest.requireActual('@/lib/repositories/PaymentPlanSubscriptionRepository')
        .paymentPlanSubscriptionRepository.endFromStripe(...args),
  },
}));

// The Business OS router, real unless a scenario sets `dispatch` (CF-5 PR 0).
jest.mock('@/lib/business-os/billing/webhookDispatcher', () => {
  const actual = jest.requireActual('@/lib/business-os/billing/webhookDispatcher');
  return {
    ...actual,
    dispatchBusinessOsEvent: (...args: unknown[]) => {
      if (!mockScenario.dispatch) return actual.dispatchBusinessOsEvent(...args);
      mockRecord({ type: 'dispatchBusinessOsEvent (scenario override)', outcome: mockScenario.dispatch });
      return Promise.resolve({ kind: mockScenario.dispatch });
    },
  };
});

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** `patch` over `base`: plain objects merge key by key; any other value replaces. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) out[key] = deepMerge(base[key], value);
  return out;
}

async function run(scenario: Scenario) {
  mockEffects.length = 0;
  for (const key of Object.keys(mockDbQueues)) delete mockDbQueues[key];
  for (const [key, answer] of Object.entries(scenario.db ?? {})) {
    mockDbQueues[key] = Array.isArray(answer) ? [...answer] : [answer];
  }
  mockLogLines.length = 0;
  mockScenario = scenario;
  const fixtureEvent: unknown = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, scenario.fixtureDir ?? 'connect', scenario.fixture), 'utf8')
  );
  mockEvent = scenario.eventPatch ? deepMerge(fixtureEvent, scenario.eventPatch) : fixtureEvent;
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

/**
 * Fix-1 (F-4): `payment-intent-succeeded.json` names contact `LINK_CONTACT`,
 * booking `LINK_BOOKING` and service `LINK_SERVICE`; these answers say
 * `owner-a` owns all three.
 *
 * UUID-shaped since Fix-1b: a non-UUID link id is now dropped as `malformed`
 * before any read. The values appear nowhere in the pre-Fix-1b
 * snapshot, so mapping them back to the old `ct-1` / `bk-0002` / `svc-2`
 * reproduces the pre-Fix-1b snapshot entries exactly (SA C-2).
 */
const LINK_CONTACT = 'c7c7c7c7-0001-4000-8000-00000000c701';
const LINK_BOOKING = 'b7b7b7b7-0002-4000-8000-00000000b702';
const LINK_SERVICE = 'e7e7e7e7-0002-4000-8000-00000000e702';
const OWNED_LINKS: Record<string, Answer> = {
  'crm_contacts:select': ok({ id: LINK_CONTACT }),
  'scheduling_bookings:select': ok({ id: LINK_BOOKING }),
  'scheduling_services:select': ok({ id: LINK_SERVICE }),
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
    expect(
      await run({
        fixture: 'checkout-completed-booking.json',
        owners: OWNER_A,
        // Fix-1 (F-2): the update is counted; one row is the owned booking.
        db: { 'scheduling_bookings:update': { data: null, error: null, count: 1 } },
      })
    ).toMatchSnapshot();
  });

  it('5a. payment_intent.succeeded, the owner owns the account', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        db: OWNED_LINKS,
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
        db: { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }) },
      })
    ).toMatchSnapshot();
  });

  it('6c. invoice.marked_uncollectible cancels the invoice', async () => {
    expect(
      await run({
        fixture: 'invoice-marked-uncollectible.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ id: 'pinv-0005', invoice_number: 'INV-005', user_id: 'owner-a' }) },
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
          'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('10. a handler that throws releases the claim to failed and returns 500', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        db: {
          ...OWNED_LINKS,
          'payment_transactions:insert': { data: null, error: { code: 'XX000', message: 'insert rejected' } },
        },
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

// ─── Fix-1: ids the sending business cannot prove it owns ───────────────────
//
// Attack scenarios for F-1, F-2 and F-4 (Fix-1 workplan §6.3). Every id the
// connected account can write (metadata, or a Stripe invoice id it may have
// planted on our row) must be proved to belong to the business that owns the
// SENDING account before anything is written with it. A refusal is today's
// policy: an error line, 200, the claim completed (no Stripe retry).

/** Tables a refused Connect event must not write. */
const VICTIM_TABLES = ['payment_invoices', 'payment_transactions', 'scheduling_bookings'];

/** The payload of the first insert into `table`. */
function insertPayload(result: unknown, table: string): Record<string, unknown> | undefined {
  const insert = effectsOf(result).find(
    (e) => e.type === 'db' && e.table === table && e.operation === 'insert'
  ) as { chain: unknown[][] } | undefined;
  return insert?.chain[0][1] as Record<string, unknown> | undefined;
}

/** Contexts of the error lines logged with exactly this message. */
function errorsLogged(message: string): unknown[] {
  return mockLogLines.filter((l) => l.level === 'error' && l.msg === message).map((l) => l.ctx);
}

const tablesRead = (result: unknown): string[] =>
  effectsOf(result)
    .filter((e) => e.type === 'db' && e.operation === 'select')
    .map((e) => String(e.table));

const INVOICE_PAID_REFUSAL = 'Connect invoice.paid names an invoice owned by a different business - refusing';
const LINK_DROPPED = 'payment_intent.succeeded link not proved to belong to the owner - dropping it';
const NOT_FOUND = { data: null, error: null };

describe('Stripe webhook, Fix-1: ids the sending business cannot prove it owns', () => {
  it('F1-1. invoice.paid metadata UUID naming another business\'s invoice is refused before stripe_invoice_id is written', async () => {
    const result = await run({
      fixture: 'invoice-paid.json',
      owners: OWNED_BY_OTHER,
      db: {
        'payment_invoices:select': [
          { data: null, error: { code: 'PGRST116', message: 'no rows' } },
          ok(PLATFORM_INVOICE),
        ],
      },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(errorsLogged(INVOICE_PAID_REFUSAL)).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-0001' }]);
  });

  it('F1-2. invoice.paid metadata UUID from an account that maps to no business is refused before any write', async () => {
    const result = await run({
      fixture: 'invoice-paid.json',
      owners: {},
      db: {
        'payment_invoices:select': [
          { data: null, error: { code: 'PGRST116', message: 'no rows' } },
          ok(PLATFORM_INVOICE),
        ],
      },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(errorsLogged(INVOICE_PAID_REFUSAL)).toHaveLength(1);
  });

  it('F1-3. invoice.finalized on another business\'s invoice (planted stripe_invoice_id) is refused', async () => {
    const result = await run({
      fixture: 'invoice-finalized.json',
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }) },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(
      errorsLogged('Connect invoice.finalized names an invoice owned by a different business - refusing')
    ).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-0004' }]);
  });

  it('F1-4. invoice.payment_failed on another business\'s invoice is refused: no overdue, no activity', async () => {
    const result = await run({
      fixture: 'invoice-payment-failed.json',
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': ok({ id: 'pinv-0003', invoice_number: 'INV-003', user_id: 'owner-a' }) },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(tablesRead(result)).not.toContain('business_profiles');
    expect(effectsOf(result).some((e) => e.type === 'crmActivity.create')).toBe(false);
    expect(
      errorsLogged('Connect invoice.payment_failed names an invoice owned by a different business - refusing')
    ).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-0003' }]);
  });

  it('F1-5. invoice.marked_uncollectible on another business\'s invoice is refused', async () => {
    const result = await run({
      fixture: 'invoice-marked-uncollectible.json',
      owners: OWNED_BY_OTHER,
      db: { 'payment_invoices:select': ok({ id: 'pinv-0005', invoice_number: 'INV-005', user_id: 'owner-a' }) },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(
      errorsLogged('Connect invoice.marked_uncollectible names an invoice owned by a different business - refusing')
    ).toEqual([{ connectAccountId: 'acct_owner_a', invoiceId: 'pinv-0005' }]);
  });

  it('F2-1. checkout booking_id from an attacker account: the only booking write is scoped to the attacker, and 0 rows is logged', async () => {
    const result = await run({
      fixture: 'checkout-completed-booking.json',
      owners: OWNED_BY_OTHER,
      db: { 'scheduling_bookings:update': { data: null, error: null, count: 0 } },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    const bookingWrites = effectsOf(result).filter(
      (e) => e.type === 'db' && e.table === 'scheduling_bookings' && e.operation !== 'select'
    ) as Array<{ chain: unknown[][] }>;
    expect(bookingWrites).toHaveLength(1);
    expect(bookingWrites[0].chain).toContainEqual(['eq', 'user_id', 'owner-b']);
    expect(bookingWrites[0].chain).not.toContainEqual(['eq', 'user_id', 'owner-a']);
    expect(
      errorsLogged('Connect checkout names a booking owned by a different business - no row updated')
    ).toEqual([{ connectAccountId: 'acct_owner_a', bookingId: 'bk-0001' }]);
  });

  it('F2-2. checkout booking_id from an account that maps to no business writes nothing', async () => {
    const result = await run({ fixture: 'checkout-completed-booking.json', owners: {} });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(writesTo(result, VICTIM_TABLES)).toEqual([]);
    expect(
      errorsLogged('Connect checkout names a booking on an account that maps to no business - refusing')
    ).toEqual([{ connectAccountId: 'acct_owner_a', bookingId: 'bk-0001' }]);
  });

  it('F2-3. an absent update count is not read as a refusal (strict count === 0)', async () => {
    const result = await run({ fixture: 'checkout-completed-booking.json', owners: OWNER_A });
    expect(statusOf(result)).toBe(200);
    expect(
      errorsLogged('Connect checkout names a booking owned by a different business - no row updated')
    ).toEqual([]);
  });

  it('F4-1. payment_intent.succeeded with a foreign booking_id records the money and drops the booking link', async () => {
    const result = await run({
      fixture: 'payment-intent-succeeded.json',
      owners: OWNER_A,
      db: { ...OWNED_LINKS, 'scheduling_bookings:select': NOT_FOUND },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    const row = insertPayload(result, 'payment_transactions');
    expect(row).toMatchObject({ user_id: 'owner-a', contact_id: LINK_CONTACT, booking_id: null, service_id: LINK_SERVICE });
    expect(row?.metadata).toMatchObject({ booking_id: null, service_id: LINK_SERVICE });
    expect(errorsLogged(LINK_DROPPED)).toEqual([
      { connectAccountId: 'acct_owner_a', paymentIntentId: 'pi_website_1', field: 'booking_id', id: LINK_BOOKING, reason: 'not_owned' },
    ]);
  });

  it('F4-2. payment_intent.succeeded with a foreign contact_id drops the contact link only', async () => {
    const result = await run({
      fixture: 'payment-intent-succeeded.json',
      owners: OWNER_A,
      db: { ...OWNED_LINKS, 'crm_contacts:select': NOT_FOUND },
    });
    expect(result).toMatchSnapshot();
    expect(insertPayload(result, 'payment_transactions')).toMatchObject({
      contact_id: null,
      booking_id: LINK_BOOKING,
      service_id: LINK_SERVICE,
    });
    expect(errorsLogged(LINK_DROPPED)).toEqual([
      { connectAccountId: 'acct_owner_a', paymentIntentId: 'pi_website_1', field: 'contact_id', id: LINK_CONTACT, reason: 'not_owned' },
    ]);
  });

  it('F4-3. payment_intent.succeeded with a foreign service_id drops the service link, column and metadata copy', async () => {
    const result = await run({
      fixture: 'payment-intent-succeeded.json',
      owners: OWNER_A,
      db: { ...OWNED_LINKS, 'scheduling_services:select': NOT_FOUND },
    });
    expect(result).toMatchSnapshot();
    const row = insertPayload(result, 'payment_transactions');
    expect(row).toMatchObject({ contact_id: LINK_CONTACT, booking_id: LINK_BOOKING, service_id: null });
    expect(row?.metadata).toMatchObject({ booking_id: LINK_BOOKING, service_id: null });
    expect(errorsLogged(LINK_DROPPED)).toEqual([
      { connectAccountId: 'acct_owner_a', paymentIntentId: 'pi_website_1', field: 'service_id', id: LINK_SERVICE, reason: 'not_owned' },
    ]);
  });

  it('F4-4. a failed ownership read fails closed: the link is dropped with reason read_failed, the money is recorded', async () => {
    const result = await run({
      fixture: 'payment-intent-succeeded.json',
      owners: OWNER_A,
      db: {
        ...OWNED_LINKS,
        'scheduling_bookings:select': { data: null, error: { code: 'XX000', message: 'read failed' } },
      },
    });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(insertPayload(result, 'payment_transactions')).toMatchObject({ booking_id: null, contact_id: LINK_CONTACT });
    expect(errorsLogged(LINK_DROPPED)).toEqual([
      { connectAccountId: 'acct_owner_a', paymentIntentId: 'pi_website_1', field: 'booking_id', id: LINK_BOOKING, reason: 'read_failed' },
    ]);
  });

  it('F4-5. payment_intent.succeeded with no link ids reads nothing extra and records none', async () => {
    const result = await run({ fixture: 'payment-intent-succeeded-no-links.json', owners: OWNER_A });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(tablesRead(result)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(crm_contacts|scheduling_bookings|scheduling_services)$/)])
    );
    expect(insertPayload(result, 'payment_transactions')).toMatchObject({
      contact_id: null,
      booking_id: null,
      service_id: null,
    });
    expect(errorsLogged(LINK_DROPPED)).toEqual([]);
  });
});

// ─── Fix-1b: link ids on the payment-plan path (F-5) ─────────────────────────
//
// The plan path vets its link ids INSIDE `bindPlanSubscription` (SA C-5), which
// this harness mocks. So these entries pin the ROUTE's half of the contract at
// each of the three plan sites: bind is reached only after the account's owner
// is proved from the signed `event.account`, it is handed that owner, and the
// raw metadata link ids are passed through for bind to vet (its unit tests and
// the QA suite prove the vetting). F5-1 pins the route's own `malformed` label.

const F5_BOOKING = 'f5f5f5f5-0b0b-4000-8000-0000000000b1';
const F5_SERVICE = 'f5f5f5f5-05e5-4000-8000-0000000000e1';
const F5_PLAN = 'f5f5f5f5-0a1a-4000-8000-0000000000a1';

/** The single argument object of every `bindPlanSubscription` call. */
function bindCalls(result: unknown): Array<Record<string, unknown>> {
  return effectsOf(result)
    .filter((e) => e.type === 'bindPlanSubscription')
    .map((e) => (e.args as unknown[])[0] as Record<string, unknown>);
}

describe('Stripe webhook, Fix-1b: plan link ids', () => {
  it('F5-1. payment_intent.succeeded with non-UUID link ids: no ownership read, dropped as malformed, only the length logged', async () => {
    const result = await run({ fixture: 'payment-intent-succeeded-malformed-links.json', owners: OWNER_A });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(claimStatus(result)).toBe('completed');
    expect(tablesRead(result)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(crm_contacts|scheduling_bookings|scheduling_services)$/)])
    );
    expect(insertPayload(result, 'payment_transactions')).toMatchObject({
      contact_id: null,
      booking_id: null,
      service_id: null,
    });
    const context = { connectAccountId: 'acct_owner_a', paymentIntentId: 'pi_website_malformed', reason: 'malformed' };
    expect(errorsLogged(LINK_DROPPED)).toEqual([
      { ...context, field: 'contact_id', idLength: 4 },
      { ...context, field: 'booking_id', idLength: 17 },
      { ...context, field: 'service_id', idLength: 38 },
    ]);
    // The raw values reach no log line at all.
    const logged = JSON.stringify(mockLogLines);
    expect(logged).not.toContain('drop table');
    expect(logged).not.toContain(F5_SERVICE);
  });

  it('F5-2. trialling plan subscription: bind gets the proved owner and the raw link ids', async () => {
    const result = await run({ fixture: 'subscription-created-trialing-plan.json', owners: OWNER_A });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(bindCalls(result)).toEqual([
      expect.objectContaining({
        connectAccountId: 'acct_owner_a',
        ownerId: 'owner-a',
        bookingId: F5_BOOKING,
        serviceId: F5_SERVICE,
        paymentPlanId: F5_PLAN,
        planCount: 3,
      }),
    ]);
  });

  it('F5-3. invoice.paid first plan period: bind gets the proved owner and the raw link ids', async () => {
    const result = await run({ fixture: 'invoice-paid-plan-first-period-foreign-links.json', owners: OWNER_A });
    expect(result).toMatchSnapshot();
    expect(bindCalls(result)).toEqual([
      expect.objectContaining({
        connectAccountId: 'acct_owner_a',
        ownerId: 'owner-a',
        bookingId: F5_BOOKING,
        serviceId: F5_SERVICE,
        paymentPlanId: F5_PLAN,
        planCount: 3,
      }),
    ]);
  });

  it('F5-4. plan checkout: bind gets the proved owner and the raw link ids', async () => {
    const result = await run({ fixture: 'checkout-completed-plan-foreign-links.json', owners: OWNER_A });
    expect(result).toMatchSnapshot();
    expect(statusOf(result)).toBe(200);
    expect(bindCalls(result)).toEqual([
      expect.objectContaining({
        connectAccountId: 'acct_owner_a',
        ownerId: 'owner-a',
        bookingId: F5_BOOKING,
        serviceId: F5_SERVICE,
        planCount: 3,
      }),
    ]);
  });

  it('F5-5. a plan naming an owner the account does not own never reaches bind, at any of the three sites', async () => {
    for (const fixture of [
      'subscription-created-trialing-plan.json',
      'invoice-paid-plan-first-period-foreign-links.json',
      'checkout-completed-plan-foreign-links.json',
    ]) {
      const result = await run({ fixture, owners: OWNED_BY_OTHER });
      expect(bindCalls(result)).toEqual([]);
    }
  });
});

/**
 * FU-5: an owner lookup that fails is retried, not refused.
 *
 * Before FU-5 a read error came back as "maps to no business": the handler
 * refused, the claim was completed and Stripe never retried. Now the resolver
 * throws, and the route's existing catch (entry 10) releases the claim to
 * `failed` and returns 500.
 */
describe('Stripe webhook, FU-5: owner lookup failure', () => {
  it('FU5-1. invoice.finalized whose owner lookup fails: 500, claim released to failed, no invoice write', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        ownerLookupFails: ['acct_owner_a'],
        db: { 'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }) },
      })
    ).toMatchSnapshot();
  });
});

/**
 * CF-5 PR 0: the arms the repository moves will touch and nothing ran yet.
 *
 * Every DB query in `route.ts` moves behind a repository in PRs 1 to 5, and the
 * snapshot is the proof each move changed nothing. A move can only be proved on
 * an arm that executes, so these entries run the arms the 45 above leave cold:
 * the miss, the error and the hit of each moved query, and the early returns
 * that sit between a moved read and a moved write. Recorded on the untouched
 * route (workplan §7.3.1 lists each one with its line and its PR).
 *
 * They pin what the route DOES today, holes included (SA C-9). An entry here is
 * not a statement that the behaviour is right.
 */

const fail = (code: string, message: string): Answer => ({ data: null, error: { code, message } });
const DB_DOWN = fail('XX000', 'write rejected');

const PLAN_ROW = {
  id: 'plan-1',
  user_id: 'owner-a',
  contact_id: 'ct-2',
  booking_id: 'bk-plan-1',
  service_id: 'svc-1',
  currency: 'ILS',
  periods_paid: 0,
  installment_count: 3,
};

const PLAN_PERIOD_DB: Record<string, Answer | Answer[]> = {
  'payment_plan_installments:select': [ok(null), ok({ due_date: '2026-12-01', amount: '333.33' })],
  'payment_transactions:insert': ok({ id: 'tx-plan-1' }),
};

const CHECKOUT_INVOICE = {
  id: 'pinv-0002',
  user_id: 'owner-a',
  contact_id: 'ct-1',
  invoice_number: 'INV-002',
  currency: 'EUR',
  status: 'sent',
  booking_id: 'bk-0003',
};

const FAILED_INVOICE = { id: 'pinv-0003', invoice_number: 'INV-003', user_id: 'owner-a' };
const ENDING_PLAN = { id: 'plan-1', user_id: 'owner-a', status: 'active', installment_count: 3, periods_paid: 1 };

const REFUND_TX = ok([{ id: 'tx-1', user_id: 'owner-a', invoice_id: 'pinv-0001', currency: 'usd' }]);
const DISPUTE_TX = ok([
  {
    id: 'tx-1',
    user_id: 'owner-a',
    status: 'succeeded',
    amount: 150,
    currency: 'USD',
    contact_id: 'ct-1',
    metadata: { source: 'payment_intent_webhook' },
  },
]);

const NO_USER_ID = { data: { object: { metadata: { user_id: null } } } };

describe('Stripe webhook, CF-5 PR 0: arms the repository moves will touch', () => {
  // ── PR 1: the claim table ──────────────────────────────────────────────────

  it('X10. claim insert answers 23505 (claimed in between): duplicate, 200', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: { 'processed_webhook_events:insert': fail('23505', 'duplicate key value') },
      })
    ).toMatchSnapshot();
  });

  it('X12. claim insert answers another error: logged, processed anyway, completed at the end', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: {
          'processed_webhook_events:insert': DB_DOWN,
          'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('X13. claim lookup answers an error: logged, claimed and processed anyway', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: {
          'processed_webhook_events:select': fail('XX000', 'read failed'),
          'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('X53. claim insert fails, then the handler throws: 500, and there is no claim to release', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        db: { ...OWNED_LINKS, 'processed_webhook_events:insert': DB_DOWN, 'payment_transactions:insert': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  // ── PR 2: Connect invoices ─────────────────────────────────────────────────

  it('X9. checkout for an invoice already paid returns before any write', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ ...CHECKOUT_INVOICE, status: 'paid' }) },
      })
    ).toMatchSnapshot();
  });

  it('X14. checkout for an invoice that is not found returns before any write', async () => {
    expect(await run({ fixture: 'checkout-completed-invoice.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X15. checkout for an invoice another business owns is refused', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNED_BY_OTHER,
        db: { 'payment_invoices:select': ok(CHECKOUT_INVOICE) },
      })
    ).toMatchSnapshot();
  });

  it('X16. checkout: marking the invoice paid fails after the payment is recorded, 500', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(CHECKOUT_INVOICE), 'payment_invoices:update': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X17. invoice.paid: marking the invoice paid fails after the payment is recorded, 500', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE), 'payment_invoices:update': DB_DOWN },
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });

  it('X18. invoice.payment_failed with no platform invoice returns before any write', async () => {
    expect(await run({ fixture: 'invoice-payment-failed.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X19. invoice.payment_failed: the overdue update fails, logged, no activity', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(FAILED_INVOICE), 'payment_invoices:update': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X20. invoice.payment_failed on an invoice with no contact: no profile read, no activity', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': [ok(FAILED_INVOICE), ok({ contact_id: null, amount: 120, currency: 'USD' })],
        },
      })
    ).toMatchSnapshot();
  });

  it('X48. invoice.paid found neither by Stripe id nor by the metadata id: no write', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': [
            { data: null, error: { code: 'PGRST116', message: 'no rows' } },
            { data: null, error: { code: 'PGRST116', message: 'no rows' } },
          ],
        },
      })
    ).toMatchSnapshot();
  });

  it('X49. checkout for an invoice with no booking: paid, no booking write', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok({ ...CHECKOUT_INVOICE, booking_id: null }) },
      })
    ).toMatchSnapshot();
  });

  it('X52. invoice.payment_failed, the owner has no business profile: the activity is phrased in English', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': [ok(FAILED_INVOICE), ok({ contact_id: 'ct-1', amount: 120, currency: 'USD' })],
        },
      })
    ).toMatchSnapshot();
  });

  it('X21. invoice.finalized with no platform invoice returns before any write', async () => {
    expect(await run({ fixture: 'invoice-finalized.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X22. invoice.finalized: the update fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'invoice-finalized.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': ok({ id: 'pinv-0004', invoice_number: 'INV-004', user_id: 'owner-a' }),
          'payment_invoices:update': DB_DOWN,
        },
      })
    ).toMatchSnapshot();
  });

  it('X23. invoice.marked_uncollectible with no platform invoice returns before any write', async () => {
    expect(await run({ fixture: 'invoice-marked-uncollectible.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X24. invoice.marked_uncollectible: the update fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'invoice-marked-uncollectible.json',
        owners: OWNER_A,
        db: {
          'payment_invoices:select': ok({ id: 'pinv-0005', invoice_number: 'INV-005', user_id: 'owner-a' }),
          'payment_invoices:update': DB_DOWN,
        },
      })
    ).toMatchSnapshot();
  });

  // ── PR 3: money rows ───────────────────────────────────────────────────────

  it('X4. platform charge.refunded with no payment intent: found by charge id, refund on no connected account', async () => {
    expect(
      await run({
        fixture: 'charge-refunded.json',
        eventPatch: { account: null, data: { object: { payment_intent: null } } },
        db: { 'payment_transactions:select': REFUND_TX },
      })
    ).toMatchSnapshot();
  });

  it('X5. charge.dispute.closed, won, charge id only: the status before the dispute is restored', async () => {
    expect(
      await run({
        fixture: 'charge-dispute-created.json',
        owners: OWNER_A,
        eventPatch: { type: 'charge.dispute.closed', data: { object: { payment_intent: null, status: 'won' } } },
        db: {
          'payment_transactions:select': ok([
            {
              id: 'tx-1',
              user_id: 'owner-a',
              status: 'disputed',
              amount: 150,
              currency: 'USD',
              contact_id: 'ct-1',
              metadata: { source: 'payment_intent_webhook', status_before_dispute: 'refunded' },
            },
          ]),
        },
      })
    ).toMatchSnapshot();
  });

  it('X25. charge.refunded for a payment never recorded: logged, nothing written', async () => {
    expect(await run({ fixture: 'charge-refunded.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X26. charge.refunded: the refund upsert fails, 500', async () => {
    expect(
      await run({
        fixture: 'charge-refunded.json',
        owners: OWNER_A,
        db: { 'payment_transactions:select': REFUND_TX, 'payment_refunds:upsert': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X27. dispute for a payment never recorded: logged, nothing written', async () => {
    expect(await run({ fixture: 'charge-dispute-created.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X28. dispute: the update fails, logged, no alert', async () => {
    expect(
      await run({
        fixture: 'charge-dispute-created.json',
        owners: OWNER_A,
        db: { 'payment_transactions:select': DISPUTE_TX, 'payment_transactions:update': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X29. payment_intent.succeeded already recorded returns before the links are read', async () => {
    expect(
      await run({
        fixture: 'payment-intent-succeeded.json',
        owners: OWNER_A,
        db: { 'payment_transactions:select': ok({ id: 'tx-existing' }) },
      })
    ).toMatchSnapshot();
  });

  it('X30. plan period: the transaction insert fails, the raw error is thrown, 500', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok(PLAN_ROW),
        db: { ...PLAN_PERIOD_DB, 'payment_transactions:insert': DB_DOWN },
        invoicePaymentIntent: 'pi_plan_1',
      })
    ).toMatchSnapshot();
  });

  it('X31. invoice.paid already recorded for the invoice returns before any write', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE), 'payment_transactions:select': ok({ id: 'tx-existing' }) },
      })
    ).toMatchSnapshot();
  });

  it('X32. invoice.paid: the transaction insert fails, the invoice is not marked paid, 500', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE), 'payment_transactions:insert': DB_DOWN },
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });

  it('X33. checkout invoice: the transaction insert fails, the invoice is not marked paid, 500', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(CHECKOUT_INVOICE), 'payment_transactions:insert': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  // ── PR 4: plans and bookings ───────────────────────────────────────────────

  it('X6. Connect customer.subscription.deleted on a plan paid in full: completed, no period cancelled', async () => {
    expect(
      await run({
        fixture: 'subscription-deleted.json',
        owners: OWNER_A,
        db: { 'payment_plan_subscriptions:select': ok({ ...ENDING_PLAN, periods_paid: 3 }) },
      })
    ).toMatchSnapshot();
  });

  it('X7. the last plan period, no booking: the plan is closed, no booking write', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok({ ...PLAN_ROW, periods_paid: 2, booking_id: null }),
        db: { 'payment_transactions:insert': ok({ id: 'tx-plan-3' }) },
        invoicePaymentIntent: 'pi_plan_3',
      })
    ).toMatchSnapshot();
  });

  it('X8. a plan period already recorded returns before any write', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok(PLAN_ROW),
        db: { 'payment_plan_installments:select': ok({ id: 'inst-1' }) },
      })
    ).toMatchSnapshot();
  });

  it('X11. Connect invoice.payment_failed for an owned plan: recordFailure, no invoice lookup', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        planLookup: ok(PLAN_ROW),
        eventPatch: {
          data: {
            object: {
              parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_plan_1', metadata: {} } },
              last_finalization_error: { code: 'card_declined' },
            },
          },
        },
      })
    ).toMatchSnapshot();
  });

  it('X50. invoice.payment_failed whose subscription names no plan: falls through to the invoice path', async () => {
    expect(
      await run({
        fixture: 'invoice-payment-failed.json',
        owners: OWNER_A,
        eventPatch: {
          data: {
            object: {
              parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_not_a_plan', metadata: {} } },
            },
          },
        },
        db: {
          'payment_invoices:select': [ok(FAILED_INVOICE), ok({ contact_id: null, amount: 120, currency: 'USD' })],
        },
      })
    ).toMatchSnapshot();
  });

  it('X51. Connect customer.subscription.deleted for a subscription that is not our plan: no write', async () => {
    expect(await run({ fixture: 'subscription-deleted.json', owners: OWNER_A })).toMatchSnapshot();
  });

  it('X34. plan period: the booking update fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok(PLAN_ROW),
        db: { ...PLAN_PERIOD_DB, 'scheduling_bookings:update': DB_DOWN },
        invoicePaymentIntent: 'pi_plan_1',
      })
    ).toMatchSnapshot();
  });

  it('X35. plan period from an account that does not own the plan: refused before the period lookup', async () => {
    expect(
      await run({ fixture: 'invoice-paid-plan-period.json', owners: OWNED_BY_OTHER, planLookup: ok(PLAN_ROW) })
    ).toMatchSnapshot();
  });

  it('X36. plan invoice that collected nothing (proration credit): no period lookup, no write', async () => {
    expect(
      await run({
        fixture: 'invoice-paid-plan-period.json',
        owners: OWNER_A,
        planLookup: ok(PLAN_ROW),
        eventPatch: { data: { object: { amount_paid: 0, total: -33333 } } },
      })
    ).toMatchSnapshot();
  });

  it('X37. invoice.paid: the booking update fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(PLATFORM_INVOICE), 'scheduling_bookings:update': DB_DOWN },
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });

  it('X38. checkout invoice: the booking confirm fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-invoice.json',
        owners: OWNER_A,
        db: { 'payment_invoices:select': ok(CHECKOUT_INVOICE), 'scheduling_bookings:update': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X39. checkout booking: the update fails, logged, 200', async () => {
    expect(
      await run({
        fixture: 'checkout-completed-booking.json',
        owners: OWNER_A,
        db: { 'scheduling_bookings:update': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X40. Connect customer.subscription.deleted on a plan another business owns: refused, no write', async () => {
    expect(
      await run({
        fixture: 'subscription-deleted.json',
        owners: OWNED_BY_OTHER,
        db: { 'payment_plan_subscriptions:select': ok(ENDING_PLAN) },
      })
    ).toMatchSnapshot();
  });

  it('X41. Connect customer.subscription.deleted on a plan already cancelled: no write', async () => {
    expect(
      await run({
        fixture: 'subscription-deleted.json',
        owners: OWNER_A,
        db: { 'payment_plan_subscriptions:select': ok({ ...ENDING_PLAN, status: 'cancelled' }) },
      })
    ).toMatchSnapshot();
  });

  // ── PR 5: agent-platform legacy tables ─────────────────────────────────────

  it('X1. platform customer.subscription.deleted with a legacy user_id: cancelled, billing event', async () => {
    expect(await run({ fixtureDir: 'platform', fixture: 'subscription-deleted-legacy.json' })).toMatchSnapshot();
  });

  it('X42. platform customer.subscription.deleted with no user_id: nothing written', async () => {
    expect(
      await run({ fixtureDir: 'platform', fixture: 'subscription-deleted-legacy.json', eventPatch: NO_USER_ID })
    ).toMatchSnapshot();
  });

  it('X2. legacy dunning, unreachable through POST today (dispatch overridden): grace from the user row', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'invoice-payment-failed-unknown-price.json',
        dispatch: 'not_business_os',
        db: {
          'user_subscriptions:select': ok({ payment_retry_count: 1, grace_period_days: 5, current_period_end: null }),
        },
      })
    ).toMatchSnapshot();
  });

  it('X3. legacy dunning, unreachable through POST today (dispatch overridden): grace from system config', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'invoice-payment-failed-unknown-price.json',
        dispatch: 'not_business_os',
        db: {
          'user_subscriptions:select': ok({ payment_retry_count: null, grace_period_days: null, current_period_end: null }),
          'system_settings_config:select': ok({ value: '7' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('X43. legacy dunning, unreachable through POST today (dispatch overridden): no user_id, nothing written', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'invoice-payment-failed-unknown-price.json',
        dispatch: 'not_business_os',
        eventPatch: NO_USER_ID,
      })
    ).toMatchSnapshot();
  });

  it('X55. legacy dunning, unreachable through POST today (dispatch overridden): no user row, no config row', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'invoice-payment-failed-unknown-price.json',
        dispatch: 'not_business_os',
      })
    ).toMatchSnapshot();
  });

  it('X54. boost-pack checkout on an existing balance: the credit transaction id reaches the purchase row', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'checkout-completed-boost-pack.json',
        db: {
          'user_subscriptions:select': ok({ balance: 2500, total_earned: 9000 }),
          'credit_transactions:insert': ok({ id: 'ctx-1' }),
        },
      })
    ).toMatchSnapshot();
  });

  it('X44. boost-pack checkout with no user_id: nothing written', async () => {
    expect(
      await run({ fixtureDir: 'platform', fixture: 'checkout-completed-boost-pack.json', eventPatch: NO_USER_ID })
    ).toMatchSnapshot();
  });

  it('X45. boost-pack checkout: the credit transaction and purchase inserts both fail, logged, not thrown', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'checkout-completed-boost-pack.json',
        db: { 'credit_transactions:insert': DB_DOWN, 'boost_pack_purchases:insert': DB_DOWN },
      })
    ).toMatchSnapshot();
  });

  it('X46. boost-pack checkout without a boost_pack_id: no purchase row', async () => {
    expect(
      await run({
        fixtureDir: 'platform',
        fixture: 'checkout-completed-boost-pack.json',
        eventPatch: { data: { object: { metadata: { boost_pack_id: null } } } },
      })
    ).toMatchSnapshot();
  });

  it('X47. platform customer.subscription.updated with no user_id: nothing written', async () => {
    expect(
      await run({ fixtureDir: 'platform', fixture: 'subscription-updated-legacy.json', eventPatch: NO_USER_ID })
    ).toMatchSnapshot();
  });
});

/*
 * CF-5 PR 3 (workplan §7.3.4). #257 (Stripe settlement recovery) landed after
 * PR 0 and added a lookup by payment intent and an attach to `invoice.paid`.
 * Every recorded scenario misses that lookup, so its hit, attach, attach-error
 * and already-attached arms were cold. These entries were written against the
 * UNTOUCHED route, before PR 3 moved those two queries, with an anchored `-t`
 * and no `-u`; the 100 entries above are byte-identical.
 *
 * The `payment_transactions:select` answers are consumed in order: first the
 * dedupe by invoice (a miss), then the lookup by intent.
 */
describe('Stripe webhook, CF-5 PR 3: the #257 attach arms', () => {
  const byIntent = (invoiceId: string | null): Record<string, Answer | Answer[]> => ({
    'payment_invoices:select': ok(PLATFORM_INVOICE),
    'payment_transactions:select': [ok(null), ok({ id: 'tx-by-intent', invoice_id: invoiceId })],
  });

  it('X56. invoice.paid already recorded under its intent with no invoice: attached, not inserted, invoice marked paid', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: byIntent(null),
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });

  it('X57. invoice.paid: the attach to the existing row fails, logged, still not inserted, invoice marked paid', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: { ...byIntent(null), 'payment_transactions:update': DB_DOWN },
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });

  it('X58. invoice.paid already recorded under its intent and already attached: no attach, no insert, invoice marked paid', async () => {
    expect(
      await run({
        fixture: 'invoice-paid.json',
        owners: OWNER_A,
        db: byIntent('pinv-0001'),
        invoicePaymentIntent: 'pi_invoice_1',
      })
    ).toMatchSnapshot();
  });
});
