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
