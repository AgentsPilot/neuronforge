import { windowsForDay, windowsForDate, weekdayNameFor, hasAnyAvailability } from '../availabilityWindows';

/** Exactly what the editor writes today. */
const CURRENT = {
  sunday: [{ start: '09:00', end: '17:00' }],
  monday: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }],
  friday: [],
  saturday: [],
};

describe('windowsForDay', () => {
  it('reads the array shape the editor actually writes', () => {
    // The regression this guards: the public booking endpoint asked for
    // `.start` on this array, got undefined, and skipped every day of the
    // week — reporting success with zero slots.
    expect(windowsForDay(CURRENT, 'sunday')).toEqual([{ start: '09:00', end: '17:00' }]);
  });

  it('keeps every window in a split day', () => {
    // A morning and an evening with a gap between them. Reading only the first
    // would hide the afternoon and look exactly like a short day.
    expect(windowsForDay(CURRENT, 'monday')).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '14:00', end: '18:00' },
    ]);
  });

  it('treats an empty array as closed', () => {
    expect(windowsForDay(CURRENT, 'friday')).toEqual([]);
  });

  it('treats a missing day as closed', () => {
    expect(windowsForDay(CURRENT, 'thursday')).toEqual([]);
  });

  describe('shapes written by older versions', () => {
    it('accepts a single range object', () => {
      expect(windowsForDay({ monday: { start: '08:00', end: '16:00' } }, 'monday'))
        .toEqual([{ start: '08:00', end: '16:00' }]);
    });

    it('accepts the enabled flag, and honours it when false', () => {
      const day = { monday: { start: '08:00', end: '16:00', enabled: false } };
      expect(windowsForDay(day, 'monday')).toEqual([]);
    });

    it('treats an absent enabled flag as open', () => {
      // Requiring the flag is what made the website endpoint skip every day:
      // an array entry exists precisely because the day is open.
      expect(windowsForDay(CURRENT, 'sunday')).toHaveLength(1);
    });
  });

  describe('windows that cannot produce a slot', () => {
    it('drops a zero-length day', () => {
      // How the editor switches a day off: start equal to end.
      expect(windowsForDay({ monday: [{ start: '09:00', end: '09:00' }] }, 'monday')).toEqual([]);
    });

    it('drops an inverted window', () => {
      expect(windowsForDay({ monday: [{ start: '17:00', end: '09:00' }] }, 'monday')).toEqual([]);
    });

    it('drops entries that are not times', () => {
      const junk = { monday: [{ start: 'morning', end: 'evening' }, { start: '09:00' }, null, 42] };
      expect(windowsForDay(junk, 'monday')).toEqual([]);
    });
  });

  it('survives a null or malformed column', () => {
    for (const value of [null, undefined, 'closed', 7, []]) {
      expect(windowsForDay(value, 'monday')).toEqual([]);
    }
  });
});

describe('hasAnyAvailability', () => {
  it('is true when some day is open', () => {
    expect(hasAnyAvailability(CURRENT)).toBe(true);
  });

  it('is FALSE for a profile whose every day is an empty array', () => {
    // The old test counted keys, so this reported "configured" and then
    // produced no slots — the report that hid the bug rather than naming it.
    const allClosed = { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
    expect(hasAnyAvailability(allClosed)).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(hasAnyAvailability(null)).toBe(false);
  });
});

/*
 * Time off: the reason a client could book a closed day.
 *
 * `scheduling_availability_exceptions` existed for months with nothing reading
 * it, so a business shut for a holiday went on publishing slots for it. These
 * pin the three rules and the two failure directions.
 */
describe('windowsForDate', () => {
  const OPEN = { sunday: [{ start: '09:00', end: '17:00' }], friday: [] };
  // 2026-10-04 is a Sunday; 2026-10-09 is a Friday.
  const SUNDAY = '2026-10-04';
  const FRIDAY = '2026-10-09';

  it('is the weekday’s hours when nothing is recorded', () => {
    expect(windowsForDate(OPEN, SUNDAY)).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(windowsForDate(OPEN, FRIDAY)).toEqual([]);
  });

  it('closes a date inside an unavailable range', () => {
    const away = [{ exception_type: 'unavailable', start_date: '2026-10-01', end_date: '2026-10-08' }];
    expect(windowsForDate(OPEN, SUNDAY, away)).toEqual([]);
  });

  it('leaves the days either side of that range alone', () => {
    const away = [{ exception_type: 'unavailable', start_date: '2026-10-05', end_date: '2026-10-08' }];
    expect(windowsForDate(OPEN, SUNDAY, away)).toEqual([{ start: '09:00', end: '17:00' }]);
  });

  it('treats a single-day range as that one day', () => {
    const away = [{ exception_type: 'unavailable', start_date: SUNDAY, end_date: SUNDAY }];
    expect(windowsForDate(OPEN, SUNDAY, away)).toEqual([]);
  });

  it('replaces the hours for a short day', () => {
    const short = [{
      exception_type: 'custom_hours',
      start_date: SUNDAY,
      end_date: SUNDAY,
      custom_hours: { start: '09:00', end: '13:00' },
    }];
    expect(windowsForDate(OPEN, SUNDAY, short)).toEqual([{ start: '09:00', end: '13:00' }]);
  });

  it('can OPEN a day that is normally closed', () => {
    // Replacing rather than narrowing is what makes this work with one rule.
    const special = [{
      exception_type: 'custom_hours',
      start_date: FRIDAY,
      end_date: FRIDAY,
      custom_hours: { start: '10:00', end: '14:00' },
    }];
    expect(windowsForDate(OPEN, FRIDAY, special)).toEqual([{ start: '10:00', end: '14:00' }]);
  });

  it('closed beats short hours on the same date', () => {
    const both = [
      { exception_type: 'custom_hours', start_date: SUNDAY, end_date: SUNDAY, custom_hours: { start: '09:00', end: '13:00' } },
      { exception_type: 'unavailable', start_date: SUNDAY, end_date: SUNDAY },
    ];
    expect(windowsForDate(OPEN, SUNDAY, both)).toEqual([]);
  });

  it('closes the date when a custom-hours entry cannot be read', () => {
    // The owner recorded an intention to restrict it. A restriction we cannot
    // parse must not be read as business as usual.
    const broken = [
      { exception_type: 'custom_hours', start_date: SUNDAY, end_date: SUNDAY, custom_hours: { start: '13:00', end: '09:00' } },
    ];
    expect(windowsForDate(OPEN, SUNDAY, broken)).toEqual([]);

    const missing = [
      { exception_type: 'custom_hours', start_date: SUNDAY, end_date: SUNDAY, custom_hours: null },
    ];
    expect(windowsForDate(OPEN, SUNDAY, missing)).toEqual([]);
  });

  it('ignores an entry with no dates on it', () => {
    expect(windowsForDate(OPEN, SUNDAY, [{ exception_type: 'unavailable' }]))
      .toEqual([{ start: '09:00', end: '17:00' }]);
  });

  it('names the weekday in the business calendar, not the server’s', () => {
    // Midnight-UTC parsing reads 2026-10-04 as a Saturday anywhere behind UTC.
    expect(weekdayNameFor('2026-10-04')).toBe('sunday');
    expect(weekdayNameFor('2026-10-09')).toBe('friday');
    expect(weekdayNameFor('not a date')).toBe('');
  });
});
