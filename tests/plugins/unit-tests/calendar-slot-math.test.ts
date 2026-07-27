/**
 * Pure-function unit tests for the calendar slot-math core.
 *
 * These are network-free and clock-free: `earliestBookableMs` is passed in, so
 * every assertion is deterministic. The 7 cases target where slot bugs live
 * (LEAN policy exception, justified per-case):
 *   P1 fully-free window slices to the exact count (+ non-UTC tz correctness)
 *   P2 a mid-window busy block splits the free time
 *   P3 buffer padding + re-merge of padded overlaps (CR-3)
 *   P4 min-notice floor trims the window start
 *   P5 fully-busy window → empty
 *   P6 trailing partial slot is NOT emitted (boundary off-by-one)
 *   P7 DST-transition correctness of wallClockToUtcEpoch (spring gap + fall-back)
 *
 * All times use America/New_York: EDT = UTC-4 (summer), EST = UTC-5 (winter).
 * 2026-08-03 is a Monday.
 */

import {
  computeAvailableSlots,
  wallClockToUtcEpoch,
  type ComputeAvailableSlotsInput,
} from '@/lib/server/calendar-slot-math';

const NY = 'America/New_York';

// A 2-day search window (UTC) that fully contains Monday 2026-08-03 in NY.
const RANGE_START = Date.parse('2026-08-03T00:00:00Z');
const RANGE_END = Date.parse('2026-08-05T00:00:00Z');

const MIN = 60000;

// Base input with everything "off" — individual tests override fields.
function baseInput(overrides: Partial<ComputeAvailableSlotsInput> = {}): ComputeAvailableSlotsInput {
  return {
    rangeStartMs: RANGE_START,
    rangeEndMs: RANGE_END,
    busyIntervals: [],
    workingHours: {
      timeZone: NY,
      windows: [{ days: ['monday'], start: '09:00', end: '11:00' }],
    },
    slotDurationMs: 30 * MIN,
    bufferMs: 0,
    // Floor in the far past so it never trims (clock-free determinism).
    earliestBookableMs: 0,
    maxSlots: 500,
    ...overrides,
  };
}

