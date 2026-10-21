/**
 * Cancelling a job does not un-hold the meeting it was quoted from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `scheduling_bookings.status` is asked to hold two facts: what happened to the
 * APPOINTMENT, and what happened to the JOB. For most bookings they are the
 * same fact and one column is enough.
 *
 * A quoted job is where they come apart. The consultation is held, the owner
 * marks it so — `completed` — the quote then goes unpaid, and the owner cancels.
 * There is no `completed_at` column anywhere on the table, so writing
 * `cancelled` here did not HIDE that the meeting happened, it erased it. The
 * reported symptom was the client journey titling a meeting the owner had sat
 * through:
 *
 *     הזמנה בוטלה
 *     יום שלישי, 20 באוק׳ 2026 · 12:00 – 13:00 · 1 ש׳
 *     בוטלה
 *
 * Booking f4944490 on that date carries `status: 'cancelled'` and no
 * `booking_completed` activity, so for that one row the fact is gone and there
 * is nothing to recover it from. This is what stops the next one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE EVENT STILL FIRES
 *
 * `update()` emits `booking.cancelled` only when its conditional status write
 * claims the transition — that is what stops three concurrent callers emitting
 * three events. Omitting `status` therefore also withholds the event, and
 * `CashCancelledUnrefundedDetector` and the `booking_cancelled` gap are what
 * read it. A job stopped with the client's money still held is exactly what
 * that detector is for, so the preserved-status path has to emit for itself.
 *
 * The two halves below are one guarantee: the column answers "what happened to
 * the appointment", the event records "a cancellation happened", and both are
 * true at the same time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { recordBusinessEvent } from '@/lib/business-os/insight/events/recordEvent';

jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({
  recordBusinessEvent: jest.fn(),
}));

const USER = 'user-1';
const BOOKING = 'booking-1';

type Current = {
  status: string;
  /* The meeting's own answer, which `cancel()` must not overwrite once one
     exists — see "a meeting already called off". */
  meeting_status?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
};

/**
 * A Supabase double. The FIRST `from()` answers `cancel()`'s status pre-read;
 * every `from()` after it is an UPDATE, and each one records the payload it was
 * given plus whether it carried the `.neq()` that makes a write conditional.
 *
 * `claimed` is what the conditional UPDATE would match. False models the row
 * already being at the target status — the path that returns no row and so
 * emits no event.
 */
function mockSupabase(current: Current | null, claimed = true) {
  const writes: { payload: Record<string, unknown>; conditional: boolean }[] = [];

  const readBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = jest.fn(() => b);
    b.eq = jest.fn(() => b);
    b.maybeSingle = jest.fn(() => Promise.resolve({ data: current, error: null }));
    return b;
  };

  const writeBuilder = () => {
    const entry = { payload: {} as Record<string, unknown>, conditional: false };
    const row = { id: BOOKING, contact_id: 'contact-1', payment_amount: 400, service_id: 'svc-1' };
    const b: Record<string, unknown> = {};
    b.update = jest.fn((payload: Record<string, unknown>) => {
      entry.payload = payload;
      writes.push(entry);
      return b;
    });
    b.eq = jest.fn(() => b);
    b.neq = jest.fn(() => {
      entry.conditional = true;
      return b;
    });
    b.select = jest.fn(() => b);
    // The conditional write matches nothing when `claimed` is false.
    b.maybeSingle = jest.fn(() =>
      Promise.resolve({ data: entry.conditional && !claimed ? null : row, error: null })
    );
    b.single = jest.fn(() => Promise.resolve({ data: row, error: null }));
    return b;
  };

  let call = 0;
  const client = {
    from: jest.fn(() => {
      call += 1;
      return call === 1 ? readBuilder() : writeBuilder();
    }),
  } as unknown as SupabaseClient;

  return { repo: new SchedulingBookingRepository(client), writes };
}

const emitted = () => (recordBusinessEvent as jest.Mock).mock.calls.map(c => c[1].eventType);

beforeEach(() => jest.clearAllMocks());

describe('a meeting already called off', () => {
  /*
   * Stopping the JOB afterwards is a second, later event. It writes the
   * booking's own cancellation fields, and it must leave the MEETING's answer
   * alone: `outcome_by` and `outcome_at` record who called the appointment off
   * and when, and restamping them puts the moment the work stopped onto the
   * appointment's row.
   *
   * Measured on a real booking: the meeting was called off at 01:55 and the
   * job stopped later, after which the journey read "you cancelled the meeting"
   * at the LATER time. The half hour in which the appointment was off and the
   * work was not had disappeared.
   */
  it('keeps the moment its own cancellation was recorded', async () => {
    const { repo, writes } = mockSupabase({ status: 'confirmed', meeting_status: 'cancelled' });

    await repo.cancel(BOOKING, USER, 'Not going ahead', {
      code: 'client_unresponsive',
      cancelledBy: 'owner',
    });

    const payload = writes[0].payload;
    /* The JOB still stops — this is not the `held` guard, which also withholds
       the status. */
    expect(payload.status).toBe('cancelled');
    expect(payload.cancelled_by).toBe('owner');
    /* But the meeting's answer is not restamped. */
    expect(payload).not.toHaveProperty('outcome_at');
    expect(payload).not.toHaveProperty('outcome_by');
  });

  it('while a meeting nobody answered for still gets one', async () => {
    /* The ordinary case, and the reason the stamp exists at all: an
       appointment with no outcome is called off by the job going off, and
       somebody has to be recorded as having done it. */
    const { repo, writes } = mockSupabase({ status: 'confirmed', meeting_status: null });

    await repo.cancel(BOOKING, USER, 'Not going ahead', {
      code: 'client_unresponsive',
      cancelledBy: 'client',
    });

    const payload = writes[0].payload;
    expect(payload.meeting_status).toBe('cancelled');
    expect(payload.outcome_by).toBe('client');
    expect(payload.outcome_at).toEqual(expect.any(String));
  });
});

