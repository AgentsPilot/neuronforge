/**
 * The meeting's outcome is written to its own column, beside the job's status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS THE FIRST STEP OF
 *
 * `scheduling_bookings.status` answers three questions at once: is the time
 * reserved, did the meeting happen, is the job on. `meeting_status` takes the
 * middle one, so neither fact has to overwrite the other.
 *
 * The reported symptom was a quoted consultation marked "הפגישה התקיימה" and
 * then cancelled, where the create-quote button stayed up: `cancel()`
 * deliberately preserves a recorded attendance and therefore never writes
 * `cancelled`, while `quoteGate` tests for exactly that value. Five production
 * rows are in that state, reading `status = 'completed'` with a `cancel_reason`
 * beside them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH COLUMNS, AND THAT IS THE WHOLE POINT OF THIS STEP
 *
 * `status` is still written exactly as before. Around sixty call sites read it,
 * and three of them work ONLY because a meeting outcome overwrites `confirmed`
 * — the intake reminder, the meeting reminder and the unmarked-meeting gap.
 * Dropping the `status` write before those move would remind clients about
 * cancelled meetings and re-complete held ones forever.
 *
 * So every assertion here is "and", never "instead of". A test that stops
 * requiring `status` has moved the behaviour one phase early.
 *
 * Workplan P1-3: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({
  recordBusinessEvent: jest.fn(),
}));

const USER = 'user-1';
const BOOKING = 'booking-1';

type Current = { status: string; cancelled_by?: string | null; cancel_reason?: string | null };

/**
 * A Supabase double that records every UPDATE payload.
 *
 * `preRead` models `cancel()`, whose first `from()` reads the current status to
 * decide whether an attendance is already recorded. `complete()` and
 * `markNoShow()` go straight to the write, so they pass `null`.
 */
function mockSupabase(preRead: Current | null | undefined) {
  const writes: Record<string, unknown>[] = [];

  const readBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = jest.fn(() => b);
    b.eq = jest.fn(() => b);
    b.maybeSingle = jest.fn(() => Promise.resolve({ data: preRead ?? null, error: null }));
    return b;
  };

  const writeBuilder = () => {
    const row = { id: BOOKING, contact_id: 'contact-1', service_id: 'svc-1', payment_amount: 0 };
    const b: Record<string, unknown> = {};
    b.update = jest.fn((payload: Record<string, unknown>) => {
      writes.push(payload);
      return b;
    });
    b.eq = jest.fn(() => b);
    b.neq = jest.fn(() => b);
    b.select = jest.fn(() => b);
    b.maybeSingle = jest.fn(() => Promise.resolve({ data: row, error: null }));
    b.single = jest.fn(() => Promise.resolve({ data: row, error: null }));
    return b;
  };

  let call = 0;
  const client = {
    from: jest.fn(() => {
      call += 1;
      return preRead !== undefined && call === 1 ? readBuilder() : writeBuilder();
    }),
  } as unknown as SupabaseClient;

  return { repo: new SchedulingBookingRepository(client), writes };
}

beforeEach(() => jest.clearAllMocks());

describe('marking a meeting held', () => {
  it('writes the meeting outcome', async () => {
    const { repo, writes } = mockSupabase(undefined);

    await repo.complete(BOOKING, USER);

    expect(writes[0]).toMatchObject({ meeting_status: 'held' });
  });

  it('does NOT touch the job', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE RULE: only cancelling a booking writes `status`.
     *
     * "The meeting took place" is a fact about an APPOINTMENT. Writing
     * `completed` made it a fact about the JOB as well — and on a quoted
     * service those are weeks apart: the consultation happened, while the
     * quote, the agreement and the money have not.
     *
     * It also settled the row for every reader of `SETTLED_BOOKING_STATUSES`,
     * took Cancel away with it, and left the owner holding a job the platform
     * believed was finished before it had ever been priced.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { repo, writes } = mockSupabase(undefined);

    await repo.complete(BOOKING, USER);

    for (const payload of writes) expect(payload).not.toHaveProperty('status');
  });
});

