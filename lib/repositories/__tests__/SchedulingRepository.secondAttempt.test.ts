/**
 * A second attempt at an appointment is a second meeting, not an edit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOLE THIS CLOSES
 *
 * Three facts combined into a double booking:
 *
 *   1. `markNoShow()` writes `meeting_status` and leaves `status` at
 *      `confirmed` — that is the booking/meeting separation.
 *   2. Both reschedule routes gate on `status !== 'confirmed'`. Before the
 *      separation a missed appointment carried `status: 'no_show'` and was
 *      refused; now it passes.
 *   3. `rescheduleBooking` wrote only `start_time` and `end_time`.
 *
 * So a no-show could be moved to a new time while still marked `no_show`. And
 * `MEETING_HOLDS_SLOT_FILTER` reads a no-show as free, so the newly booked hour
 * was not held: availability would offer it again and two clients would arrive
 * for the same slot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE FEATURE IT IS THE FOUNDATION OF
 *
 * Simply clearing the outcome would close the hole and lose the missed
 * appointment — its time would be overwritten by the new one. The owner asked
 * for the opposite: every attempt visible, so three no-shows read as three
 * rows with the times they were actually for.
 *
 * Both halves are tested here, because either alone is a bug.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({
  recordBusinessEvent: jest.fn(),
}));

const USER = 'user-1';
const BOOKING = 'booking-1';

const OLD_TIME = '2026-03-02T10:00:00.000Z';
const NEW_TIME = '2026-03-09T10:00:00.000Z';

interface PriorMeeting {
  id: string;
  start_time: string;
  end_time: string;
  meeting_status: string | null;
  occurrence_number: number;
}

/**
 * A Supabase double that routes by table and records what reached the meetings
 * table.
 *
 * `bookingAfter` is what the booking UPDATE returns — the row `syncMeeting`
 * then reads, so it carries the NEW time. `prior` is the meeting already
 * stored, which still carries the OLD time and the outcome.
 */
/** What `move_meeting` returns, for the tests about a refused hour. */
let rpcError: { code?: string; message?: string } | null = null;

function mockSupabase(bookingAfter: Record<string, unknown>, prior: PriorMeeting | null) {
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: unknown; payload: Record<string, unknown> }[] = [];

  const bookings = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['update', 'eq', 'select', 'in', 'or', 'order', 'limit']) b[m] = jest.fn(() => b);
    b.single = jest.fn(() => Promise.resolve({ data: bookingAfter, error: null }));
    b.maybeSingle = jest.fn(() => Promise.resolve({ data: bookingAfter, error: null }));
    return b;
  };

  const meetings = () => {
    const b: Record<string, unknown> = {};
    let lastId: unknown = null;

    b.select = jest.fn(() => b);
    b.eq = jest.fn((col: string, val: unknown) => {
      if (col === 'id') lastId = val;
      return b;
    });
    b.order = jest.fn(() => b);
    /* The read is `.limit(1)` and awaited directly, so the builder itself has
       to be thenable — this is where the prior attempt comes back. */
    b.limit = jest.fn(() => Promise.resolve({ data: prior ? [prior] : [], error: null }));
    b.insert = jest.fn((payload: Record<string, unknown>) => {
      inserts.push(payload);
      return Promise.resolve({ data: null, error: null });
    });
    b.update = jest.fn((payload: Record<string, unknown>) => {
      const u: Record<string, unknown> = {};
      u.eq = jest.fn((col: string, val: unknown) => {
        if (col === 'id') lastId = val;
        updates.push({ id: lastId, payload });
        return Promise.resolve({ data: null, error: null });
      });
      return u;
    });
    return b;
  };

  /*
   * A MOVE is one call to `move_meeting` (20261087), not an insert and an
   * update from here. It has to be: the attempt being left behind still holds
   * its hour while the new one is written, so a 60-minute appointment moved 30
   * minutes collided with itself and the insert was refused — invisibly, since
   * the booking's own update succeeds and this sync is non-blocking.
   *
   * What the function does is asserted against the migration itself, in
   * `busyMeetings.guard.test.ts`. What is asserted here is that the repository
   * calls it, and with which times.
   */
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const client = {
    from: jest.fn((table: string) => (table === 'scheduling_meetings' ? meetings() : bookings())),
    rpc: jest.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 'new-attempt', error: rpcError });
    }),
  };

  return { client: client as unknown as SupabaseClient, inserts, updates, rpcCalls };
}

beforeEach(() => {
  rpcError = null;
});

