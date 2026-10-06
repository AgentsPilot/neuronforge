/**
 * The gap for a meeting nobody has said happened.
 *
 * Marking a meeting was optional admin with no consequence, so most are never
 * marked — and three things depend on it, each failing silently: a quoted job
 * cannot move to its price, the no-show rate is unknowable, and under
 * per-session billing the session is never invoiced.
 *
 * What these assert is the two edges. It must not nag about a meeting the owner
 * may still be in, and it must stop asking the moment they answer — because a
 * card that keeps asking an answered question is the one owners learn to ignore.
 *
 * Everything outside the definition is mocked. No network, no DB.
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  scheduling_bookings: [],
  crm_contacts: [],
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

import { readFileSync } from 'fs';
import { join } from 'path';

import { findGaps } from '../findGaps';

const NOW = new Date('2026-10-02T12:00:00.000Z');
/** Yesterday morning: past, and past the twelve-hour wait. */
const YESTERDAY = '2026-10-01T10:00:00.000Z';
/** Two hours ago: past, but the owner may have only just walked out. */
const JUST_NOW = '2026-10-02T10:00:00.000Z';

function booking(overrides: Row = {}): Row {
  return {
    id: 'b1',
    contact_id: 'c1',
    start_time: YESTERDAY,
    status: 'confirmed',
    service: { service_name: 'Consultation' },
    ...overrides,
  };
}

const CONTACT = { id: 'c1', first_name: 'Dana', last_name: 'Levi', email: 'dana@example.com' };

async function run() {
  const [gap] = await findGaps('user-1', { only: ['meeting_unmarked'], now: NOW });
  return gap;
}

beforeEach(() => {
  tables.scheduling_bookings = [];
  tables.crm_contacts = [CONTACT];
});

describe('meeting_unmarked', () => {
  it('asks about a meeting whose time has passed', async () => {
    tables.scheduling_bookings = [booking()];

    const gap = await run();

    expect(gap.count).toBe(1);
    expect(gap.blocksOn).toBe('owner');
    expect(gap.action).toBe('mark_meeting');
    expect(gap.items[0]).toMatchObject({
      contactId: 'c1',
      name: 'Dana Levi',
      // The service, so the row says which meeting it is asking about.
      note: 'Consultation',
      // The START time: what the owner recognises, and what the wait measures.
      since: YESTERDAY,
      entityId: 'b1',
    });
  });

  it('waits twelve hours, so nobody is nagged about a session they just left', async () => {
    tables.scheduling_bookings = [booking({ start_time: JUST_NOW })];

    expect((await run())?.count ?? 0).toBe(0);
  });

  it('asks about a pending booking too — it can still be marked', async () => {
    tables.scheduling_bookings = [booking({ status: 'pending' })];

    expect((await run()).count).toBe(1);
  });

  it('one row per meeting, because two answers may differ', async () => {
    // One was held, one was missed; collapsing them would hide a decision.
    tables.scheduling_bookings = [
      booking({ id: 'b1' }),
      booking({ id: 'b2', start_time: '2026-09-28T10:00:00.000Z' }),
    ];

    const gap = await run();
    expect(gap.count).toBe(2);
    expect(gap.items.map(i => i.entityId)).toEqual(['b1', 'b2']);
  });

  it('survives a booking whose service could not be read', async () => {
    tables.scheduling_bookings = [booking({ service: null })];

    const gap = await run();
    expect(gap.count).toBe(1);
    expect(gap.items[0].note).toBeUndefined();
  });

  it('says nothing when there is nothing to ask about', async () => {
    expect(await run()).toBeUndefined();
  });
});

/*
 * The clauses above this harness cannot reach.
 *
 * The Supabase mock answers every builder call with the same rows, so a filter
 * applied IN THE QUERY is invisible to the tests above — they exercise the
 * mapping and the twelve-hour wait, which `findGaps` applies in JavaScript.
 * Three things that matter are query-level, so they are asserted at the source:
 * which statuses can still be marked, that a product with no time is not asked
 * about, and the age floor that stops a year of legacy rows becoming a count
 * that never moves.
 */
describe('the query, read at the source', () => {
  const source = readFileSync(
    join(process.cwd(), 'lib', 'business-os', 'gaps', 'definitions.ts'),
    'utf8'
  );
  const definition = source.slice(
    source.indexOf("id: 'meeting_unmarked'"),
    source.indexOf('export const GAP_DEFINITIONS')
  );

  it('asks only about bookings that can still be marked', () => {
    expect(definition).toContain(".in('status', ['confirmed', 'pending'])");
  });

  it('never asks about a sale with no meeting in it', () => {
    expect(definition).toContain(".not('start_time', 'is', null)");
  });

  it('stops asking once it is too old to answer', () => {
    expect(definition).toContain('UNMARKED_MAX_AGE_DAYS');
    expect(source).toContain('const UNMARKED_MAX_AGE_DAYS = 90');
  });
});