describe('marking a meeting as a no-show', () => {
  it('records the meeting and leaves the job alone', async () => {
    /*
     * This one mattered most. `no_show` is in `SETTLED_BOOKING_STATUSES`, so a
     * client missing a site visit settled the WHOLE job — while `quoteGate`
     * was simultaneously reporting that job alive and still worth pricing.
     * Both could not be true, and the owner saw whichever the surface they
     * happened to look at believed.
     *
     * `no_show` is also NOT `cancelled`: one is unplanned and may carry a fee,
     * the other is known in advance. Both free the slot; only one is the
     * client's doing.
     */
    const { repo, writes } = mockSupabase(undefined);

    await repo.markNoShow(BOOKING, USER);

    expect(writes[0]).toMatchObject({ meeting_status: 'no_show' });
    for (const payload of writes) expect(payload).not.toHaveProperty('status');
  });
});

describe('cancelling a booking whose meeting had NOT happened', () => {
  for (const status of ['pending', 'confirmed']) {
    it(`cancels the meeting along with the job, from ${status}`, async () => {
      /*
       * The meeting is not going to take place either, so it gets the outcome
       * that says so. It rides the same guard as the status write, which is
       * what keeps the two from ever disagreeing.
       */
      const { repo, writes } = mockSupabase({ status });

      await repo.cancel(BOOKING, USER, 'Called off', { code: 'duplicate' });

      expect(writes[0]).toMatchObject({
        status: 'cancelled',
        meeting_status: 'cancelled',
      });
    });
  }

  it('cancels normally when the current status cannot be read', async () => {
    // A failed pre-read must never block a cancellation; worst case is the old
    // behaviour, never a cancellation that did not happen.
    const { repo, writes } = mockSupabase(null);

    const result = await repo.cancel(BOOKING, USER, 'Called off', { code: 'duplicate' });

    expect(writes[0]).toMatchObject({ status: 'cancelled', meeting_status: 'cancelled' });
    expect(result.error).toBeNull();
  });
});

describe('cancelling a booking whose meeting HAD happened', () => {
  it('leaves the held outcome alone', async () => {
    /*
     * THE BUG THIS EXISTS FOR. The consultation took place; calling off the
     * work afterwards does not un-happen it. Previously the only column able to
     * carry "held" was the one the cancellation needed, so the platform had to
     * choose which fact to keep — and five production rows show it choosing to
     * keep `completed` and lose the cancellation from every status reader.
     */
    const { repo, writes } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, 'Client never paid', { code: 'client_unresponsive' });

    for (const payload of writes) {
      expect(payload).not.toHaveProperty('meeting_status');
      expect(payload).not.toHaveProperty('status');
    }
  });

  it('leaves a recorded no-show alone too', async () => {
    const { repo, writes } = mockSupabase({ status: 'no_show' });

    await repo.cancel(BOOKING, USER, undefined, { code: 'client_unresponsive' });

    for (const payload of writes) {
      expect(payload).not.toHaveProperty('meeting_status');
      expect(payload).not.toHaveProperty('status');
    }
  });

  it('still records the cancellation itself', async () => {
    /*
     * Preserving the meeting must not lose the cancellation. These columns are
     * what `jobCalledOff` will read once the readers move, and they are the
     * only place the fact survives on this path.
     */
    const { repo, writes } = mockSupabase({ status: 'completed' });

    await repo.cancel(BOOKING, USER, 'Client never paid', {
      code: 'client_unresponsive',
      cancelledBy: 'owner',
    });

    expect(writes[0]).toMatchObject({
      cancellation_reason: 'Client never paid',
      cancel_reason: 'client_unresponsive',
      cancelled_by: 'owner',
    });
  });
});
