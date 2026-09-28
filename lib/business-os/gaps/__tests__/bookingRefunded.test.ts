/**
 * Refunded in full, and still in the diary.
 *
 * The state a Stripe-dashboard refund leaves behind: the money lands correctly
 * and the appointment carries on as though nothing happened. These assert the
 * two halves of the answer — the owner is ASKED, and the client's reminder is
 * HELD until they answer.
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  scheduling_bookings: [],
  crm_activities: [],
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

function booking(overrides: Row = {}): Row {
  return {
    id: 'b1',
    contact_id: 'c1',
    start_time: FUTURE,
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-24T09:00:00.000Z',
    payment_status: 'refunded',
    service: { service_name: 'Consultation' },
    contact: { first_name: 'Dana', last_name: 'Levi' },
    ...overrides,
  };
}

async function gap(id: 'booking_refunded' | 'meeting_upcoming') {
  const [found] = await findGaps('user-1', { only: [id], now: NOW });
  return found;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
});

describe('booking_refunded', () => {
  it('asks the owner about a refunded booking still in the diary', async () => {
    tables.scheduling_bookings = [booking()];

    const found = await gap('booking_refunded');

    expect(found.count).toBe(1);
    expect(found.action).toBe('cancel_booking');
    expect(found.items[0]).toMatchObject({ contactId: 'c1', name: 'Dana Levi', entityId: 'b1' });
  });

  it('stops asking once the owner has said it is still going ahead', async () => {
    tables.scheduling_bookings = [booking()];
    tables.crm_activities = [{ source_entity_id: 'b1' }];

    expect(await gap('booking_refunded')).toBeUndefined();
  });
});

describe('meeting_upcoming and a refunded booking', () => {
  /*
   * The harm this exists to stop: "see you tomorrow" to a client whose money
   * has already gone back.
   */
  it('holds the reminder while the question is open', async () => {
    tables.scheduling_bookings = [booking()];

    expect(await gap('meeting_upcoming')).toBeUndefined();
  });

  it('lets the reminder resume once the owner says keep it', async () => {
    tables.scheduling_bookings = [booking()];
    tables.crm_activities = [{ source_entity_id: 'b1' }];

    const found = await gap('meeting_upcoming');

    expect(found.count).toBe(1);
    expect(found.items[0].entityId).toBe('b1');
  });

  it('leaves an ordinary paid booking alone', async () => {
    tables.scheduling_bookings = [booking({ payment_status: 'paid' })];

    expect((await gap('meeting_upcoming')).count).toBe(1);
  });
});
