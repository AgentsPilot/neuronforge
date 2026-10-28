/**
 * The gap for a booking the CLIENT cancelled.
 *
 * Two rows that look alike and mean different things: one where money is held
 * and one where none is. This asserts the difference — what each is worth, and
 * which of them is allowed to age off the card.
 *
 * Everything outside the definition is mocked. No network, no DB.
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

type Row = Record<string, unknown>;

/** What each table answers with, set per test. */
const tables: Record<string, Row[]> = {
  scheduling_bookings: [],
  payment_invoices: [],
  payment_transactions: [],
  payment_plan_subscriptions: [],
};

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => {
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => unknown) =>
                resolve({ data: tables[table] ?? [], error: null });
            }
            return () => builder;
          },
        }
      );
      return builder;
    },
  },
}));

import { findGaps } from '../findGaps';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const FUTURE = '2026-10-10T09:00:00.000Z';
const PAST = '2026-09-01T09:00:00.000Z';

function booking(overrides: Row): Row {
  return {
    id: 'b1',
    contact_id: 'c1',
    start_time: FUTURE,
    updated_at: '2026-09-24T09:00:00.000Z',
    created_at: '2026-09-01T09:00:00.000Z',
    cancellation_reason: 'Cancelled by client: something came up',
    service: { service_name: 'Consultation' },
    contact: { first_name: 'Dana', last_name: 'Levi', email: 'dana@example.com' },
    ...overrides,
  };
}

async function run() {
  const [gap] = await findGaps('user-1', { only: ['booking_cancelled'], now: NOW });
  return gap;
}

beforeEach(() => {
  tables.scheduling_bookings = [];
  tables.payment_invoices = [];
  tables.payment_transactions = [];
  tables.payment_plan_subscriptions = [];
});

