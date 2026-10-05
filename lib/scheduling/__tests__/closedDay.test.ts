/**
 * Booking into a day the owner closed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The reported bug: 7 October was closed for the whole day and the owner could
 * still book a client into it from their own calendar, with no warning on any
 * screen and a confirmation email naming a day the business is shut.
 *
 * These are the rules the warning is made of. The two that carry the most risk
 * of being wrong quietly:
 *
 *   · the LAST day of a range is closed — an inclusive range off by one gives
 *     back a day the owner is away for;
 *   · unreadable short hours CLOSE the date, because that is what
 *     `windowsForDate` already does with the same row. A date the public page
 *     treats as closed and the owner's dialog treats as open is this bug again
 *     in the other direction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { closedDayVerdict } from '../closedDay';
import type { TimeOffEntry } from '../availabilityWindows';

const sukkot: TimeOffEntry = {
  exception_type: 'unavailable',
  start_date: '2026-10-06',
  end_date: '2026-10-14',
  reason: 'Sukkot',
};

const shortFriday: TimeOffEntry = {
  exception_type: 'custom_hours',
  start_date: '2026-10-23',
  end_date: '2026-10-23',
  custom_hours: { start: '09:00', end: '13:00' },
  reason: 'Early finish',
};

describe('a day with nothing recorded against it', () => {
  it('is open', () => {
    expect(closedDayVerdict([sukkot], '2026-10-20', { start: '10:00', end: '11:00' })).toEqual({
      closed: false,
    });
  });

  it('is open when there is no time off at all', () => {
    expect(closedDayVerdict([], '2026-10-07')).toEqual({ closed: false });
    expect(closedDayVerdict(null, '2026-10-07')).toEqual({ closed: false });
  });
});

describe('a day closed outright', () => {
  it('is closed, and says why', () => {
    expect(closedDayVerdict([sukkot], '2026-10-07', { start: '10:00', end: '11:00' })).toEqual({
      closed: true,
      kind: 'all_day',
      reason: 'Sukkot',
    });
  });

  it('is closed at every hour of it', () => {
    const atMidnight = closedDayVerdict([sukkot], '2026-10-07', { start: '00:00', end: '00:30' });
    const atNight = closedDayVerdict([sukkot], '2026-10-07', { start: '23:00', end: '23:30' });
    expect(atMidnight).toMatchObject({ closed: true });
    expect(atNight).toMatchObject({ closed: true });
  });

  it('is closed on the first and the LAST day of the range', () => {
    // The off-by-one that would hand back a day the owner is away for.
    expect(closedDayVerdict([sukkot], '2026-10-06')).toMatchObject({ closed: true });
    expect(closedDayVerdict([sukkot], '2026-10-14')).toMatchObject({ closed: true });
    expect(closedDayVerdict([sukkot], '2026-10-15')).toEqual({ closed: false });
    expect(closedDayVerdict([sukkot], '2026-10-05')).toEqual({ closed: false });
  });

  it('is closed before a time has been chosen, which is what a date picker asks', () => {
    expect(closedDayVerdict([sukkot], '2026-10-07')).toMatchObject({ closed: true, kind: 'all_day' });
  });

  it('reports no reason rather than an empty one', () => {
    const unnamed = { ...sukkot, reason: '   ' };
    expect(closedDayVerdict([unnamed], '2026-10-07')).toEqual({
      closed: true,
      kind: 'all_day',
      reason: null,
    });
  });

  it('wins over a short day recorded for the same date', () => {
    // Same precedence as `windowsForDate`: closed beats shortened.
    const both = [{ ...shortFriday, start_date: '2026-10-07', end_date: '2026-10-07' }, sukkot];
    expect(closedDayVerdict(both, '2026-10-07')).toMatchObject({ kind: 'all_day' });
  });
});

describe('a short day', () => {
  it('admits an hour inside the hours', () => {
    expect(closedDayVerdict([shortFriday], '2026-10-23', { start: '09:00', end: '10:00' })).toEqual({
      closed: false,
    });
  });

  it('admits an hour that ends exactly at closing', () => {
    expect(closedDayVerdict([shortFriday], '2026-10-23', { start: '12:00', end: '13:00' })).toEqual({
      closed: false,
    });
  });

  it('refuses one that runs past closing, and names the hours', () => {
    expect(closedDayVerdict([shortFriday], '2026-10-23', { start: '12:30', end: '13:30' })).toEqual({
      closed: true,
      kind: 'short_day',
      reason: 'Early finish',
      hours: { start: '09:00', end: '13:00' },
    });
  });

  it('refuses one that starts before opening', () => {
    expect(closedDayVerdict([shortFriday], '2026-10-23', { start: '08:00', end: '09:00' })).toMatchObject({
      kind: 'short_day',
    });
  });

  it('is an OPEN day when no time has been chosen yet', () => {
    // The date itself is available; only some hours of it are not, and a date
    // picker that greyed it out would hide a day the owner can still work.
    expect(closedDayVerdict([shortFriday], '2026-10-23')).toEqual({ closed: false });
  });
});

describe('short hours that cannot be read', () => {
  const broken = (custom_hours: unknown): TimeOffEntry => ({
    exception_type: 'custom_hours',
    start_date: '2026-10-23',
    end_date: '2026-10-23',
    reason: 'Early finish',
    custom_hours: custom_hours as TimeOffEntry['custom_hours'],
  });

  it('close the date, the same way the booking page reads them', () => {
    for (const hours of [null, {}, { start: '09:00' }, { start: '9', end: '13' }, { start: '13:00', end: '09:00' }]) {
      expect(closedDayVerdict([broken(hours)], '2026-10-23', { start: '10:00', end: '11:00' })).toEqual({
        closed: true,
        kind: 'all_day',
        reason: 'Early finish',
      });
    }
  });
});

describe('what it refuses to answer about', () => {
  it('nothing, when there is no date', () => {
    expect(closedDayVerdict([sukkot], '')).toEqual({ closed: false });
  });

  it('an entry with no dates on it', () => {
    const dateless: TimeOffEntry = { exception_type: 'unavailable', start_date: null, end_date: null };
    expect(closedDayVerdict([dateless], '2026-10-07')).toEqual({ closed: false });
  });

  it('a type nothing reads', () => {
    const unknownType: TimeOffEntry = {
      exception_type: 'maybe',
      start_date: '2026-10-07',
      end_date: '2026-10-07',
    };
    expect(closedDayVerdict([unknownType], '2026-10-07')).toEqual({ closed: false });
  });
});
