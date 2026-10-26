/**
 * The reported incident, walked end to end, with nothing in the middle mocked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS REPORTED
 *
 * A client booked and paid through a smart link. The owner refunded her four
 * minutes later. The money went back at Stripe, and on this platform:
 *
 *   - the booking still showed as PAID, and
 *   - the client never received a refund email.
 *
 * Both were one missing row-link. The booking and the webhook's transaction
 * land 117ms apart in the wrong order, so the stamp ran against a row that did
 * not exist and the payment was never attached to the booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS ALONGSIDE `thePaymentFindsItsBooking`
 *
 * That file proves the LINK is made and that the settle is CALLED — it mocks
 * `syncBookingPaymentState`, so it says nothing about what the owner's screen
 * ends up reading or whether the client is mailed. Those two are the actual
 * complaint, so they are proven here against the real functions:
 *
 *   `syncBookingPaymentState`   real. Decides what the booking reads.
 *   `notifyRefund`'s routing    real. Decides whether a booking email is even
 *                               attempted, or whether it falls through to the
 *                               invoice path that a smart-link sale cannot use.
 *
 * Only the two true edges are faked: Stripe, and the email transport.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The transaction rows, as the database holds them. */
let transactions: Array<Record<string, unknown>> = [];
/** The booking row, mutated by the real settle so it can be asserted on. */
let booking: Record<string, unknown> = {};

/* What `BookingEmailService` was asked to send, if anything. */
const bookingEmails: Array<{ bookingId: string; refundType: string }> = [];
/* And the invoice-only fallback, which a smart-link sale has no invoice for. */
const invoiceEmailAttempts: number[] = [];

jest.mock('@/lib/supabaseServer', () => {
  const builder = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let single = false;

    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.limit = () => self;
    self.order = () => self;
    self.maybeSingle = () => {
      single = true;
      return self;
    };
    self.eq = (column: string, value: unknown) => {
      filters[column] = value;
      return self;
    };
    self.is = (column: string, value: unknown) => {
      filters[`is:${column}`] = value;
      return self;
    };
    self.in = (column: string, values: unknown[]) => {
      filters[`in:${column}`] = values;
      return self;
    };
    self.update = (values: Record<string, unknown>) => {
      patch = values;
      return self;
    };

    self.then = (resolve: (value: unknown) => unknown) => {
      if (table === 'payment_transactions') {
        if (patch) {
          const hit = transactions.filter(
            row =>
              (filters.id === undefined || row.id === filters.id)
              && (filters['is:booking_id'] !== null || row.booking_id == null)
          );
          for (const row of hit) Object.assign(row, patch);
          return resolve({ data: hit.map(row => ({ id: row.id })), error: null });
        }

        /* Reads come from two places with different filters: the settle asks by
           `booking_id`, `notifyRefund` asks by `id`. Both are honoured so the
           real code decides what it sees, not the fake. */
        let rows = transactions;
        if (filters.booking_id !== undefined) {
          rows = rows.filter(row => row.booking_id === filters.booking_id);
        }
        if (filters.id !== undefined) rows = rows.filter(row => row.id === filters.id);
        if (filters['in:status']) {
          const allowed = filters['in:status'] as string[];
          rows = rows.filter(row => allowed.includes(row.status as string));
        }
        return resolve({ data: single ? (rows[0] ?? null) : rows, error: null });
      }

      if (table === 'scheduling_bookings') {
        if (patch) {
          /* `.eq('status','pending')` is how the real confirm is scoped: honour
             it, or this fake would hide the very guard that stops a refund
             confirming a booking. */
          const statusMatches =
            filters.status === undefined || booking.status === filters.status;
          if (statusMatches) Object.assign(booking, patch);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: single ? booking : [booking], error: null });
      }

      /* No invoice behind a smart-link booking: that is the point. */
      if (table === 'payment_invoices') {
        return resolve({ data: single ? null : [], error: null });
      }

      return resolve({ data: single ? null : [], error: null });
    };

    return self;
  };

  return { supabaseServer: { from: (table: string) => builder(table) } };
});

/* The email edge. Records what it was asked to send and sends nothing. */
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendRefundConfirmation: jest.fn(async (bookingId: string, _userId: string, opts: { refundType: string }) => {
      bookingEmails.push({ bookingId, refundType: opts.refundType });
      return true;
    }),
  },
}));

jest.mock('@/lib/notifications/emailTransport', () => ({
  sendEmail: jest.fn(async () => {
    invoiceEmailAttempts.push(1);
    return { success: true };
  }),
}));

const BOOKING = 'booking-1';
const OWNER = 'owner-1';

beforeEach(() => {
  bookingEmails.length = 0;
  invoiceEmailAttempts.length = 0;
  jest.clearAllMocks();

  /* The booking as it stood: confirmed and reading paid. */
  booking = {
    id: BOOKING,
    user_id: OWNER,
    status: 'confirmed',
    payment_status: 'paid',
    contact_id: 'contact-1',
    client_email: 'client@example.com',
  };
});

/**
 * The payment, fully refunded at Stripe.
 *
 * `linked` is the whole question: during the incident this was null, and every
 * reader that finds a booking's money by `booking_id` therefore found none.
 */