describe('a meeting that was held', () => {
  it('is not rewritten to cancelled', async () => {
    const { repo, writes } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, 'Client never paid', {
      code: 'client_unresponsive',
      cancelledBy: 'owner',
    });

    for (const write of writes) {
      expect(write.payload).not.toHaveProperty('status');
    }
  });

  it('still records why, who, and the prose reason', async () => {
    /*
     * The point of preserving the status is not to forget the cancellation.
     * Every column a report or a detector unions on has to still be written, or
     * this trades a wrong label for a missing record.
     */
    const { repo, writes } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, 'Client never paid', {
      code: 'client_unresponsive',
      note: '  chased twice  ',
      cancelledBy: 'owner',
    });

    expect(writes[0].payload).toMatchObject({
      cancellation_reason: 'Client never paid',
      cancel_reason: 'client_unresponsive',
      cancel_note: 'chased twice',
      cancelled_by: 'owner',
    });
  });

  it('emits booking.cancelled even though the column did not move', async () => {
    const { repo } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    expect(emitted()).toEqual(['booking.cancelled']);
  });

  it('emits it once, not once per write', async () => {
    const { repo } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    expect(emitted()).toHaveLength(1);
  });
});

describe('a no-show is an answer too', () => {
  it('is preserved the same way', async () => {
    /*
     * "They did not turn up" is as much a recorded fact as "it was held", and
     * the owner cancelling the job afterwards does not make them turn up.
     */
    const { repo, writes } = mockSupabase({ status: 'no_show' });

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    for (const write of writes) {
      expect(write.payload).not.toHaveProperty('status');
    }
    expect(emitted()).toEqual(['booking.cancelled']);
  });
});

describe('a booking with no attendance answer', () => {
  for (const status of ['pending', 'confirmed']) {
    it(`is cancelled exactly as before, from ${status}`, async () => {
      const { repo, writes } = mockSupabase({ status });

      await repo.cancel(BOOKING, USER, 'Called off', { code: 'client_unresponsive' });

      expect(writes[0].payload).toMatchObject({ status: 'cancelled' });
    });

    it(`still claims the transition conditionally, from ${status}`, async () => {
      /*
       * The `.neq('status', …)` on the status write is the whole concurrency
       * guarantee — live data had `booking.cancelled` five times for one
       * booking before it existed. Preserving a held status must not have
       * quietly moved the ordinary path off it.
       */
      const { repo, writes } = mockSupabase({ status });

      await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

      expect(writes[0].conditional).toBe(true);
    });

    it(`emits once, from update(), from ${status}`, async () => {
      const { repo } = mockSupabase({ status });

      await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

      expect(emitted()).toEqual(['booking.cancelled']);
    });
  }

  it('does not emit when the row was already cancelled', async () => {
    /* The loser of the race: the conditional write matches nothing. */
    const { repo } = mockSupabase({ status: 'cancelled' }, false);

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    expect(emitted()).toEqual([]);
  });
});

describe('cancelling a held booking twice', () => {
  it('does not emit a second event', async () => {
    /*
     * The preserved-status path cannot use a conditional write to claim the
     * transition — there is no status change to condition on — so it reads
     * whether a cancellation is already recorded instead.
     */
    const { repo } = mockSupabase({
      status: 'completed',
      cancelled_by: 'owner',
      cancel_reason: 'client_unresponsive',
    });

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    expect(emitted()).toEqual([]);
  });

  it('still writes the new reason over the old one', async () => {
    const { repo, writes } = mockSupabase({
      status: 'completed',
      cancelled_by: 'owner',
      cancel_reason: 'client_unresponsive',
    });

    await repo.cancel(BOOKING, USER, undefined, { code: 'duplicate', cancelledBy: 'client' });

    expect(writes[0].payload).toMatchObject({ cancel_reason: 'duplicate', cancelled_by: 'client' });
  });
});

describe('the pre-read is not allowed to block a cancellation', () => {
  it('cancels normally when the status cannot be read', async () => {
    /*
     * A read that comes back empty leaves `attendanceRecorded` false, so the
     * status is written exactly as it was before this change existed. The worst
     * case is the old behaviour, never a cancellation that did not happen.
     */
    const { repo, writes } = mockSupabase(null);

    const result = await repo.cancel(BOOKING, USER, 'Called off', { code: 'duplicate' });

    expect(writes[0].payload).toMatchObject({ status: 'cancelled' });
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  });
});
