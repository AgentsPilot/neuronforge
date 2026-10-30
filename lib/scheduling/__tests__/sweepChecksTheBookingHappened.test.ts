/**
 * The sweeper must not call a finished journey abandoned.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `convertAttempt` has two callers, both inside `materialiseAttempt` — the card
 * finalise and the Stripe webhook. Every other way of completing a booking
 * leaves the attempt reading `started`, and the sweeper used to mark anything
 * still `started` past the window as abandoned without looking.
 *
 * Measured 2026-10-29: 8 of the 14 rows reading `abandoned` had a booking for
 * the same service and slot made inside the attempt's own 30-minute window.
 * Each one was a client who had already bought and was then chased by a
 * recovery email, and each one inflated any count of lost business.
 *
 * The window is the whole distinction. A booking inside it is this journey
 * finishing by another route; one an hour later is somebody who gave up and
 * came back, which IS an abandonment and must still be swept.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const updates: { table: string; values: Record<string, unknown> }[] = [];
let attempts: Record<string, unknown>[] = [];
let bookings: Record<string, unknown>[] = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const chain: Record<string, unknown> = {
        _rows: table === 'abandoned_bookings' ? () => attempts : () => bookings,
        _update: null as Record<string, unknown> | null,
        select() {
          return chain;
        },
        update(values: Record<string, unknown>) {
          chain._update = values;
          updates.push({ table, values });
          return chain;
        },
        eq: () => chain,
        lt: () => chain,
        gte: () => chain,
        in: () => chain,
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          /* A write answers the rows it claims to have touched; a read answers
             the fixture. Enough for what this file asserts. */
          const data = chain._update ? [{ id: 'written' }] : (chain._rows as () => unknown[])();
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
  },
}));

import { sweepAbandoned, ATTEMPT_WINDOW_MINUTES } from '@/lib/scheduling/abandonedBookings';

const NOW = new Date('2026-10-29T12:00:00.000Z');
/** Older than the window, so the sweeper considers it at all. */
const OPENED = new Date('2026-10-29T11:00:00.000Z').toISOString();

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'attempt-1',
  user_id: 'owner-1',
  service_id: 'svc-1',
  start_time: '2026-11-02T09:00:00.000Z',
  created_at: OPENED,
  ...over,
});

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'booking-1',
  service_id: 'svc-1',
  start_time: '2026-11-02T09:00:00.000Z',
  created_at: OPENED,
  ...over,
});

beforeEach(() => {
  updates.length = 0;
  attempts = [];
  bookings = [];
});

describe('an attempt whose booking exists is not abandoned', () => {
  it('is marked converted, not abandoned', async () => {
    attempts = [attempt()];
    bookings = [booking()];

    const swept = await sweepAbandoned(NOW);

    expect(swept).toBe(0);
    expect(updates.map(u => u.values.status)).toContain('converted');
    expect(updates.map(u => u.values.status)).not.toContain('abandoned');
  });

  it('and is pointed at the booking it became', async () => {
    attempts = [attempt()];
    bookings = [booking({ id: 'the-real-booking' })];

    await sweepAbandoned(NOW);

    const converted = updates.find(u => u.values.status === 'converted');
    /* Not merely skipped: a row left `started` for ever is the dead state
       `theAttemptReachesAnEnding.guard` exists to prevent. */
    expect(converted?.values.booking_id).toBe('the-real-booking');
  });
});

describe('an attempt that really was abandoned is still swept', () => {
  it('when the same slot was booked long after the window closed', async () => {
    const wellAfter = new Date(
      new Date(OPENED).getTime() + (ATTEMPT_WINDOW_MINUTES + 120) * 60 * 1000
    ).toISOString();

    attempts = [attempt()];
    bookings = [booking({ created_at: wellAfter })];

    const swept = await sweepAbandoned(NOW);

    /* Gave up, came back later. That is an abandonment and the recovery email
       for it was the thing that brought them back. */
    expect(swept).toBe(1);
    expect(updates.map(u => u.values.status)).toContain('abandoned');
  });

  it('when no booking was ever made', async () => {
    attempts = [attempt()];
    bookings = [];

    expect(await sweepAbandoned(NOW)).toBe(1);
    expect(updates.map(u => u.values.status)).toContain('abandoned');
  });

  it('when a different service was booked in the window', async () => {
    attempts = [attempt()];
    bookings = [booking({ service_id: 'svc-OTHER' })];

    expect(await sweepAbandoned(NOW)).toBe(1);
  });

  it('when the same service was booked for a different slot', async () => {
    attempts = [attempt()];
    bookings = [booking({ start_time: '2026-12-25T09:00:00.000Z' })];

    expect(await sweepAbandoned(NOW)).toBe(1);
  });
});

describe('nothing to sweep', () => {
  it('writes nothing when there are no candidates', async () => {
    attempts = [];

    expect(await sweepAbandoned(NOW)).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
