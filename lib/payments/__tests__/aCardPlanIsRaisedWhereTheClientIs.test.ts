/**
 * A card plan's first period is a SUBSCRIPTION, raised at payment time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY IT IS WORTH A FILE
 *
 * Three facts about Stripe make this path the only one that works, and each was
 * learned by shipping something that did not:
 *
 * 1. A card that pays an ordinary invoice is CHARGED, not STORED. Stripe locks
 *    it out of reuse for ever: "This PaymentMethod was previously used without
 *    being attached to a Customer ... and may not be used again." So period two
 *    has nothing to charge, and no later repair exists.
 * 2. `save_default_payment_method` only fires when a SUBSCRIPTION payment
 *    succeeds. An invoice settled by hand is not one.
 * 3. A subscription created before anybody pays sits at `incomplete` and dies
 *    after 23 hours, so it cannot be created at booking time either.
 *
 * Together those leave exactly one moment: when the client presses Pay. The
 * assertions below pin the four things that make that moment work, and the two
 * refusals that keep it from charging anyone twice.
 */

const mockSubscriptionsCreate = jest.fn();
const mockPricesCreate = jest.fn();
const mockCustomersCreate = jest.fn();
const mockInvoiceUpdate = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomersCreate },
    prices: { create: mockPricesCreate },
    subscriptions: { create: mockSubscriptionsCreate },
  }));
});

/* Each table answers with whatever the test put in `rows`, so one mock serves
   the booking, the service and the periods without four bespoke doubles. */
const rows: Record<string, unknown> = {};

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const pass = () => chain;
      Object.assign(chain, {
        select: pass,
        eq: pass,
        order: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
        update: (payload: unknown) => {
          mockInvoiceUpdate(table, payload);
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
        },
      });
      return chain;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { raisePlanSubscription } from '../raisePlanSubscription';

const INVOICE = 'inv-local-1';
const USER = 'owner-1';
const BOOKING = 'booking-1';

const cardPlanService = {
  id: 'svc-1',
  service_name: 'Coaching',
  price: 800,
  currency: 'ILS',
  collection: 'online',
  payment_type: 'installments',
  installment_count: 2,
  installment_frequency: 'weekly',
};

const twoPeriods = [
  { installment_number: 1, amount: 400, due_date: '2026-11-12', subscription_id: null, payment_plan_id: 'plan-1' },
  { installment_number: 2, amount: 400, due_date: '2026-11-19', subscription_id: null, payment_plan_id: 'plan-1' },
];

const raise = () =>
  raisePlanSubscription({
    invoiceId: INVOICE,
    userId: USER,
    bookingId: BOOKING,
    connectAccountId: 'acct_1',
    customerEmail: 'client@example.com',
    customerName: 'A Client',
  });

beforeEach(() => {
  jest.clearAllMocks();
  rows.scheduling_bookings = { id: BOOKING, service_id: 'svc-1' };
  rows.scheduling_services = { ...cardPlanService };
  rows.payment_plan_installments = twoPeriods.map(p => ({ ...p }));

  mockCustomersCreate.mockResolvedValue({ id: 'cus_1' });
  mockPricesCreate.mockResolvedValue({ id: 'price_1' });
  mockSubscriptionsCreate.mockResolvedValue({
    id: 'sub_1',
    latest_invoice: { id: 'in_1', hosted_invoice_url: 'https://pay.example/in_1' },
  });
});

describe('the card is kept, because this is a subscription payment', () => {
  it('creates the subscription so Stripe saves the card and can charge later periods', async () => {
    const result = await raise();

    expect(result).toEqual({ ok: true, stripeInvoiceId: 'in_1' });

    const [params] = mockSubscriptionsCreate.mock.calls[0];
    /* The one setting the whole design exists for. */
    expect(params.payment_settings.save_default_payment_method).toBe('on_subscription');
    /* Never `send_invoice`: that is the mode that makes the card single-use.
       Absent means `charge_automatically`, which is Stripe's default. */
    expect(params.collection_method).toBeUndefined();
    /* What hands the portal's existing Elements form a secret to confirm. */
    expect(params.payment_behavior).toBe('default_incomplete');
    expect(params.expand).toContain('latest_invoice.confirmation_secret');
  });

  it('bounds the plan in the same call that creates it', async () => {
    await raise();

    const [params] = mockSubscriptionsCreate.mock.calls[0];

    /* One period past the last due date, so the final charge is taken before
       Stripe cancels. Weekly periods ending 19 Nov means 26 Nov. */
    expect(params.cancel_at).toBe(Math.floor(new Date('2026-11-26').getTime() / 1000));
    expect(params.metadata.plan_count).toBe('2');

    /* `bindPlanSubscription` links the local mirror by this id. Empty, and the
       plan Stripe is charging is tied to no plan of ours. */
    expect(params.metadata.payment_plan_id).toBe('plan-1');
    expect(params.metadata.booking_id).toBe(BOOKING);
    expect(params.metadata.owner_id).toBe(USER);
  });

  it('prices one PERIOD at the plan frequency, never the whole plan', async () => {
    await raise();

    const [params] = mockPricesCreate.mock.calls[0];
    expect(params.unit_amount).toBe(40000);
    expect(params.recurring).toEqual({ interval: 'week', interval_count: 1 });
  });

  it('records the Stripe invoice on our row, so the next visit does not raise a second one', async () => {
    await raise();

    expect(mockInvoiceUpdate).toHaveBeenCalledWith(
      'payment_invoices',
      expect.objectContaining({ stripe_invoice_id: 'in_1' })
    );
  });
});

describe('what it refuses, and leaves to an ordinary invoice', () => {
  it('is not a card plan when the service collects by invoice', async () => {
    rows.scheduling_services = { ...cardPlanService, collection: 'invoice' };

    expect(await raise()).toBeNull();
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it('is not a card plan when the service is a single payment', async () => {
    rows.scheduling_services = { ...cardPlanService, payment_type: 'full', installment_count: 1 };

    expect(await raise()).toBeNull();
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it('refuses when the periods already belong to a subscription', async () => {
    /* Two subscriptions for one plan is two sets of charges. This is the
       guard that stops a second tab, or a retry, from creating one. */
    rows.payment_plan_installments = twoPeriods.map(p => ({ ...p, subscription_id: 'sub_existing' }));

    expect(await raise()).toBeNull();
    expect(mockSubscriptionsCreate).not.toHaveBeenCalled();
  });

  it('never throws when Stripe does: the caller falls back to an invoice', async () => {
    mockSubscriptionsCreate.mockRejectedValue(new Error('stripe is down'));

    expect(await raise()).toEqual({ ok: false, reason: 'stripe_failed' });
  });
});
