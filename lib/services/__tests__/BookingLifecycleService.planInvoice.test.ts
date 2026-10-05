/**
 * AN INSTALMENT SERVICE, BOOKED BY THE OWNER, IS BILLED ONE PERIOD AT A TIME.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The bug this pins collected the whole price.
 *
 * `isInstallmentPlan` was consulted by three routes, every one of them under
 * `/api/website/*` — the public widget. The OWNER's path (the drawer, the chat,
 * `POST /api/scheduling/bookings`) went straight to `createBookingInvoice`,
 * which billed `service.price`.
 *
 * So a service sold as "2 weekly payments of ₪400" produced one ₪800 invoice,
 * one ₪800 Stripe page, and a real ₪800 charge (INV-00012). The public booking
 * dialog displayed the ₪400 + ₪400 split correctly throughout, which is exactly
 * what made the plan system look sound.
 *
 * Two assertions carry the fix, and the SECOND is the one that mattered in
 * production: the local invoice row AND the Stripe line item must both ask for
 * the first period. The Stripe amount was built separately from
 * `service.price`, so fixing only the invoice would have left the client's
 * actual payment page asking for the full total.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

const createPlan = jest.fn();
const findByServiceId = jest.fn();
const createInstallmentsForBooking = jest.fn();
const createInvoice = jest.fn();
const getNextInvoiceNumber = jest.fn();
const stripeCreateInvoice = jest.fn();

jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: {
    create: (...args: unknown[]) => createPlan(...args),
    findByServiceId: (...args: unknown[]) => findByServiceId(...args),
    createInstallmentsForBooking: (...args: unknown[]) => createInstallmentsForBooking(...args),
  },
}));

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    create: (...args: unknown[]) => createInvoice(...args),
    getNextInvoiceNumber: (...args: unknown[]) => getNextInvoiceNumber(...args),
  },
  paymentTransactionRepository: {},
  stripeConnectRepository: {
    findByUserId: async () => ({
      data: { stripe_account_id: 'acct_test', charges_enabled: true },
      error: null,
    }),
  },
}));

jest.mock('@/lib/stripe/StripeInvoiceService', () => ({
  getStripeInvoiceService: () => ({
    createInvoice: (...args: unknown[]) => stripeCreateInvoice(...args),
  }),
}));

jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {},
  getBusinessTimezone: async () => 'Asia/Jerusalem',
}));

jest.mock('@/lib/services/PaymentEventService', () => ({ emitPaymentEvent: jest.fn() }));
jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: { scheduleInvoiceReminders: jest.fn().mockResolvedValue(undefined) },
}));

/** Every update the service makes, with the filters it was scoped by. */
const updates: Array<{
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      let current: (typeof updates)[number] | null = null;

      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
            }
            return (...args: unknown[]) => {
              if (prop === 'update') {
                current = { table, payload: args[0] as Record<string, unknown>, filters: [] };
                updates.push(current);
              }
              // The scoping IS the safety — a shared plan row makes an
              // unscoped update reach other clients' bookings.
              if ((prop === 'eq' || prop === 'is') && current) {
                current.filters.push([String(args[0]), args[1]]);
              }
              return builder;
            };
          },
        }
      );
      return builder;
    },
  },
}));

import { createBookingInvoice } from '@/lib/services/BookingLifecycleService';

const log = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
} as unknown as Parameters<typeof createBookingInvoice>[4];

/** ₪800 sold as two weekly payments — the live service from INV-00012. */
const planService = {
  id: 'svc-1',
  service_name: 'בדיקת תוכנית תשלומים',
  price: 800,
  currency: 'ILS',
  payment_type: 'installments',
  installment_count: 2,
  installment_frequency: 'weekly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
} as unknown as SchedulingService;

const bookingData = {
  contact_id: 'contact-1',
  contact_name: 'אופיר עומר',
  contact_email: 'client@example.com',
  start_time: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  updates.length = 0;

  getNextInvoiceNumber.mockResolvedValue({ data: 'INV-00099', error: null });
  // No service-level plan row by default: a service saved before
  // `syncServicePaymentPlan` existed, which is the account this was found on.
  findByServiceId.mockResolvedValue({ data: [], error: null });
  createPlan.mockResolvedValue({ data: { id: 'plan-1' }, error: null });
  createInstallmentsForBooking.mockResolvedValue({
    data: [
      { installment_number: 1, amount: 400, due_date: '2026-09-30', currency: 'ILS' },
      { installment_number: 2, amount: 400, due_date: '2026-10-07', currency: 'ILS' },
    ],
    error: null,
  });
  createInvoice.mockResolvedValue({
    data: { id: 'inv-1', stripe_invoice_id: null },
    error: null,
  });
  stripeCreateInvoice.mockResolvedValue({ id: 'in_test', hosted_invoice_url: null, invoice_pdf: null });
});

