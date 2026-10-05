/**
 * The condition none of the other tests create: the machine running the code
 * is in a DIFFERENT zone from the business.
 *
 * Every timezone bug found in this area was invisible under `TZ=UTC` against a
 * UTC business, which is exactly how CI and Vercel run. `new Date('...T09:00')`
 * is correct there and wrong everywhere else, so a suite that never moves the
 * clock cannot tell the two apart. These pin the helpers that the booking
 * surfaces depend on, with the process clock deliberately set somewhere else.
 *
 * If one of these fails, a wall clock has started being read on the machine's
 * calendar again.
 */

import {
  fromBusinessLocalInput,
  toBusinessLocalInput,
  businessDateKey,
  businessInstant,
  businessClock,
  shiftBusinessDateKey,
  endOfBusinessLocal,
} from '../businessTime';

/** The owner's laptop, deliberately nowhere near any business under test. */
const MACHINE_TZ = 'Pacific/Kiritimati'; // UTC+14, the furthest thing from UTC
const originalTZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = MACHINE_TZ;
});
afterAll(() => {
  process.env.TZ = originalTZ;
});

describe('a wall clock is read on the business clock, not the machine clock', () => {
  it('reads 09:00 typed for a New York business as 13:00Z, not the machine zone', () => {
    // 2026-09-21 is inside EDT, so New York is UTC-4.
    expect(fromBusinessLocalInput('2026-09-21T09:00', 'America/New_York').toISOString())
      .toBe('2026-09-21T13:00:00.000Z');
  });

  it('round-trips a typed time through the business zone unchanged', () => {
    const typed = '2026-09-21T09:00';
    const instant = fromBusinessLocalInput(typed, 'America/New_York');
    expect(toBusinessLocalInput(instant, 'America/New_York')).toBe(typed);
  });

  it('honours the date-dependent offset either side of a DST change', () => {
    // EDT (UTC-4) before, EST (UTC-5) after: the same wall clock, two instants.
    const before = fromBusinessLocalInput('2026-11-01T01:30', 'America/New_York');
    const after = fromBusinessLocalInput('2026-11-08T01:30', 'America/New_York');
    expect(after.getTime() - before.getTime()).toBe(7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000);
  });

  it('compares a start and an end on the SAME clock', () => {
    // The booking-modal bug: start parsed in the business zone, end on the
    // machine. On a UTC+14 machine against a New York business that is 18
    // hours, so every appointment looked as though it ended before it began.
    const start = fromBusinessLocalInput('2026-09-21T09:00', 'America/New_York');
    const end = fromBusinessLocalInput('2026-09-21T10:00', 'America/New_York');
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
  });
});

/**
 * The owner-reported bug, in the only conditions that show it.
 *
 * An owner in Israel with the business on New York typed 10:00 for an
 * hour-long service and the dialog filled the end in as 04:00 — seven hours
 * out, before the start, so the (correct) validator then refused the booking.
 * `handleStartTimeChange` read the typed clock with `new Date(...)`, which is
 * the MACHINE's, and wrote the end back on the business's.
 *
 * Both reads happen inside `endOfBusinessLocal` now, which is why this can be
 * pinned here with the process clock deliberately somewhere else. Under
 * `TZ=UTC` against a UTC business the broken version passes every one of these.
 */
