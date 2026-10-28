/**
 * The two money holes nothing used to watch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `booking_unbilled`      work was done and nobody asked to be paid for it.
 * `delivery_unconfirmed`  money arrived and nothing says the work was handed
 *                         over.
 *
 * Both were owner moves the booking card has offered for a long time —
 * `send_invoice` and `mark_delivered` — with no detector behind either, so a
 * business could sit in one of them for months and never be told. They are
 * opposite halves of one pair: a debt owed to the owner, and an obligation
 * owed by them.
 *
 * Most of what is asserted here is what must NOT fire. A new alert that nags
 * about settled work is worse than no alert, and the first run of
 * `delivery_unconfirmed` against a real account produced six rows of which
 * every one was wrong — courses still being paid for in instalments, and a
 * treatment package three sessions into six. Each of those is a case below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  scheduling_bookings: [],
  scheduling_meetings: [],
  payment_invoices: [],
  payment_transactions: [],
  payment_plan_installments: [],
  crm_contacts: [],
};

/*
 * The same fake the sibling suites use: it ignores every filter and answers
 * with the whole table. That is why each test sets the tables it means to
 * speak about and leaves the rest empty — a row left behind in
 * `payment_transactions` answers a question asked about invoices.
 */
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
const PAST = '2026-09-01T09:00:00.000Z';
const FUTURE = '2026-10-10T09:00:00.000Z';

async function run(id: 'booking_unbilled' | 'delivery_unconfirmed') {
  const [gap] = await findGaps('user-1', { only: [id], now: NOW });
  return gap;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
});

describe('work that was done and never charged for', () => {
  const held = (overrides: Row = {}): Row => ({
    id: 'b1',
    contact_id: 'c1',
    status: 'confirmed',
    meeting_status: 'held',
    start_time: PAST,
    created_at: PAST,
    service: { service_name: 'Consultation', price: 400 },
    contact: { first_name: 'Dana', last_name: 'Levi' },
    ...overrides,
  });

  it('asks once the hour has passed with nothing raised', async () => {
    tables.scheduling_bookings = [held()];

    const gap = await run('booking_unbilled');

    expect(gap?.count).toBe(1);
    expect(gap?.items[0].value).toBe(400);
  });

  it('says nothing where an invoice already exists, even a draft', async () => {
    /* A draft is somebody part-way through this exact task. */
    tables.scheduling_bookings = [held()];
    tables.payment_invoices = [{ booking_id: 'b1', status: 'draft' }];

    expect(await run('booking_unbilled')).toBeUndefined();
  });

  it('nor where it was paid at checkout', async () => {
    tables.scheduling_bookings = [held()];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];

    expect(await run('booking_unbilled')).toBeUndefined();
  });

  it('nor where a plan stage owns the money', async () => {
    /* `stage_awaiting_completion` raises those, and two rows for one sum would
       ask the owner to bill it twice. */
    tables.scheduling_bookings = [held()];
    tables.payment_plan_installments = [{ booking_id: 'b1', status: 'pending' }];

    expect(await run('booking_unbilled')).toBeUndefined();
  });

  it('leaves free work alone', async () => {
    /* Free is not unbilled. A consultation offered at no charge must never
       become a task about money. */
    for (const price of [0, null, undefined]) {
      tables.scheduling_bookings = [
        held({ service: { service_name: 'Intro call', price } }),
      ];

      expect(await run('booking_unbilled')).toBeUndefined();
    }
  });

  it('never bills for an hour that has not happened', async () => {
    /* `meeting_status` can be written early behind the testing flag, and this
       is the one mistake the gap must not prompt. */
    tables.scheduling_bookings = [held({ start_time: FUTURE })];

    expect(await run('booking_unbilled')).toBeUndefined();
  });

  it('ignores a booking that was called off', async () => {
    tables.scheduling_bookings = [held({ status: 'cancelled' })];

    expect(await run('booking_unbilled')).toBeUndefined();
  });
});

describe('work that was paid for and never handed over', () => {
  const course = (overrides: Row = {}): Row => ({
    id: 'b1',
    contact_id: 'c1',
    status: 'confirmed',
    meeting_status: null,
    start_time: null,
    created_at: PAST,
    service: { service_name: 'Attention course', is_scheduled: false },
    contact: { first_name: 'Dana', last_name: 'Levi' },
    ...overrides,
  });

  it('asks once the money is in and nothing says it was handed over', async () => {
    tables.scheduling_bookings = [course()];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];

    expect((await run('delivery_unconfirmed'))?.count).toBe(1);
  });

  it('says nothing before the money arrives', async () => {
    /* Asking the owner to hand over work nobody has paid for is the opposite
       advice. That one belongs to the invoice gaps. */
    tables.scheduling_bookings = [course()];

    expect(await run('delivery_unconfirmed')).toBeUndefined();
  });

  it('nor once it has been handed over', async () => {
    /* Both spellings, because `complete()` writes the first and an older
       booking carries the second. */
    for (const settled of [
      { meeting_status: 'held' },
      { meeting_status: null, status: 'completed' },
    ]) {
      tables.scheduling_bookings = [course(settled)];
      tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];

      expect(await run('delivery_unconfirmed')).toBeUndefined();
    }
  });

  it('nor for a scheduled service, which ends at its meeting', async () => {
    /* `meeting_unmarked` asks about those, and the resolver draws the same
       line in the same words. */
    tables.scheduling_bookings = [
      course({
        service: { service_name: 'Consultation', is_scheduled: true },
        start_time: PAST,
      }),
    ];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];

    expect(await run('delivery_unconfirmed')).toBeUndefined();
  });

  it('nor while a plan is still collecting for it', async () => {
    /*
     * The first real-account run's biggest wrong answer: courses bought on
     * instalments, still being charged for, reported as owed to the client.
     * `moneyStateFrom` has always counted a plan paid only once every period
     * is in.
     */
    tables.scheduling_bookings = [course()];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];
    tables.payment_plan_installments = [{ booking_id: 'b1', status: 'pending' }];

    expect(await run('delivery_unconfirmed')).toBeUndefined();
  });

  it('but a finished plan is money in', async () => {
    tables.scheduling_bookings = [course()];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];
    tables.payment_plan_installments = [
      { booking_id: 'b1', status: 'paid' },
      /* A period the owner called off is not still outstanding. */
      { booking_id: 'b1', status: 'cancelled' },
    ];

    expect((await run('delivery_unconfirmed'))?.count).toBe(1);
  });

  it('ignores a booking that was called off', async () => {
    tables.scheduling_bookings = [course({ status: 'cancelled' })];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];

    expect(await run('delivery_unconfirmed')).toBeUndefined();
  });

  it('nor for a package container, which has no handover of its own', async () => {
    /*
     * A container carries no `start_time` by design — the hours belong to its
     * sessions — so it reads as dateless. It is delivered THROUGH those
     * sessions, each answered by `meeting_unmarked` or billed by
     * `stage_awaiting_completion`, and asking for one handover would be asking
     * about work still in progress.
     */
    tables.scheduling_bookings = [course({ service: { service_name: 'Six treatments' } })];
    tables.payment_transactions = [{ booking_id: 'b1', status: 'succeeded' }];
    tables.scheduling_meetings = [{ booking_id: 'b1' }];

    expect(await run('delivery_unconfirmed')).toBeUndefined();
  });
});
