/**
 * Free time on a day — the arithmetic behind "how many hours are open?".
 *
 * Every case here is a way the number can be wrong while looking right, which
 * is the failure mode that matters: nobody double-checks "you have 4 hours
 * free", so it has to be true.
 */

import { computeOpenTime, weekdayFor } from '../openTime';

const HOURS = { wednesday: [{ start: '09:00', end: '17:00' }] };
const TZ = 'Asia/Jerusalem';

// 2026-09-09 is a Wednesday. Jerusalem is UTC+3 on that date (DST).
const DATE = '2026-09-09';
const at = (hhmm: string) => `2026-09-09T${hhmm}:00+03:00`;

const compute = (bookings: Array<{ start: string; end: string | null }>, duration?: number) =>
  computeOpenTime({
    availability: HOURS,
    date: DATE,
    timeZone: TZ,
    bookings,
    durationMinutes: duration,
  });

describe('the day itself', () => {
  it('reads the weekday of the calendar date', () => {
    expect(weekdayFor(DATE)).toBe('wednesday');
  });

  it('is the same weekday everywhere, because a calendar date has only one', () => {
    /*
     * The first implementation formatted noon UTC in the business zone, which
     * is correct up to about UTC+11 and wrong past it — noon UTC is already
     * Thursday in Auckland. A civil fact must not be derived from an instant.
     */
    expect(weekdayFor('2026-09-09')).toBe('wednesday');
    expect(weekdayFor('2026-09-12')).toBe('saturday');
    expect(weekdayFor('2026-01-01')).toBe('thursday');
  });

  it('reports a day with no configured hours as not a working day', () => {
    const result = computeOpenTime({
      availability: HOURS,
      date: '2026-09-12', // Saturday
      timeZone: TZ,
      bookings: [],
    });

    expect(result.isWorkingDay).toBe(false);
    expect(result.freeMinutes).toBe(0);
  });
});

describe('free time', () => {
  it('is the whole window when nothing is booked', () => {
    expect(compute([]).freeMinutes).toBe(8 * 60);
  });

  it('subtracts a booking and reports what is left either side', () => {
    const result = compute([{ start: at('12:00'), end: at('13:00') }]);

    expect(result.bookedMinutes).toBe(60);
    expect(result.freeMinutes).toBe(7 * 60);
    expect(result.free).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
  });

  it('counts overlapping bookings once, not twice', () => {
    // Double-booked time is one hour gone, not two. Counting it twice is how a
    // day reports negative free time.
    const result = compute([
      { start: at('12:00'), end: at('13:00') },
      { start: at('12:30'), end: at('13:00') },
    ]);

    expect(result.bookedMinutes).toBe(60);
    expect(result.freeMinutes).toBe(7 * 60);
  });

  it('treats two abutting bookings as one busy block', () => {
    const result = compute([
      { start: at('12:00'), end: at('13:00') },
      { start: at('13:00'), end: at('14:00') },
    ]);

    expect(result.busy).toEqual([{ start: '12:00', end: '14:00' }]);
    expect(result.freeMinutes).toBe(6 * 60);
  });

  it('ignores time booked outside working hours', () => {
    /*
     * A 20:00 booking is real, but it is not time the business was offering.
     * Counting it would make an eight-hour day look more than fully booked.
     */
    const result = compute([{ start: at('20:00'), end: at('21:00') }]);

    expect(result.bookedMinutes).toBe(0);
    expect(result.freeMinutes).toBe(8 * 60);
  });

  it('clips a booking that only partly overlaps the window', () => {
    const result = compute([{ start: at('08:00'), end: at('10:00') }]);

    expect(result.bookedMinutes).toBe(60); // only 09:00–10:00 counts
    expect(result.free).toEqual([{ start: '10:00', end: '17:00' }]);
  });

  it('handles a split day — both halves, not just the first', () => {
    /*
     * The booking widget's own slot maths takes windows[0] and drops the rest,
     * so a business closing for lunch loses its entire afternoon. Its comment
     * admits it. This is the case that made reusing that function impossible.
     */
    const result = computeOpenTime({
      availability: { wednesday: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
      date: DATE,
      timeZone: TZ,
      bookings: [],
    });

    expect(result.freeMinutes).toBe(7 * 60);
    expect(result.free).toHaveLength(2);
  });
});

describe('timezone', () => {
  it('places a booking by the business clock, not the server clock', () => {
    // 09:00Z is 12:00 in Jerusalem. Read as UTC it would land at 09:00 and eat
    // the start of the day instead of the middle of it.
    const result = compute([{ start: '2026-09-09T09:00:00Z', end: '2026-09-09T10:00:00Z' }]);

    expect(result.busy).toEqual([{ start: '12:00', end: '13:00' }]);
  });

  it('keeps an evening booking from the previous day out of this one', () => {
    const result = compute([
      { start: '2026-09-08T18:00:00+03:00', end: '2026-09-08T19:00:00+03:00' },
    ]);

    expect(result.bookedMinutes).toBe(0);
    expect(result.freeMinutes).toBe(8 * 60);
  });
});

describe('slots for an appointment of a given length', () => {
  it('counts how many actually fit', () => {
    expect(compute([], 60).slots).toBe(8);
    expect(compute([], 90).slots).toBe(5); // 480/90 = 5.33
  });

  it('does not count a gap too small to use', () => {
    /*
     * Two 45-minute gaps do not make a 90-minute appointment. Summing free
     * minutes and dividing would say they do — which is why slots are counted
     * per gap rather than from the total.
     */
    const result = computeOpenTime({
      availability: { wednesday: [{ start: '09:00', end: '09:45' }, { start: '10:00', end: '10:45' }] },
      date: DATE,
      timeZone: TZ,
      bookings: [],
      durationMinutes: 90,
    });

    expect(result.freeMinutes).toBe(90);
    expect(result.slots).toBe(0);
  });

  it('counts per gap around a booking', () => {
    // 09:00–12:00 and 13:00–17:00 -> three 60s and four 60s.
    expect(compute([{ start: at('12:00'), end: at('13:00') }], 60).slots).toBe(7);
  });
});

describe('a booking with no end time', () => {
  it('consumes nothing rather than the rest of the day', () => {
    // A malformed row should not silently wipe out an afternoon.
    const result = compute([{ start: at('12:00'), end: null }]);

    expect(result.bookedMinutes).toBe(0);
    expect(result.freeMinutes).toBe(8 * 60);
  });
});
