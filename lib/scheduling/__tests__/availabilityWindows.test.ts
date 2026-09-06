import { windowsForDay, hasAnyAvailability } from '../availabilityWindows';

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
