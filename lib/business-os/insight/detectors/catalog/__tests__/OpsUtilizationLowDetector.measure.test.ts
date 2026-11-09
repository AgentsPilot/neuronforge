/**
 * The calendar percentage has to come from the calendar.
 *
 * This detector read `derived_metrics['operations.calendar_utilization']`, a
 * metric defined over the event `calendar.slot_filled` that NOTHING emits — so
 * every row of it is `value: 0, sampleSize: 0`, and zero is permanently below
 * the 50% threshold. It never measured a calendar. It reported a fabricated
 * zero and told owners "100% of your time stays empty" while they had
 * appointments booked.
 *
 * Its baseline fell back to a hardcoded 50 and its denominator to a hardcoded
 * 40-hour week, so all three numbers on the card were invented.
 */

import { OpsUtilizationLowDetector } from '../OpsUtilizationLowDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  BusinessProfileRepository: class {
    constructor(private _c: unknown) {}
    async findByUserId() { return { data: (global as never as { __profile: unknown }).__profile, error: null }; }
  },
}));

type Booking = { start_time: string; end_time: string; status: string };

/** Two 9-5 days a week = 16h available. */
const TWO_DAYS = {
  monday: [{ start: '09:00', end: '17:00' }],
  tuesday: [{ start: '09:00', end: '17:00' }],
};

function setProfile(availability: unknown) {
  (global as never as { __profile: unknown }).__profile =
    availability === undefined ? null : { scheduling_availability: availability };
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TABLES NOW, SO THE FAKE HAS TO KNOW WHICH ONE IT IS ANSWERING.
 *
 * The detector stopped summing `scheduling_bookings` ranged on `start_time` —
 * a job whose hours live on its sessions has no `start_time`, so every package
 * session counted as zero booked hours and a full diary reported as an empty
 * one. It asks `appointmentDetailsBetween` now, which reads the meetings and
 * then adds the bookings that have an hour and NO meeting row.
 *
 * So this returns the test's rows as that second kind: real appointments with
 * no meeting row, which is exactly what a booking written before the meetings
 * table is. Answering both reads with the same array would count every hour
 * twice.
 *
 * `or` and `lt` join the chain because the new read uses them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function mockSupabase(bookings: Booking[], error: Error | null = null) {
  return {
    from(table: string) {
      const rows =
        table === 'scheduling_meetings'
          ? []
          : bookings.map(b => ({ ...b, scheduling_meetings: [] }));

      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: Error | null }) => unknown) =>
          resolve({ data: error ? null : rows, error }),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'or', 'order', 'limit'])
        chain[m] = () => chain;
      return chain;
    },
  };
}

/** `hours` of booking, starting yesterday. */
function booked(hours: number, status = 'confirmed'): Booking {
  const start = new Date(Date.now() - 86_400_000);
  return {
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + hours * 3_600_000).toISOString(),
    status,
  };
}

function measure(bookings: Booking[], error: Error | null = null) {
  const d = new OpsUtilizationLowDetector(mockSupabase(bookings, error) as never);
  return (d as unknown as {
    measureUtilisation: (u: string) => Promise<{ utilisationPercent: number; bookedHours: number; availableHours: number } | null>;
  }).measureUtilisation('user-1');
}

describe('measureUtilisation', () => {
  it('divides booked hours by the hours the owner said they work', async () => {
    setProfile(TWO_DAYS);
    // 16h/week × 4 weeks = 64h available; 16h booked = 25%.
    const result = await measure([booked(8), booked(8)]);

    expect(result!.availableHours).toBeCloseTo(64, 5);
    expect(result!.bookedHours).toBeCloseTo(16, 5);
    expect(result!.utilisationPercent).toBeCloseTo(25, 5);
  });

  it('says nothing at all when the owner has not given their hours', async () => {
    /*
     * The important one. `calculateAvailableHours` answers 40 for missing
     * input, which as a denominator turns "we do not know your hours" into
     * "you are 8% full" — a measurement of nothing.
     */
    setProfile(undefined);

    expect(await measure([booked(8)])).toBeNull();
  });

  it('says nothing for availability that parses to no hours', async () => {
    setProfile({ monday: [], tuesday: [] });

    expect(await measure([booked(8)])).toBeNull();
  });

  it('does not count a cancellation as a filled slot', async () => {
    /*
     * The flattering direction, which is the one to be careful about: a
     * cancelled appointment freed the time.
     *
     * The rule used to live in the QUERY — `.in('status', OCCUPIES_A_SLOT)` —
     * and this mock proved it by returning only what the query asked for. The
     * detector reads appointments now, so the rule moved into
     * `occupiesItsHour`: an appointment holds its hour unless somebody said it
     * did not happen. The mock therefore hands over BOTH and the assertion is
     * that only the live one was counted, which tests the rule rather than
     * where it is written.
     */
    setProfile(TWO_DAYS);
    const d = new OpsUtilizationLowDetector(
      mockSupabase([booked(8, 'confirmed'), booked(5, 'cancelled'), booked(3, 'no_show')]) as never
    );

    const result = await (d as unknown as {
      measureUtilisation: (u: string) => Promise<{ bookedHours: number } | null>;
    }).measureUtilisation('user-1');

    expect(result!.bookedHours).toBeCloseTo(8, 5);
  });

  it('never reports more than a full calendar', async () => {
    setProfile(TWO_DAYS);
    const result = await measure(Array.from({ length: 20 }, () => booked(8)));

    expect(result!.utilisationPercent).toBe(100);
  });

  it('says nothing rather than guessing when the calendar cannot be read', async () => {
    setProfile(TWO_DAYS);

    expect(await measure([], new Error('unreadable'))).toBeNull();
  });
});