const refundedPayment = (linked: boolean) => [
  {
    id: 'tx-1',
    user_id: OWNER,
    booking_id: linked ? BOOKING : null,
    invoice_id: null,
    stripe_payment_intent_id: 'pi_live_1',
    amount: 50,
    refunded_amount: 50,
    status: 'refunded',
    currency: 'usd',
    processor_type: 'stripe',
  },
];

describe('the booking the owner looks at', () => {
  it('still reads paid when the payment was never linked: the incident', async () => {
    transactions = refundedPayment(false);

    const { syncBookingPaymentState } = await import('../syncBookingPaymentState');
    const state = await syncBookingPaymentState(BOOKING, OWNER);

    /*
     * This is the reported fault, reproduced against the real function. With
     * nothing settled it returns `unpaid` and deliberately writes NOTHING, so
     * the stale `paid` survives — which is exactly what the owner saw.
     */
    expect(state.status).toBe('unpaid');
    expect(booking.payment_status).toBe('paid');
  });

  it('reads refunded once the payment is linked', async () => {
    transactions = refundedPayment(true);

    const { syncBookingPaymentState } = await import('../syncBookingPaymentState');
    const state = await syncBookingPaymentState(BOOKING, OWNER);

    expect(state.status).toBe('refunded');
    expect(booking.payment_status).toBe('refunded');
  });

  it('keeps its stage: a refund moves money, not the booking', async () => {
    /*
     * DECIDED, not incidental: a refund does not affect the booking's stage.
     * Only `payment_status` moves.
     *
     * Two mechanisms keep that true and both are guarded here — the confirm is
     * skipped entirely on a refund, and it is scoped to `.eq('status','pending')`
     * so it could not promote a no-show even if it ran. A refunded no-show
     * stays a no-show, and the hour stays as the owner left it.
     */
    transactions = refundedPayment(true);
    booking.status = 'no_show';

    const { syncBookingPaymentState } = await import('../syncBookingPaymentState');
    await syncBookingPaymentState(BOOKING, OWNER);

    expect(booking.status).toBe('no_show');
  });
});

describe('the email the client should have had', () => {
  it('is never attempted when the payment is unlinked: the incident', async () => {
    transactions = refundedPayment(false);

    const { notifyRefund } = await import('../notifyRefund');
    await notifyRefund({
      transactionId: 'tx-1',
      userId: OWNER,
      refundId: 'refund-1',
      refundAmount: 50,
      currency: 'usd',
      reason: 'requested_by_customer',
      /* The owner ticked "tell the client". Without it nothing is sent at all —
         see the dedicated test below. */
      notifyContact: true,
    } as Parameters<typeof notifyRefund>[0]);

    /*
     * With no `booking_id` the real routing falls through to the invoice-only
     * path, and a smart-link sale has no invoice — so the client was told
     * nothing. No booking email was even attempted.
     */
    expect(bookingEmails).toEqual([]);
  });

  it('goes out as a booking refund once the payment is linked', async () => {
    transactions = refundedPayment(true);

    const { notifyRefund } = await import('../notifyRefund');
    await notifyRefund({
      transactionId: 'tx-1',
      userId: OWNER,
      refundId: 'refund-1',
      refundAmount: 50,
      currency: 'usd',
      reason: 'requested_by_customer',
      /* The owner ticked "tell the client". Without it nothing is sent at all —
         see the dedicated test below. */
      notifyContact: true,
    } as Parameters<typeof notifyRefund>[0]);

    expect(bookingEmails).toEqual([{ bookingId: BOOKING, refundType: 'full' }]);
  });

  it('is not sent at all unless the owner asked for it', async () => {
    /*
     * `notifyRefund` returns immediately on `!notifyContact`, and that is
     * deliberate: an unexpected "your money is on its way" is worse than
     * silence for a refund the client was never promised.
     *
     * Pinned because it is the SECOND reason a client can hear nothing, and it
     * is invisible next to the first. The missing link meant no email could go
     * out even when the box was ticked; with the link repaired, a client still
     * hears nothing if it was not. Anyone reading the incident should be able to
     * tell the two apart.
     */
    transactions = refundedPayment(true);

    const { notifyRefund } = await import('../notifyRefund');
    const sent = await notifyRefund({
      transactionId: 'tx-1',
      userId: OWNER,
      refundId: 'refund-1',
      refundAmount: 50,
      currency: 'usd',
    } as Parameters<typeof notifyRefund>[0]);

    expect(sent).toBe(false);
    expect(bookingEmails).toEqual([]);
  });

  it('says partial when only some of the money went back', async () => {
    /* A partial refund must never tell a client their money is fully returned.
       £20 of £50 back is 'partial'; the full case is asserted above. */
    transactions = refundedPayment(true);
    transactions[0].refunded_amount = 20;

    const { notifyRefund } = await import('../notifyRefund');
    await notifyRefund({
      transactionId: 'tx-1',
      userId: OWNER,
      refundId: 'refund-1',
      refundAmount: 20,
      currency: 'usd',
      notifyContact: true,
    } as Parameters<typeof notifyRefund>[0]);

    expect(bookingEmails[0]?.refundType).toBe('partial');
  });
});