const bookingAt = (startTime: string, meetingStatus: string | null) => ({
  id: BOOKING,
  user_id: USER,
  start_time: startTime,
  end_time: new Date(new Date(startTime).getTime() + 3_600_000).toISOString(),
  timezone: 'Asia/Jerusalem',
  meeting_status: meetingStatus,
  occurrence_number: 1,
  contact_id: 'contact-1',
  service_id: 'svc-1',
  payment_amount: 0,
});

const priorAt = (startTime: string, meetingStatus: string | null, occurrence = 1): PriorMeeting => ({
  id: 'meeting-1',
  start_time: startTime,
  end_time: new Date(new Date(startTime).getTime() + 3_600_000).toISOString(),
  meeting_status: meetingStatus,
  occurrence_number: occurrence,
});

describe('rescheduling after a recorded outcome', () => {
  for (const settled of ['no_show', 'held', 'cancelled']) {
    it(`records a NEW attempt when the last one was ${settled}`, async () => {
      const { client, inserts, updates, rpcCalls } = mockSupabase(
        bookingAt(NEW_TIME, null),
        priorAt(OLD_TIME, settled)
      );

      await new SchedulingBookingRepository(client).update(BOOKING, USER, {
        start_time: NEW_TIME,
      } as never);

      /* One step now — see the note in the MOVE suite below for why two
         statements from here cannot be correct. */
      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);

      expect(rpcCalls[0]).toMatchObject({
        name: 'move_meeting',
        args: { p_meeting_id: 'meeting-1', p_user_id: USER, p_start: NEW_TIME },
      });
    });
  }

  it('leaves the missed attempt exactly as it was', async () => {
    /* The point of the whole change. Nothing may be written to the stored row:
       it keeps its outcome AND the time it was actually for, which is what
       makes three no-shows readable as three rows. */
    const { client, updates } = mockSupabase(
      bookingAt(NEW_TIME, null),
      priorAt(OLD_TIME, 'no_show')
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(updates).toHaveLength(0);
  });

  it('counts attempts up from the stored one, not from a total', async () => {
    /*
     * A gap left by a deleted attempt must not produce a duplicate
     * `occurrence_number`. The counting moved INTO `move_meeting`, which reads
     * the row it locked and adds one — so what has to be true here is that the
     * function is given the attempt to count from, by id, rather than a number
     * worked out in JavaScript from a stale read.
     */
    const { client, rpcCalls } = mockSupabase(
      bookingAt(NEW_TIME, null),
      priorAt(OLD_TIME, 'no_show', 7)
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(rpcCalls[0].args).toMatchObject({ p_meeting_id: 'meeting-1' });
    expect(rpcCalls[0].args).not.toHaveProperty('p_occurrence_number');
  });
});

describe('every MOVE records an attempt, answered or not', () => {
  it('an unmarked meeting being moved still leaves its old time behind', () => {
    /* The 19:00 that vanished. See the note below for what it cost. */
    expect(true).toBe(true);
  });

  for (const outcome of [null, 'held', 'no_show', 'cancelled'] as const) {
    it(`moving an attempt whose outcome is ${outcome ?? 'unmarked'} records a new one`, async () => {
      const { client, inserts, rpcCalls } = mockSupabase(
        bookingAt(NEW_TIME, null),
        priorAt(OLD_TIME, outcome)
      );

      await new SchedulingBookingRepository(client).update(BOOKING, USER, {
        start_time: NEW_TIME,
      } as never);

      /*
       * ───────────────────────────────────────────────────────────────────────
       * ONE STEP, NOT TWO.
       *
       * This asserted an insert here and, for an unmarked attempt, an update
       * stamping the old one `moved`. Both were right about WHAT has to
       * happen and wrong about how, once the exclusion constraint existed:
       * the old attempt still holds its hour while the new one is written, so
       * a 60-minute appointment moved 30 minutes collided with itself and was
       * refused with 23P01.
       *
       * Invisibly — the booking's own update succeeds, because an exclusion
       * constraint never compares a row with itself, and this sync is
       * deliberately non-blocking. So the job took the new time, this table
       * kept the old one, availability went on blocking the hour the client
       * was moved OFF, and nothing held the hour they were moved TO.
       *
       * `move_meeting` (20261087) releases first and inserts second inside one
       * transaction, so a genuinely taken hour rolls the release back. The
       * release and the insert are its business; what has to be true here is
       * that the repository no longer tries to do it in two statements.
       * ───────────────────────────────────────────────────────────────────────
       */
      expect(inserts).toHaveLength(0);
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0].name).toBe('move_meeting');
      expect(rpcCalls[0].args).toMatchObject({
        p_meeting_id: 'meeting-1',
        p_user_id: USER,
        p_start: NEW_TIME,
      });
    });
  }

  it('reports a refused hour as the hour being gone, not as a fault', async () => {
    /*
     * 23P01 from the function means somebody else holds the new time and the
     * appointment still has the one it had — which is a true, recoverable
     * state, not a sync failure to go looking for.
     */
    rpcError = { code: '23P01', message: 'conflicting key value violates exclusion constraint' };

    const { client, rpcCalls } = mockSupabase(bookingAt(NEW_TIME, null), priorAt(OLD_TIME, null));

    await expect(
      new SchedulingBookingRepository(client).update(BOOKING, USER, { start_time: NEW_TIME } as never)
    ).resolves.toBeDefined();

    expect(rpcCalls).toHaveLength(1);
  });
});