describe('calendar-slot-math (pure)', () => {
  it('P1: slices a fully-free window into the exact count and resolves a non-UTC tz correctly', () => {
    // Monday 09:00–11:00 EDT = 13:00–15:00Z, 30-min slots → exactly 4, no partial.
    const slots = computeAvailableSlots(baseInput());

    expect(slots).toHaveLength(4);
    // tz correctness: 09:00 EDT (UTC-4) === 13:00Z.
    expect(slots[0]).toEqual({
      start: '2026-08-03T13:00:00.000Z',
      end: '2026-08-03T13:30:00.000Z',
    });
    expect(slots[3]).toEqual({
      start: '2026-08-03T14:30:00.000Z',
      end: '2026-08-03T15:00:00.000Z',
    });
  });

  it('P2: a mid-window busy block splits the free time into two runs', () => {
    // Window 09:00–12:00 EDT = 13:00–16:00Z; busy 10:00–10:30 EDT = 14:00–14:30Z.
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: { timeZone: NY, windows: [{ days: ['monday'], start: '09:00', end: '12:00' }] },
        busyIntervals: [
          { startMs: Date.parse('2026-08-03T14:00:00Z'), endMs: Date.parse('2026-08-03T14:30:00Z') },
        ],
      }),
    );

    // Left run 13:00–14:00 → 2 slots; right run 14:30–16:00 → 3 slots.
    expect(slots).toHaveLength(5);
    // No slot overlaps the busy block 14:00–14:30Z.
    for (const s of slots) {
      const start = Date.parse(s.start);
      const end = Date.parse(s.end);
      const overlaps = start < Date.parse('2026-08-03T14:30:00Z') && end > Date.parse('2026-08-03T14:00:00Z');
      expect(overlaps).toBe(false);
    }
    expect(slots[0].start).toBe('2026-08-03T13:00:00.000Z');
    expect(slots[2].start).toBe('2026-08-03T14:30:00.000Z');
  });

  it('P3: buffer padding is applied on both sides and padded overlaps are re-merged (CR-3)', () => {
    // Window 09:00–12:00 EDT = 13:00–16:00Z. Two busy blocks:
    //   14:00–14:30Z and 15:00–15:30Z. Buffer 20m pads them to
    //   13:40–14:50Z and 14:40–15:50Z, which OVERLAP → re-merge to 13:40–15:50Z.
    // Free: 13:00–13:40 (1 slot at 13:00) and 15:50–16:00 (0 slots).
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: { timeZone: NY, windows: [{ days: ['monday'], start: '09:00', end: '12:00' }] },
        busyIntervals: [
          { startMs: Date.parse('2026-08-03T14:00:00Z'), endMs: Date.parse('2026-08-03T14:30:00Z') },
          { startMs: Date.parse('2026-08-03T15:00:00Z'), endMs: Date.parse('2026-08-03T15:30:00Z') },
        ],
        bufferMs: 20 * MIN,
      }),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual({
      start: '2026-08-03T13:00:00.000Z',
      end: '2026-08-03T13:30:00.000Z',
    });
  });

  it('P4: the min-notice floor trims a straddling window start', () => {
    // Window 09:00–11:00 EDT = 13:00–15:00Z. Floor at 13:45Z.
    // Free 13:45–15:00 (75m) → slots 13:45 and 14:15; 14:45+30=15:15 > 15:00 dropped.
    const slots = computeAvailableSlots(
      baseInput({ earliestBookableMs: Date.parse('2026-08-03T13:45:00Z') }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0].start).toBe('2026-08-03T13:45:00.000Z');
    expect(slots[1].start).toBe('2026-08-03T14:15:00.000Z');
  });

  it('P5: a fully-busy window yields an empty result without throwing', () => {
    const slots = computeAvailableSlots(
      baseInput({
        busyIntervals: [
          { startMs: Date.parse('2026-08-03T13:00:00Z'), endMs: Date.parse('2026-08-03T15:00:00Z') },
        ],
      }),
    );
    expect(slots).toEqual([]);
  });

  it('P6: the trailing partial slot at the boundary is NOT emitted', () => {
    // Window 09:00–10:50 EDT = 13:00–14:50Z (110 min). 30-min slots:
    // 13:00, 13:30, 14:00 fit; 14:30+30=15:00 > 14:50 → dropped. Exactly 3.
    const slots = computeAvailableSlots(
      baseInput({
        workingHours: { timeZone: NY, windows: [{ days: ['monday'], start: '09:00', end: '10:50' }] },
      }),
    );

    expect(slots).toHaveLength(3);
    expect(slots[slots.length - 1]).toEqual({
      start: '2026-08-03T14:00:00.000Z',
      end: '2026-08-03T14:30:00.000Z',
    });
    // The 14:30–15:00Z slot would exceed the 14:50Z boundary — assert it is absent.
    expect(slots.some((s) => s.start === '2026-08-03T14:30:00.000Z')).toBe(false);
  });

  describe('P7: wallClockToUtcEpoch DST-transition policy', () => {
    it('spring-forward gap: a nonexistent local time shifts FORWARD to the next valid instant', () => {
      // NY 2026-03-08: 02:00 EST → 03:00 EDT. 02:30 does not exist.
      // Policy: shift forward. Pre-transition offset (-5) → 02:30 + 5h = 07:30Z
      // which reads as 03:30 EDT — the forward-shifted valid instant.
      const utc = wallClockToUtcEpoch(2026, 3, 8, 2, 30, NY);
      expect(new Date(utc).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it('fall-back overlap: an ambiguous local time picks the EARLIER offset', () => {
      // NY 2026-11-01: 02:00 EDT → 01:00 EST. 01:30 occurs twice.
      // Policy: earlier offset = EDT (-4) → 01:30 + 4h = 05:30Z.
      const utc = wallClockToUtcEpoch(2026, 11, 1, 1, 30, NY);
      expect(new Date(utc).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    });

    it('a normal (non-transition) local time converts with the standing offset', () => {
      // Winter EST (-5): 09:00 EST = 14:00Z.
      const winter = wallClockToUtcEpoch(2026, 1, 12, 9, 0, NY);
      expect(new Date(winter).toISOString()).toBe('2026-01-12T14:00:00.000Z');
      // Summer EDT (-4): 09:00 EDT = 13:00Z.
      const summer = wallClockToUtcEpoch(2026, 8, 3, 9, 0, NY);
      expect(new Date(summer).toISOString()).toBe('2026-08-03T13:00:00.000Z');
    });
  });
});
