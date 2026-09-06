/**
 * Reading what somebody meant by "change Tuesday to 9-2".
 *
 * The parsing is the risky half of this feature. A wrong day silently closes a
 * day the business is open; a wrong time turns a full day into two hours. Both
 * are invisible until a client cannot book, so they are pinned here.
 */

import { parseWeekday, parseTime, AvailabilityInputError } from '@/lib/services/AvailabilityService';

describe('parseWeekday', () => {
  it('accepts a day however it was typed', () => {
    expect(parseWeekday('tuesday')).toBe('tuesday');
    expect(parseWeekday('Tuesday')).toBe('tuesday');
    expect(parseWeekday('  TUESDAY ')).toBe('tuesday');
  });

  it('refuses anything that is not a weekday, rather than guessing', () => {
    // Silently ignoring an unrecognised day would report success for a change
    // that never happened.
    expect(() => parseWeekday('tuesdays')).toThrow(AvailabilityInputError);
    expect(() => parseWeekday('tomorrow')).toThrow(/not a day of the week/);
    expect(() => parseWeekday(undefined)).toThrow(AvailabilityInputError);
  });

  it('names the days it will accept', () => {
    expect(() => parseWeekday('funday')).toThrow(/sunday, monday, tuesday/);
  });
});

describe('parseTime', () => {
  it('normalises the ways people write a time', () => {
    expect(parseTime('9', 'start time')).toBe('09:00');
    expect(parseTime('9:30', 'start time')).toBe('09:30');
    expect(parseTime('09:00', 'start time')).toBe('09:00');
    expect(parseTime('17:00', 'end time')).toBe('17:00');
  });

  it('understands am and pm', () => {
    expect(parseTime('9am', 'start time')).toBe('09:00');
    expect(parseTime('2pm', 'end time')).toBe('14:00');
    expect(parseTime('12am', 'start time')).toBe('00:00');
    expect(parseTime('12pm', 'end time')).toBe('12:00');
  });

  it('refuses a non-time and an impossible one', () => {
    expect(() => parseTime('lunchtime', 'start time')).toThrow(/not a time/);
    expect(() => parseTime('25:00', 'start time')).toThrow(/not a valid start time/);
    expect(() => parseTime('09:75', 'start time')).toThrow(/not a valid start time/);
  });
});