describe('booking_cancelled', () => {
  it('reports what is still held on a paid booking, net of refunds', async () => {
    tables.scheduling_bookings = [booking({})];
    tables.payment_invoices = [{ id: 'inv-1', booking_id: 'b1' }];
    tables.payment_transactions = [
      { id: 'tx-1', booking_id: 'b1', invoice_id: 'inv-1', amount: 400, refunded_amount: 100, currency: 'ILS' },
    ];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.items[0]).toMatchObject({
      contactId: 'c1',
      name: 'Dana Levi',
      note: 'Consultation',
      entityId: 'b1',
      value: 300,
      currency: 'ILS',
    });
  });

  it('keeps a row with money on it even after the appointment time has passed', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];
    tables.payment_transactions = [
      { id: 'tx-1', booking_id: 'b1', invoice_id: null, amount: 400, refunded_amount: 0, currency: 'ILS' },
    ];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.items[0].value).toBe(400);
  });

  it('drops a row with no money once the slot it freed has been and gone', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];

    expect(await run()).toBeUndefined();
  });

  it('keeps a row with no money while the freed slot is still ahead', async () => {
    tables.scheduling_bookings = [booking({ start_time: FUTURE })];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.items[0].value).toBeUndefined();
  });

  it('holds nothing once the money has been fully given back', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];
    tables.payment_transactions = [
      { id: 'tx-1', booking_id: 'b1', invoice_id: null, amount: 400, refunded_amount: 400, currency: 'ILS' },
    ];

    // Nothing owed and the hour is gone: the row has done its job and leaves.
    expect(await run()).toBeUndefined();
  });

  /*
   * THE DIRECT ONLINE SALE. Paid through the booking widget: a transaction
   * carrying the booking id and no invoice anywhere. Read off the invoices this
   * looked unpaid, so the row offered a booking link over money the business
   * was holding, then aged off once the slot passed and took the debt with it.
   */
  it('reports money paid online with no invoice behind it', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];
    tables.payment_transactions = [
      { id: 'tx-1', booking_id: 'b1', invoice_id: null, amount: 180, refunded_amount: 0, currency: 'USD' },
    ];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.items[0]).toMatchObject({ value: 180, currency: 'USD' });
  });

  /*
   * A payment carrying BOTH a booking id and an invoice id comes back from each
   * of the two queries. Counted twice it would report double the money, on the
   * button that hands it back.
   */
  it('counts a payment once even though both queries return it', async () => {
    tables.scheduling_bookings = [booking({})];
    tables.payment_invoices = [{ id: 'inv-1', booking_id: 'b1' }];
    tables.payment_transactions = [
      { id: 'tx-1', booking_id: 'b1', invoice_id: 'inv-1', amount: 250, refunded_amount: 0, currency: 'ILS' },
    ];

    expect((await run()).items[0].value).toBe(250);
  });

  /*
   * A plan still charging is the row that must never disappear. The slot being
   * gone does not stop the debits, and nothing was paid against THIS booking to
   * hold it on the card by amount — so without the plan check it would age off
   * while the client's card kept being taken.
   */
  it('keeps a cancelled booking whose plan is still charging, with nothing held and the slot gone', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];
    tables.payment_plan_subscriptions = [{ booking_id: 'b1', status: 'active' }];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.items[0].planLive).toBe(true);
    expect(gap.items[0].value).toBeUndefined();
  });

  it('does not treat a finished plan as still charging', async () => {
    tables.scheduling_bookings = [booking({ start_time: PAST })];
    // The query filters these out server-side; this proves the row then falls
    // back to the ordinary expiry rather than being kept alive by a dead plan.
    tables.payment_plan_subscriptions = [];

    expect(await run()).toBeUndefined();
  });

  it('ignores a booking with no contact, which nothing on the card could act on', async () => {
    tables.scheduling_bookings = [booking({ contact_id: null })];

    expect(await run()).toBeUndefined();
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CLIENT WHO ALREADY CAME BACK.
   *
   * The cancellation email carries a booking button — the path a client
   * cancels through does not suppress `offerRebooking` — and a good share of
   * them press it. Nothing here noticed: the row filtered on the booking being
   * cancelled and on who cancelled it, and neither changes when the same
   * client books again. So the owner kept being told to "send booking link" to
   * someone already sitting in Thursday's diary.
   *
   * Only the empty-slot case is dropped. Being back in the diary does not
   * return a deposit or stop a plan debiting.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('once the client has booked again', () => {
    const upcoming = (overrides: Row = {}): Row => ({
      id: 'b2',
      contact_id: 'c1',
      status: 'confirmed',
      start_time: FUTURE,
      ...overrides,
    });

    it('stops asking the owner to send a link', async () => {
      tables.scheduling_bookings = [booking({}), upcoming()];

      expect(await run()).toBeUndefined();
    });

    it('but only for that client', async () => {
      tables.scheduling_bookings = [booking({}), upcoming({ contact_id: 'someone_else' })];

      expect((await run())?.count).toBe(1);
    });

    it('does not count a cancelled or missed appointment as coming back', async () => {
      /* A dead hour refills nothing. Both are still rows on the contact. */
      for (const status of ['cancelled', 'no_show']) {
        tables.scheduling_bookings = [booking({}), upcoming({ status })];

        expect((await run())?.count).toBe(1);
      }
    });

    it('does not count an hour that has already passed', async () => {
      tables.scheduling_bookings = [booking({}), upcoming({ start_time: PAST })];

      expect((await run())?.count).toBe(1);
    });

    it('never lets a reported row answer its own question', async () => {
      /*
       * The cancelled booking is itself a row on this contact. Counting it
       * would have every row suppress itself and empty the gap entirely —
       * which is precisely what the fake above would produce without the
       * `cancelledIds` test, since it returns the same rows for every query.
       */
      tables.scheduling_bookings = [booking({})];

      expect((await run())?.count).toBe(1);
    });

    it('still refunds, because being back does not return the money', async () => {
      tables.scheduling_bookings = [booking({}), upcoming()];
      tables.payment_transactions = [
        { booking_id: 'b1', amount: 250, status: 'succeeded', refunded_amount: 0 },
      ];

      const gap = await run();

      expect(gap?.count).toBe(1);
      expect(gap?.items[0].value).toBe(250);
    });

    it('and a plan still charging outlives it too', async () => {
      tables.scheduling_bookings = [booking({}), upcoming()];
      tables.payment_plan_subscriptions = [{ booking_id: 'b1', status: 'active' }];

      const gap = await run();

      expect(gap?.count).toBe(1);
      expect(gap?.items[0].planLive).toBe(true);
    });
  });

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A DAY TO COME BACK ON THEIR OWN.
   *
   * The cancellation email carries a booking button and reaches the client
   * immediately. The row used to appear at that same moment, so the owner's
   * first instruction was to send a link already sitting in the client's
   * inbox. A day later the row means something the email cannot: they had the
   * link and did not use it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('the first day after they cancel', () => {
    /* NOW is 2026-09-25T12:00Z. */
    const JUST_NOW = '2026-09-25T11:00:00.000Z';
    const YESTERDAY = '2026-09-24T09:00:00.000Z';

    it('says nothing while the email is still fresh', async () => {
      tables.scheduling_bookings = [booking({ updated_at: JUST_NOW })];

      expect(await run()).toBeUndefined();
    });

    it('asks once the day has passed and they have not come back', async () => {
      tables.scheduling_bookings = [booking({ updated_at: YESTERDAY })];

      expect((await run())?.count).toBe(1);
    });

    it('does not make money wait', async () => {
      /* A deposit sitting in the wrong place for a day is the cost of getting
         this wrong, so the refund case ignores the grace entirely. */
      tables.scheduling_bookings = [booking({ updated_at: JUST_NOW })];
      tables.payment_transactions = [
        { booking_id: 'b1', amount: 250, status: 'succeeded', refunded_amount: 0 },
      ];

      expect((await run())?.count).toBe(1);
    });

    it('nor a plan that is still charging them', async () => {
      tables.scheduling_bookings = [booking({ updated_at: JUST_NOW })];
      tables.payment_plan_subscriptions = [{ booking_id: 'b1', status: 'active' }];

      expect((await run())?.count).toBe(1);
    });

    it('shows a row whose timestamp cannot be read rather than hiding it', async () => {
      /* Seen early is a smaller failure than never seen, and nobody else is
         watching this client. */
      tables.scheduling_bookings = [booking({ updated_at: null, created_at: null })];

      expect((await run())?.count).toBe(1);
    });
  });
});
