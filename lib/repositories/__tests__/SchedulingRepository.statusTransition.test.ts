/**
 * A status event fires once per transition, even under concurrency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUND IN LIVE DATA, 2026-10-06, while checking the event rail for duplicates:
 *
 *   booking.completed  x3   20:30:49.832, .879, 20:30:50.525   (0.7 seconds)
 *   booking.cancelled  x5   09-29, 09-30 x2, 10-02 x2
 *
 * `update()` read the status in one query and compared it after writing in
 * another. Three concurrent callers all read `confirmed`, all saw
 * `confirmed !== 'completed'`, and all three emitted. The comment above the
 * pre-read stated the intent correctly -- "fires on a transition rather than on
 * every save" -- and a non-atomic check cannot deliver it.
 *
 * The write is now its own test: `.neq('status', target)` matches only a row
 * whose status differs, and in READ COMMITTED Postgres re-evaluates that
 * predicate after taking the row lock, so the first caller to commit makes
 * every caller behind it match zero rows. A returned row IS the transition.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { SchedulingBookingRepository } from '../SchedulingRepository';

const BOOKING = '0cdb9125-b632-4ea8-acb1-eeee1d6323ee';
const USER = '08456106-aa50-4810-b12c-7ca84102da31';

const emitted: { eventType: string; entityId: string }[] = [];
jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({
  recordBusinessEvent: (_userId: string, params: { eventType: string; entityId: string }) => {
    emitted.push({ eventType: params.eventType, entityId: params.entityId });
  },
}));

/**
 * A Supabase stand-in whose UPDATE honours `.neq('status', x)` the way Postgres
 * does: the row's CURRENT status is consulted at write time, not at read time.
 */
function mockSupabase(startingStatus: string) {
  let current = startingStatus;
  const attempts: { neq?: string; matched: boolean }[] = [];

  const client = {
    from: () => {
      let neqStatus: string | undefined;
      let payload: Record<string, unknown> = {};

      const builder: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => { payload = p; return builder; },
        eq: () => builder,
        neq: (_col: string, value: string) => { neqStatus = value; return builder; },
        select: () => builder,
        // Resolved at the moment the query runs, which is the point.
        maybeSingle: async () => {
          const matched = current !== neqStatus;
          attempts.push({ neq: neqStatus, matched });
          if (!matched) return { data: null, error: null };
          current = String(payload.status ?? current);
          return { data: { id: BOOKING, status: current, contact: null }, error: null };
        },
        single: async () => {
          attempts.push({ neq: undefined, matched: true });
          current = String(payload.status ?? current);
          return { data: { id: BOOKING, status: current, contact: null }, error: null };
        },
      };
      return builder;
    },
  };

  return { client, attempts, status: () => current };
}

beforeEach(() => { emitted.length = 0; });

describe('a real transition', () => {
  it('emits exactly once', async () => {
    const { client } = mockSupabase('confirmed');
    const repo = new SchedulingBookingRepository(client as never);

    const result = await repo.update(BOOKING, USER, { status: 'cancelled' } as never);

    expect(result.error).toBeNull();
    expect(emitted).toEqual([{ eventType: 'booking.cancelled', entityId: BOOKING }]);
  });

  it('still returns the booking to the caller', async () => {
    // Functionality first: the event is a side note, the update is the job.
    const { client } = mockSupabase('confirmed');
    const repo = new SchedulingBookingRepository(client as never);

    const result = await repo.update(BOOKING, USER, { status: 'completed' } as never);

    expect(result.data).toMatchObject({ id: BOOKING });
  });
});

describe('the race that produced the duplicates', () => {
  it('emits once when three callers set the same status at the same time', async () => {
    /*
     * The live incident. All three start from `confirmed`; only the one that
     * wins the row matches `.neq`, and the other two fall through to the plain
     * update, which writes the fields and emits nothing.
     */
    const { client } = mockSupabase('confirmed');
    const repo = new SchedulingBookingRepository(client as never);

    await Promise.all([
      repo.update(BOOKING, USER, { status: 'completed' } as never),
      repo.update(BOOKING, USER, { status: 'completed' } as never),
      repo.update(BOOKING, USER, { status: 'completed' } as never),
    ]);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].eventType).toBe('booking.completed');
  });

  it('emits nothing when the status is re-saved as it already is', async () => {
    // The four-days-apart case: the same status written again is not news.
    const { client } = mockSupabase('cancelled');
    const repo = new SchedulingBookingRepository(client as never);

    await repo.update(BOOKING, USER, { status: 'cancelled' } as never);

    expect(emitted).toEqual([]);
  });
});

describe('what must keep working', () => {
  it('writes the other fields even when the status did not move', async () => {
    /*
     * The fallback arm exists for this. Making the whole update conditional
     * would silently drop a note or a price alongside a no-op status.
     */
    const { client, status } = mockSupabase('cancelled');
    const repo = new SchedulingBookingRepository(client as never);

    const result = await repo.update(
      BOOKING,
      USER,
      { status: 'cancelled', internal_notes: 'client called' } as never
    );

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ id: BOOKING });
    expect(status()).toBe('cancelled');
    expect(emitted).toEqual([]);
  });

  it('takes one query, not two, for an ordinary update', async () => {
    /*
     * A non-status update must not pay for the claim. It also must not pay for
     * the pre-read this replaced, which ran on every evented write.
     */
    const { client, attempts } = mockSupabase('confirmed');
    const repo = new SchedulingBookingRepository(client as never);

    await repo.update(BOOKING, USER, { internal_notes: 'rescheduled by phone' } as never);

    expect(attempts).toHaveLength(1);
    expect(attempts[0].neq).toBeUndefined();
    expect(emitted).toEqual([]);
  });

  it('does not claim on a status nobody records an event for', async () => {
    // `confirmed` is a real status with no event in the taxonomy's evented set.
    const { client, attempts } = mockSupabase('pending');
    const repo = new SchedulingBookingRepository(client as never);

    await repo.update(BOOKING, USER, { status: 'confirmed' } as never);

    expect(attempts).toHaveLength(1);
    expect(emitted).toEqual([]);
  });

  it('re-emits a genuine second transition', async () => {
    /*
     * cancelled -> confirmed -> cancelled is two cancellations and must read as
     * two. The fix suppresses duplicates, not history.
     */
    const { client } = mockSupabase('confirmed');
    const repo = new SchedulingBookingRepository(client as never);

    await repo.update(BOOKING, USER, { status: 'cancelled' } as never);
    await repo.update(BOOKING, USER, { status: 'confirmed' } as never);
    await repo.update(BOOKING, USER, { status: 'cancelled' } as never);

    expect(emitted.map(e => e.eventType)).toEqual(['booking.cancelled', 'booking.cancelled']);
  });
});
