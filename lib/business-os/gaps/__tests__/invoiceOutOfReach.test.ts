/**
 * The invoice the chaser can no longer reach, and the card used to hide.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `processOverdueItems` sends only when the day count EQUALS a milestone:
 *
 *     if (config.overdueDays.includes(overdueDays))
 *
 * So switching the chaser on while an invoice sits at day 13 with milestones
 * {1,3,7} leaves it uncovered permanently — no milestone will ever equal 13
 * again. A cron run missed on the exact day loses that milestone the same way.
 *
 * And nothing said so. `invoice_unpaid` is `blocksOn: 'client'`, so `ownerGaps`
 * strips it; it returns only through `spent`, which keyed on `chaserDone`; and
 * `chaserDone` required at least one SENT reminder, which an invoice that was
 * never scheduled does not have. The robot would not act and the card would not
 * mention it. Four real invoices reached 13, 23, 24 and 31 days overdue that
 * way, totalling ₪1,500, while the advisor card reported them as handled.
 *
 * `chaserDone` now means "nobody is coming", which is the question the card was
 * always really asking.
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
  payment_invoices: [],
  payment_reminders: [],
  business_profiles: [],
};

/* The fake the sibling suites use: it ignores filters and answers with the whole
   table, which is why every rule under test is also applied in memory. */
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
            if (prop === 'maybeSingle') {
              return () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
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

/** Days before NOW, as a due date. */
const dueDaysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

const invoice = (overrides: Row = {}): Row => ({
  id: 'i1',
  contact_id: 'c1',
  client_name: 'Dana Levi',
  amount: 500,
  currency: 'ILS',
  status: 'overdue',
  due_date: dueDaysAgo(13),
  created_at: dueDaysAgo(40),
  ...overrides,
});

async function items() {
  const [gap] = await findGaps('user-1', { only: ['invoice_unpaid'], now: NOW });
  return gap?.items ?? [];
}

beforeEach(() => {
  tables.payment_invoices = [];
  tables.payment_reminders = [];
  /* Milestones {1,3,7}, the column default. */
  tables.business_profiles = [{ payment_overdue_reminder_days: [1, 3, 7] }];
});

describe('an invoice past every milestone', () => {
  it('is handed to the owner, even though it was never chased', async () => {
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(13) })];

    const [item] = await items();

    expect(item?.chaserDone).toBe(true);
  });

  it('stays with the robot while a milestone is still ahead', async () => {
    /* Day 2 with {1,3,7}: day 3 and day 7 are both still coming. */
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(2) })];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });

  it('counts the last milestone itself as still reachable', async () => {
    /* Day 7 of {1,3,7} is today's send, not a missed one. */
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(7) })];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });

  it('uses the default list when the business has set none', async () => {
    /* Default is [3,7,14], so day 13 is still reachable on it. */
    tables.business_profiles = [{ payment_overdue_reminder_days: null }];
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(13) })];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });

  it('says nothing about an invoice that is not yet due', async () => {
    tables.payment_invoices = [
      invoice({ due_date: new Date(NOW.getTime() + 5 * 86_400_000).toISOString() }),
    ];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });
});

describe('what counts as having been chased', () => {
  it('a sent overdue reminder with nothing queued means the robot has finished', async () => {
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(2) })];
    tables.payment_reminders = [
      { invoice_id: 'i1', status: 'sent', reminder_type: 'overdue' },
    ];

    const [item] = await items();

    expect(item?.chaserDone).toBe(true);
  });

  it('but not while another is still queued', async () => {
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(2) })];
    tables.payment_reminders = [
      { invoice_id: 'i1', status: 'sent', reminder_type: 'overdue' },
      { invoice_id: 'i1', status: 'pending', reminder_type: 'overdue' },
    ];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });

  it('ignores reminders sent BEFORE the invoice fell due', async () => {
    /*
     * `upcoming_due` and `due_today` answer to a different switch entirely.
     * Counting them meant an invoice whose only message was a courtesy note
     * before it fell due read as "the chaser has worked this", and the row
     * stayed hidden on the strength of a message about a debt that did not
     * exist yet.
     */
    tables.payment_invoices = [invoice({ due_date: dueDaysAgo(2) })];
    tables.payment_reminders = [
      { invoice_id: 'i1', status: 'sent', reminder_type: 'upcoming_due' },
      { invoice_id: 'i1', status: 'sent', reminder_type: 'due_today' },
    ];

    const [item] = await items();

    expect(item?.chaserDone).toBeUndefined();
  });
});
