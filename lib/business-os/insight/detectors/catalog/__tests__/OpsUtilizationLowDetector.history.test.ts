/**
 * A new calendar is empty. That is what new means.
 *
 * This detector told a business six days old that its 32 free slots were
 * "critical for your business", which is its situation described back to it as
 * a failure. Two gates were supposed to stop that and neither did:
 *
 *   minSamples: 28    declared on the definition since it was written, and read
 *                     by nothing — `evaluate` never consulted it
 *
 *   the ops vector    the only gate that ran, and it lights at
 *                     `total_bookings >= 1`, so one booking was enough for the
 *                     platform to start judging the other 39 hours of the week
 *
 * The rule now: enough days taking bookings AND enough bookings, counted from
 * the first booking rather than from signup — the same reasoning
 * `VECTOR_THRESHOLDS.ret` already gives about retention needing history before
 * a rate is a rate.
 */

import { OpsUtilizationLowDetector } from '../OpsUtilizationLowDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;

/** `n` bookings, the oldest `daysAgo` old. */
function bookings(n: number, daysAgo: number) {
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(Date.now() - (daysAgo - i) * DAY).toISOString(),
  }));
}

function mockSupabase(rows: { created_at: string }[] | null, error: Error | null = null) {
  return {
    from() {
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: Error | null }) => unknown) =>
          resolve({ data: rows, error }),
      };
      for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'in']) chain[m] = () => chain;
      return chain;
    },
  };
}

/** The gate is private; whether it lets `evaluate` past is the behaviour. */
function gate(rows: { created_at: string }[] | null, error: Error | null = null): Promise<boolean> {
  const detector = new OpsUtilizationLowDetector(mockSupabase(rows, error) as never);
  return (detector as unknown as {
    calendarHasHistory: (userId: string) => Promise<boolean>;
  }).calendarHasHistory('user-1');
}

describe('when an empty calendar is worth remarking on', () => {
  it('says nothing to a business that started taking bookings this week', () => {
    // The reported case: a few bookings, a few days old, 32 slots free.
    return expect(gate(bookings(3, 5))).resolves.toBe(false);
  });

  it('says nothing after four weeks on the strength of one booking', () => {
    // Time alone is not a rate. One booking in a month is a different finding
    // and not this one.
    return expect(gate(bookings(1, 40))).resolves.toBe(false);
  });

  it('says nothing about twenty bookings taken in three days', () => {
    // Volume alone is not a rate either: this is a calendar still filling.
    return expect(gate(bookings(20, 3))).resolves.toBe(false);
  });

  it('speaks once there are both enough days and enough bookings', () => {
    return expect(gate(bookings(10, 40))).resolves.toBe(true);
  });

  it('holds the line exactly at four weeks', () => {
    return expect(gate(bookings(10, 27))).resolves.toBe(false);
  });

  it('says nothing when the calendar cannot be read', () => {
    // Failing towards silence: an unreadable history cannot show this is worth
    // saying, so it is not said.
    return expect(gate(null, new Error('unreadable'))).resolves.toBe(false);
  });

  it('says nothing to a business with no bookings at all', () => {
    return expect(gate([])).resolves.toBe(false);
  });
});
