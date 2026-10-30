/**
 * The two ways an appointment count goes wrong under the package shape.
 *
 * Both are silent. A missed package reads as a quiet diary; a double-counted
 * reschedule reads as a busy one. Neither raises anything.
 *
 * Split deliberately: the aggregation is exercised against a fake client, and
 * the PREDICATES are asserted at source. A fake cannot catch a missing
 * `.or(moved)` or a dropped `user_id`, because the fake is what decides which
 * rows come back — so testing those behaviourally would prove nothing. That is
 * the same division `busyMeetings.guard.test.ts` makes.
 */

import fs from 'fs';
import path from 'path';

import {
  appointmentsInRange,
  upcomingAppointments,
  appointmentOutcomes,
} from '@/lib/scheduling/appointmentFacts';

type Rows = { data: unknown[] | null; error: unknown };

/**
 * A Supabase chain that answers canned rows.
 *
 * Keyed by what is being asked for rather than by table, because the module
 * asks `scheduling_meetings` twice for different things.
 */
function fakeClient(responses: { meetings?: Rows; bookings?: Rows; replacements?: Rows }) {
  const empty: Rows = { data: [], error: null };

  return {
    from(table: string) {
      let key: 'meetings' | 'bookings' | 'replacements' =
        table === 'scheduling_bookings' ? 'bookings' : 'meetings';

      const chain: Record<string, unknown> = {
        select(columns: string) {
          if (columns.includes('replaces_meeting_id')) key = 'replacements';
          return chain;
        },
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        or: () => chain,
        in: () => chain,
        not: () => chain,
        then(resolve: (value: Rows) => unknown) {
          return Promise.resolve(responses[key] ?? empty).then(resolve);
        },
      };

      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stand-in for SupabaseClient; typing the full surface would be noise
  } as any;
}

const AHEAD = '2030-01-01T10:00:00.000Z';

describe('a package session is an appointment', () => {
  it('counts every session, not the one container holding them', async () => {
    const client = fakeClient({
      meetings: {
        data: [
          { id: 'm1', start_time: AHEAD, meeting_status: null },
          { id: 'm2', start_time: AHEAD, meeting_status: null },
          { id: 'm3', start_time: AHEAD, meeting_status: null },
        ],
        error: null,
      },
      bookings: { data: [], error: null },
    });

    expect(await appointmentsInRange(client, 'u1', '2020-01-01')).toBe(3);
  });

  it('only unsettled ones are still upcoming', async () => {
    const client = fakeClient({
      meetings: {
        data: [
          { id: 'm1', start_time: AHEAD, meeting_status: null },
          { id: 'm2', start_time: AHEAD, meeting_status: 'cancelled' },
          { id: 'm3', start_time: AHEAD, meeting_status: 'held' },
        ],
        error: null,
      },
    });

    /* `null` is the normal state of a future hour — see bookingStatus.ts. */
    expect(await upcomingAppointments(client, 'u1', '2020-01-01')).toBe(1);
  });
});

describe('a booking with no meeting row is still an appointment', () => {
  /*
   * Platform-wide, 26 dated bookings have no meeting row — legacy, from before
   * the split. Counting from the meetings table alone loses them, and loses
   * them invisibly on any account that happens to have none.
   */
  it('is counted once from the booking itself', async () => {
    const client = fakeClient({
      meetings: { data: [], error: null },
      bookings: {
        data: [
          { id: 'b1', start_time: AHEAD, status: 'confirmed', meeting_status: null, scheduling_meetings: [] },
        ],
        error: null,
      },
    });

    expect(await appointmentsInRange(client, 'u1', '2020-01-01')).toBe(1);
  });

  it('and a booking that HAS one is not counted twice', async () => {
    const client = fakeClient({
      meetings: { data: [{ id: 'm1', start_time: AHEAD, meeting_status: null }], error: null },
      bookings: {
        data: [
          {
            id: 'b1',
            start_time: AHEAD,
            status: 'confirmed',
            meeting_status: null,
            /* The embed proves a meeting exists; the meeting is the appointment. */
            scheduling_meetings: [{ id: 'm1' }],
          },
        ],
        error: null,
      },
    });

    expect(await appointmentsInRange(client, 'u1', '2020-01-01')).toBe(1);
  });

  it('a legacy completed booking reads as held, not as an open hour', async () => {
    const client = fakeClient({
      meetings: { data: [], error: null },
      bookings: {
        data: [
          { id: 'b1', start_time: AHEAD, status: 'completed', meeting_status: null, scheduling_meetings: [] },
        ],
        error: null,
      },
    });

    const outcomes = await appointmentOutcomes(client, 'u1', '2020-01-01');
    expect(outcomes.held).toBe(1);
    expect(outcomes.open).toBe(0);
  });
});

describe('a missed session that was made up is not still outstanding', () => {
  /*
   * The distinction migration 20261095 exists to make: on a package with two
   * misses, one made good and one not, every aggregate reads them the same.
   */
  it('splits the misses by whether anything stands in for them', async () => {
    const client = fakeClient({
      meetings: {
        data: [
          { id: 'missed-and-fixed', start_time: AHEAD, meeting_status: 'no_show' },
          { id: 'missed-and-waiting', start_time: AHEAD, meeting_status: 'no_show' },
          { id: 'the-make-up', start_time: AHEAD, meeting_status: null },
        ],
        error: null,
      },
      bookings: { data: [], error: null },
      replacements: { data: [{ replaces_meeting_id: 'missed-and-fixed' }], error: null },
    });

    const outcomes = await appointmentOutcomes(client, 'u1', '2020-01-01');
    expect(outcomes.no_show).toBe(2);
    expect(outcomes.no_show_made_up).toBe(1);
    expect(outcomes.no_show_outstanding).toBe(1);
  });

  it('leaves both at zero rather than guessing when the lookup fails', async () => {
    const client = fakeClient({
      meetings: {
        data: [{ id: 'missed', start_time: AHEAD, meeting_status: 'no_show' }],
        error: null,
      },
      bookings: { data: [], error: null },
      replacements: { data: null, error: { message: 'boom' } },
    });

    const outcomes = await appointmentOutcomes(client, 'u1', '2020-01-01');
    expect(outcomes.no_show).toBe(1);
    /* Reporting it outstanding would invent chasing work; reporting it made up
       would hide real work. Neither is said. */
    expect(outcomes.no_show_made_up).toBe(0);
    expect(outcomes.no_show_outstanding).toBe(0);
  });
});

describe('an unreadable half understates rather than throws', () => {
  it('still reports the meetings when the bookings cannot be read', async () => {
    const client = fakeClient({
      meetings: { data: [{ id: 'm1', start_time: AHEAD, meeting_status: null }], error: null },
      bookings: { data: null, error: { message: 'boom' } },
    });

    expect(await appointmentsInRange(client, 'u1', '2020-01-01')).toBe(1);
  });
});

describe('the predicates a fake client cannot prove', () => {
  const source = fs
    .readFileSync(path.join(process.cwd(), 'lib/scheduling/appointmentFacts.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('excludes a superseded attempt from the meetings read', () => {
    /*
     * A `moved` row's replacement sits beside it, so counting both turns one
     * appointment into two. bookingStatus.ts states the matching hazard: fold
     * `moved` into `cancelled` and every reschedule reports as a lost booking.
     */
    expect(source).toContain('meeting_status.neq.moved');
  });

  it('never writes that exclusion as a NOT IN', () => {
    /* `NULL NOT IN (…)` is NULL, not true, so every unmarked future hour would
       vanish — the normal state of every appointment yet to happen. */
    expect(source).not.toContain('not.in.(');
  });

  it('scopes both halves to the owner — CLAUDE.md rule 4', () => {
    expect(source.match(/\.eq\('user_id', userId\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('asks the bookings for their meetings, so orphans can be told apart', () => {
    expect(source).toContain('scheduling_meetings(id)');
    expect(source).toContain('.scheduling_meetings ?? []).length');
  });

  it('never counts an undated booking as an appointment', () => {
    /* No `start_time` and no meeting is work sold without an hour. The range
       filter is what excludes it, on both halves. */
    expect(source.match(/\.gte\('start_time', from\)/g)?.length).toBe(2);
  });
});