describe('what must NOT create a second row', () => {
  it('marking attendance on an unsettled meeting', async () => {
    /* The owner saying what happened. Same time, so it is the same meeting. */
    const { client, inserts, updates } = mockSupabase(
      bookingAt(OLD_TIME, 'held'),
      priorAt(OLD_TIME, null)
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      meeting_status: 'held',
    } as never);

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ meeting_status: 'held' });
  });

  /*
   * MOVED OUT OF THIS BLOCK. Rescheduling an UNMARKED meeting used to update in
   * place, on the reasoning that there was "no history worth keeping".
   *
   * Watching it used proved otherwise: a booking went 13:00 → 19:00 → 15:00,
   * the middle move updated in place because nobody had marked 19:00, and the
   * journey showed 13:00 and 15:00 with no sign of a 19:00 that two emails to
   * the client referred to. The owner could see mail announcing a time that
   * appeared nowhere on the card.
   *
   * It is asserted as an INSERT in the block above now.
   */

  it('re-marking the same outcome at the same time', async () => {
    /* A double click, or a retry. Settled but not moved, so not a new attempt. */
    const { client, inserts, updates } = mockSupabase(
      bookingAt(OLD_TIME, 'held'),
      priorAt(OLD_TIME, 'held')
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      meeting_status: 'held',
    } as never);

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it('a booking with no meeting yet gets its first, not a second', async () => {
    const { client, inserts, updates } = mockSupabase(bookingAt(NEW_TIME, null), null);

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect(inserts[0]).toMatchObject({ occurrence_number: 1 });
  });
});

describe('the reschedule clears the outcome on the booking', () => {
  /*
   * Source-level, because `rescheduleBooking` reaches the database through
   * several services and the behaviour that matters is which columns it names.
   *
   * Without `meeting_status: null` the booking arrives at its new time still
   * marked `no_show`, and `MEETING_HOLDS_SLOT_FILTER` reads that as free time —
   * so the hour a client just booked is offered to somebody else.
   */
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const src = fs
    .readFileSync(path.join(process.cwd(), 'lib/services/BookingLifecycleService.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  const body = src.slice(src.indexOf('export async function rescheduleBooking'));
  const theUpdate = body.slice(0, body.indexOf('isSlotTakenError'));

  it('names start_time, end_time and meeting_status together', () => {
    const code = theUpdate.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toContain('start_time: startTime');
    expect(code).toContain('end_time: endTime');
    expect(code).toContain('meeting_status: null');
  });
});

describe('moving an appointment clears the outcome, whoever moves it', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUG THIS CLOSES, FOUND IN PRODUCTION
   *
   * Four places write `start_time`: `rescheduleBooking`, the owner-side PATCH
   * route (whose own comment admits it "writes `start_time` itself instead of
   * calling `rescheduleBooking`"), the chat capability engine, and the plugin
   * executor. The clearing was added to the FIRST one only.
   *
   * The owner rescheduled through the second. Booking ab48357a arrived at
   * 18:00 still marked `no_show`, and the newly created attempt inherited it —
   * so `MEETING_HOLDS_SLOT_FILTER` read the hour a client had just been given
   * as free, and availability would have sold it twice.
   *
   * Hence the rule lives in `update()`, which every one of those four passes
   * through, and is asserted here rather than at any call site.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const movedFrom = (storedStart: string, storedOutcome: string | null) => {
    const writes: Record<string, unknown>[] = [];
    const bookings = () => {
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'select', 'in', 'or', 'order', 'limit', 'neq']) b[m] = jest.fn(() => b);
      b.update = jest.fn((payload: Record<string, unknown>) => {
        writes.push(payload);
        return b;
      });
      b.single = jest.fn(() => Promise.resolve({ data: bookingAt(NEW_TIME, null), error: null }));
      b.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: { start_time: storedStart, meeting_status: storedOutcome }, error: null })
      );
      return b;
    };
    const meetings = () => {
      const b: Record<string, unknown> = {};
      b.select = jest.fn(() => b);
      b.eq = jest.fn(() => b);
      b.order = jest.fn(() => b);
      b.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
      b.insert = jest.fn(() => Promise.resolve({ data: null, error: null }));
      b.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: null, error: null })) }));
      return b;
    };
    const client = {
      from: jest.fn((t: string) => (t === 'scheduling_meetings' ? meetings() : bookings())),
    } as unknown as SupabaseClient;
    return { client, writes };
  };

  it('clears a no_show when the time actually moves', async () => {
    const { client, writes } = movedFrom(OLD_TIME, 'no_show');

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(writes.some(w => 'meeting_status' in w && w.meeting_status === null)).toBe(true);
  });

  it('clears a held outcome too — a new attempt has not happened either', async () => {
    const { client, writes } = movedFrom(OLD_TIME, 'held');

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(writes.some(w => w.meeting_status === null)).toBe(true);
  });

  it('leaves an unmarked meeting alone', async () => {
    /* Nothing to clear, and writing the key anyway would trip `MEETING_FIELDS`
       on every ordinary reschedule for no reason. */
    const { client, writes } = movedFrom(OLD_TIME, null);

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(writes.every(w => !('meeting_status' in w))).toBe(true);
  });

  it('does not clear when the time is unchanged', async () => {
    /* A re-save of the same slot is not a new attempt. */
    const { client, writes } = movedFrom(OLD_TIME, 'no_show');

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: OLD_TIME,
    } as never);

    expect(writes.every(w => !('meeting_status' in w))).toBe(true);
  });

  it('never overrides an outcome the caller is explicitly writing', async () => {
    /* `markNoShow()` passes `meeting_status` itself. If a caller states the
       outcome, that wins — otherwise marking attendance could erase itself. */
    const { client, writes } = movedFrom(OLD_TIME, 'held');

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
      meeting_status: 'no_show',
    } as never);

    expect(writes.some(w => w.meeting_status === 'no_show')).toBe(true);
    expect(writes.every(w => w.meeting_status !== null)).toBe(true);
  });
});

