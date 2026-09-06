/**
 * Keeping a booking's payment_status honest.
 *
 * The trigger is the authority; this covers the same ground for the window
 * before it is applied, and it must agree with the trigger exactly. The cases
 * that matter are the two where writing the obvious value would destroy
 * information: a booking with no settled payment, and the enum's missing fourth
 * value.
 */

const dbState: {
  transactions: Array<Record<string, unknown>>;
  bookingUpdates: Array<Record<string, unknown>>;
  lookups: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
} = { transactions: [], bookingUpdates: [], lookups: [], invoices: [] };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let selected = '';

      builder.select = (columns: string) => {
        selected = columns;
        return builder;
      };
      builder.eq = () => builder;

      builder.in = (column: string) => {
        // `.in('status', …)` ends the settled-payment query; `.in('id', …)`
        // ends the lookup that maps transactions back to their bookings.
        if (table === 'payment_invoices') {
          return Promise.resolve({ data: dbState.invoices, error: null });
        }
        if (column === 'status') {
          return Promise.resolve({ data: dbState.transactions, error: null });
        }
        return Promise.resolve({ data: dbState.lookups, error: null });
      };

      builder.update = (row: Record<string, unknown>) => {
        if (table === 'scheduling_bookings') dbState.bookingUpdates.push(row);
        return { eq: () => ({ eq: async () => ({ error: null }) }) };
      };

      void selected;
      return builder;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { syncBookingPaymentState, syncBookingsForTransactions } from '../syncBookingPaymentState';

beforeEach(() => {
  dbState.transactions = [];
  dbState.bookingUpdates = [];
  dbState.lookups = [];
  dbState.invoices = [];
});

describe('syncBookingPaymentState', () => {
  it('marks a booking refunded once everything is back', async () => {
    dbState.transactions = [{ amount: 200, refunded_amount: 200, status: 'refunded' }];

    const state = await syncBookingPaymentState('booking-1', 'user-1');

    expect(state.status).toBe('refunded');
    expect(dbState.bookingUpdates[0]).toMatchObject({ payment_status: 'refunded' });
  });

  it('leaves a partially refunded booking as paid', async () => {
    /*
     * `payment_status` is read across the scheduling code as pending | paid |
     * refunded. Writing a fourth value would drop this booking out of every
     * reader comparing against those three — and it IS still holding money, so
     * `paid` is true within that vocabulary.
     */
    dbState.transactions = [{ amount: 200, refunded_amount: 50, status: 'succeeded' }];

    const state = await syncBookingPaymentState('booking-1', 'user-1');

    expect(state.status).toBe('partially_refunded');
    expect(dbState.bookingUpdates[0]).toMatchObject({ payment_status: 'paid' });
  });

  it('sums every payment rather than reading one', async () => {
    // The plan case. One period refunded out of three is not a refunded
    // booking, and reading a single transaction is what said it was.
    dbState.transactions = [
      { amount: 100, refunded_amount: 100, status: 'refunded' },
      { amount: 100, refunded_amount: 0, status: 'succeeded' },
      { amount: 100, refunded_amount: 0, status: 'succeeded' },
    ];

    await syncBookingPaymentState('booking-1', 'user-1');

    expect(dbState.bookingUpdates[0]).toMatchObject({ payment_status: 'paid' });
  });

  it('writes NOTHING when no payment has settled', async () => {
    // An invoice marked paid by hand carries no transaction. Writing `pending`
    // here would erase the fact that money arrived.
    dbState.transactions = [];

    const state = await syncBookingPaymentState('booking-1', 'user-1');

    expect(state.status).toBe('unpaid');
    expect(dbState.bookingUpdates).toHaveLength(0);
  });
});

describe('syncBookingsForTransactions', () => {
  it('does nothing when given no transactions', async () => {
    await syncBookingsForTransactions([], 'user-1');

    expect(dbState.bookingUpdates).toHaveLength(0);
  });

  it('follows a payment to its booking through the invoice', async () => {
    // Which link exists depends on the surface that sold it: a website sale
    // writes booking_id on the transaction, an invoice raised for a booking
    // carries it on the invoice.
    dbState.lookups = [{ booking_id: null, invoice_id: 'inv-1' }];
    dbState.invoices = [{ booking_id: 'booking-9' }];
    dbState.transactions = [{ amount: 100, refunded_amount: 100, status: 'refunded' }];

    await syncBookingsForTransactions(['tx-1'], 'user-1');

    expect(dbState.bookingUpdates[0]).toMatchObject({ payment_status: 'refunded' });
  });

  it('updates a booking once, however many of its payments were refunded', async () => {
    dbState.lookups = [
      { booking_id: 'booking-1', invoice_id: null },
      { booking_id: 'booking-1', invoice_id: null },
      { booking_id: 'booking-1', invoice_id: null },
    ];
    dbState.transactions = [{ amount: 300, refunded_amount: 300, status: 'refunded' }];

    await syncBookingsForTransactions(['tx-1', 'tx-2', 'tx-3'], 'user-1');

    expect(dbState.bookingUpdates).toHaveLength(1);
  });
});