describe('createBookingInvoice on an instalment service', () => {
  it('invoices the FIRST PERIOD, not the agreed total', async () => {
    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    const invoice = createInvoice.mock.calls[0][0];
    expect(invoice.amount).toBe(400);
    expect(invoice.line_items[0].total).toBe(400);
    expect(invoice.amount).not.toBe(800);
  });

  it('asks STRIPE for the first period too — the page the client actually pays on', async () => {
    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    // Stripe works in minor units: ₪400, not ₪800.
    expect(stripeCreateInvoice.mock.calls[0][0].lineItems[0].total).toBe(40_000);
    expect(stripeCreateInvoice.mock.calls[0][0].lineItems[0].unit_price).toBe(40_000);
  });

  it('writes the schedule so the later periods are billed when due', async () => {
    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ total_amount: 800, installment_count: 2, currency: 'ILS' })
    );
    expect(createInstallmentsForBooking).toHaveBeenCalledWith(
      'plan-1',
      'owner-1',
      'contact-1',
      expect.any(String),
      expect.objectContaining({ bookingId: 'booking-1', customAmount: 800 })
    );
  });

  it('reuses the SERVICE\'s plan row rather than writing a second one', async () => {
    /*
     * `syncServicePaymentPlan` writes this row whenever a service is saved, and
     * the public dialog, the drawer and the reminder service all read it. A
     * second row would make `findByServiceId` — which returns newest first —
     * hand different surfaces different agreements for one service.
     */
    findByServiceId.mockResolvedValue({
      data: [{ id: 'service-plan', installment_count: 2, total_amount: 800 }],
      error: null,
    });

    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    expect(createPlan).not.toHaveBeenCalled();
    expect(createInstallmentsForBooking).toHaveBeenCalledWith(
      'service-plan',
      'owner-1',
      'contact-1',
      expect.any(String),
      expect.objectContaining({ bookingId: 'booking-1' })
    );
  });

  it('writes a plan row when the service has none, and does not reuse a mismatched one', async () => {
    // A stale row from when the service was 3 periods, or a different price.
    findByServiceId.mockResolvedValue({
      data: [{ id: 'stale-plan', installment_count: 3, total_amount: 800 }],
      error: null,
    });

    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    expect(createPlan).toHaveBeenCalled();
    expect(createInstallmentsForBooking).toHaveBeenCalledWith(
      'plan-1',
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.anything()
    );
  });

  it('claims period 1 against the invoice, so the due-date sweep cannot bill it twice', async () => {
    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    const stamp = updates.find(u => u.table === 'payment_plan_installments');
    expect(stamp?.payload).toMatchObject({ invoice_id: 'inv-1' });
  });

  it('scopes that claim to THIS booking — the plan row belongs to the service', async () => {
    findByServiceId.mockResolvedValue({
      data: [{ id: 'service-plan', installment_count: 2, total_amount: 800 }],
      error: null,
    });

    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    /*
     * The plan row is shared by every booking of the service. Scoped on
     * `payment_plan_id` + `installment_number` alone, this stamp would mark
     * period 1 of every OTHER client's booking with this client's invoice — and
     * `billStage` would then never bill any of them, because its claim requires
     * `invoice_id IS NULL`.
     */
    const stamp = updates.find(u => u.table === 'payment_plan_installments');
    expect(stamp?.filters).toContainEqual(['booking_id', 'booking-1']);
    expect(stamp?.filters).toContainEqual(['user_id', 'owner-1']);
    expect(stamp?.filters).toContainEqual(['installment_number', 1]);
  });

  it('links the booking to its plan, which is what stops the drawer guessing', async () => {
    await createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log);

    expect(updates).toContainEqual(
      expect.objectContaining({
        table: 'scheduling_bookings',
        payload: expect.objectContaining({ payment_plan_id: 'plan-1' }),
      })
    );
  });

  it('raises NO invoice at all when the schedule cannot be written', async () => {
    createInstallmentsForBooking.mockResolvedValue({ data: null, error: new Error('db down') });

    await expect(
      createBookingInvoice('owner-1', 'booking-1', planService, bookingData, log)
    ).rejects.toThrow();

    // The point of the throw: falling back to the full price is the original bug.
    expect(createInvoice).not.toHaveBeenCalled();
  });
});

describe('createBookingInvoice on an ordinary service', () => {
  const plainService = {
    ...planService,
    payment_type: 'full',
    installment_count: 1,
  } as unknown as SchedulingService;

  it('still bills the whole price, and creates no plan', async () => {
    await createBookingInvoice('owner-1', 'booking-2', plainService, bookingData, log);

    expect(createInvoice.mock.calls[0][0].amount).toBe(800);
    expect(createPlan).not.toHaveBeenCalled();
    expect(createInstallmentsForBooking).not.toHaveBeenCalled();
  });
});