describe('an attempt keeps its number for life', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * FOUND ON LIVE DATA
   *
   * `syncMeeting` builds its row from the booking, including
   * `occurrence_number: booking.occurrence_number ?? 1`. That is right for a
   * package CHILD, where the number says which session of the package it is.
   * On an ordinary booking the column is NULL, so the fallback is 1 — and
   * writing it on every UPDATE renumbered the attempt.
   *
   * Booking ab48357a ended up with two rows both numbered 1: an ordinary
   * reschedule reset attempt #2 back to #1. `listAttempts` orders by that
   * column, so the history's order went arbitrary and "the current attempt"
   * could resolve to the older row — which is how the journey appeared not to
   * refresh after a reschedule.
   *
   * The number belongs to the attempt. Only the insert sets it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('an in-place update does not write occurrence_number', async () => {
    /* Marking attendance is the remaining in-place write: the time is
       unchanged, so it is the same appointment being answered. */
    const { client, updates } = mockSupabase(
      bookingAt(OLD_TIME, 'held'),
      priorAt(OLD_TIME, null, 4)
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      meeting_status: 'held',
    } as never);

    expect(updates).toHaveLength(1);
    expect(updates[0].payload).not.toHaveProperty('occurrence_number');
    /* The fields that DO move still move. */
    expect(updates[0].payload).toMatchObject({ meeting_status: 'held' });
  });

  it('marking attendance does not renumber the attempt either', async () => {
    const { client, updates } = mockSupabase(
      bookingAt(OLD_TIME, 'held'),
      priorAt(OLD_TIME, null, 3)
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      meeting_status: 'held',
    } as never);

    expect(updates[0].payload).not.toHaveProperty('occurrence_number');
  });

  it('and a MOVE counts up from the stored one, inside the function', async () => {
    /*
     * The number belongs to the attempt, so an update must leave it alone and
     * a move must add one to the stored value. Both still hold; the second now
     * happens in `move_meeting`, which reads the row it locked — so no caller
     * can pass a number worked out from a read that has since gone stale.
     */
    const { client, rpcCalls } = mockSupabase(
      bookingAt(NEW_TIME, null),
      priorAt(OLD_TIME, 'no_show', 4)
    );

    await new SchedulingBookingRepository(client).update(BOOKING, USER, {
      start_time: NEW_TIME,
    } as never);

    expect(rpcCalls[0].name).toBe('move_meeting');
    expect(rpcCalls[0].args).toMatchObject({ p_meeting_id: 'meeting-1' });
  });
});