describe('a slot ends where the business says, not where the machine does', () => {
  it('adds the duration on the business clock', () => {
    expect(endOfBusinessLocal('2026-10-02T10:00', 60, 'America/New_York'))
      .toBe('2026-10-02T11:00');
  });

  it('gives the same answer for the reporter\'s own business', () => {
    expect(endOfBusinessLocal('2026-10-02T10:00', 60, 'Asia/Jerusalem'))
      .toBe('2026-10-02T11:00');
  });

  it('and for a business genuinely on UTC', () => {
    expect(endOfBusinessLocal('2026-10-02T10:00', 90, 'UTC')).toBe('2026-10-02T11:30');
  });

  it('carries a slot over midnight on the business calendar', () => {
    expect(endOfBusinessLocal('2026-10-02T23:30', 60, 'America/New_York'))
      .toBe('2026-10-03T00:30');
  });

  it('keeps the wall clock right across a daylight-saving change', () => {
    // 01:30 EDT + 60 min is 01:30 EST: the same wall clock an hour later,
    // which is what adding to the INSTANT gets right and string arithmetic
    // does not.
    expect(endOfBusinessLocal('2026-11-01T01:30', 60, 'America/New_York'))
      .toBe('2026-11-01T01:30');
  });

  it('answers null for a start that is not a wall clock', () => {
    /*
     * An empty start is what a service with no date step leaves behind, and
     * failing to parse is NOT what used to happen to it: V8 reads
     * `new Date(':00Z')` as 31 December 1999 rather than rejecting it, so the
     * end field was quietly filled in with a 1999 date. Hence the shape check,
     * and hence this test — `toBeNull` here is what the old code could not do.
     */
    expect(endOfBusinessLocal('', 60, 'America/New_York')).toBeNull();
    expect(endOfBusinessLocal('not a time', 60, 'America/New_York')).toBeNull();
    expect(endOfBusinessLocal('2026-10-02', 60, 'America/New_York')).toBeNull();
    expect(() => endOfBusinessLocal('', 60, 'America/New_York')).not.toThrow();

    /*
     * The leniency it is guarding against, stated so it cannot surprise the
     * next reader: this is `fromBusinessLocalInput`, unchanged and untouched.
     *
     * Asserted as the INSTANT, not a local year. `getFullYear()` reads the
     * machine's calendar, so the same date is 1999 in New York and 2000 on a
     * UTC+14 machine — and a test of a timezone helper must not depend on where
     * it runs. That is the whole premise of this file.
     */
    const fromNothing = fromBusinessLocalInput('', 'America/New_York');
    expect(Number.isNaN(fromNothing.getTime())).toBe(false);   // ← the hazard
    // `:00Z` parses as 2000-01-01T00:00Z, then the zone correction moves it by
    // New York's offset. Derived from the business zone alone, so this holds
    // wherever the test runs.
    expect(fromNothing.toISOString()).toBe('2000-01-01T05:00:00.000Z');
  });

  it('survives a duration the service never set', () => {
    expect(endOfBusinessLocal('2026-10-02T10:00', NaN, 'America/New_York'))
      .toBe('2026-10-02T10:00');
  });

});

describe('the calendar day is the business day, not the machine day', () => {
  it('names the business day for an instant that falls on another day locally', () => {
    // 2026-09-21T23:00Z is the 21st in New York (19:00) and already the 22nd
    // on a UTC+14 machine (13:00 on the 22nd).
    const instant = new Date('2026-09-21T23:00:00.000Z');
    expect(businessDateKey(instant, 'America/New_York')).toBe('2026-09-21');
  });

  it('builds midnight where the business is', () => {
    expect(businessInstant('2026-09-21', '00:00', 'America/New_York').toISOString())
      .toBe('2026-09-21T04:00:00.000Z');
  });

  it('walks days without drifting through the machine zone', () => {
    let key = '2026-09-21';
    for (let i = 0; i < 5; i++) key = shiftBusinessDateKey(key, 1);
    expect(key).toBe('2026-09-26');
  });

  it('reads the hour a booking sits at on the business clock', () => {
    // The overlap-check bug: a stored instant read with getHours() came back
    // in the machine's zone and blocked the wrong slot.
    expect(businessClock(new Date('2026-09-21T18:00:00.000Z'), 'America/New_York'))
      .toEqual({ hour: 14, minute: 0 });
  });
});

describe('a business ahead of UTC, where the UTC day is the day before', () => {
  const AUCKLAND = 'Pacific/Auckland'; // UTC+12 in September

  it('does not name an early-morning appointment as the previous day', () => {
    // 09:00 in Auckland on the 21st is 21:00Z on the 20th. Taking the UTC day
    // of that instant — which several call sites did — gives the 20th.
    const instant = fromBusinessLocalInput('2026-09-21T09:00', AUCKLAND);
    expect(instant.toISOString().split('T')[0]).toBe('2026-09-20'); // the old, wrong answer
    expect(businessDateKey(instant, AUCKLAND)).toBe('2026-09-21');  // the right one
  });
});
