/**
 * The meeting a clock closed, and when the card should stop asking about it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `auto_complete_meetings` marks an overdue meeting held because held is the
 * only answer available to it — no-show and called-off are judgements about a
 * room it was not in — and a date passing is not evidence anyone attended. The
 * row exists to put that guess in front of a person.
 *
 * It must end the moment a person answers, and answering has three shapes:
 *
 *   no-show      changes `meeting_status`
 *   called off   changes `meeting_status`
 *   it happened  changes NOTHING about the status, because the automation had
 *                already written `held`
 *
 * The original rule tested the status alone, so it caught the two corrections
 * and missed the agreement — which is the likeliest of the three. Found on a
 * real account: an owner had confirmed a meeting and raised its invoice, and
 * the card went on asking "did this happen?" every day, with the only way out
 * being to answer it wrongly.
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
  crm_activities: [],
  scheduling_bookings: [],
  crm_contacts: [],
};

/* The fake the sibling suites use: it ignores filters and answers with the
   whole table, so each test sets only what it means to speak about. */
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
const YESTERDAY = '2026-09-24T09:00:00.000Z';

const marker: Row = {
  source_entity_id: 'b1',
  activity_type: 'booking_auto_completed',
  created_at: YESTERDAY,
};

const booking = (overrides: Row = {}): Row => ({
  id: 'b1',
  contact_id: 'c1',
  status: 'confirmed',
  meeting_status: 'held',
  outcome_by: 'system',
  start_time: YESTERDAY,
  service: { service_name: 'Consultation' },
  ...overrides,
});

async function run() {
  const [gap] = await findGaps('user-1', { only: ['meeting_auto_completed'], now: NOW });
  return gap;
}

beforeEach(() => {
  tables.crm_activities = [];
  tables.scheduling_bookings = [];
  tables.crm_contacts = [{ id: 'c1', first_name: 'Dana', last_name: 'Levi' }];
});

describe('a meeting the automation closed off', () => {
  it('is put in front of the owner', async () => {
    tables.crm_activities = [marker];
    tables.scheduling_bookings = [booking()];

    expect((await run())?.count).toBe(1);
  });

  it('stops the moment the OWNER confirms it was held', async () => {
    /*
     * The case the status test could not see: confirming leaves
     * `meeting_status: 'held'` exactly as the automation left it, so only
     * `outcome_by` moves. Billed by then, too — this is the row that kept
     * asking about work already invoiced.
     */
    tables.crm_activities = [marker];
    tables.scheduling_bookings = [booking({ outcome_by: 'owner' })];

    expect(await run()).toBeUndefined();
  });

  it('and when the client is the one who answered', async () => {
    tables.crm_activities = [marker];
    tables.scheduling_bookings = [booking({ outcome_by: 'client' })];

    expect(await run()).toBeUndefined();
  });

  it('still stops on a correction, which is what already worked', async () => {
    /* These change the status, so the original rule caught them. Kept so a
       future edit cannot trade one answer for the other. */
    for (const corrected of ['no_show', 'cancelled']) {
      tables.crm_activities = [marker];
      tables.scheduling_bookings = [booking({ meeting_status: corrected })];

      expect(await run()).toBeUndefined();
    }
  });

  it('says nothing about a meeting the automation never touched', async () => {
    /* No marker, no claim. A meeting the owner marked held themselves has
       never been this gap's business. */
    tables.crm_activities = [];
    tables.scheduling_bookings = [booking({ outcome_by: 'owner' })];

    expect(await run()).toBeUndefined();
  });
});
