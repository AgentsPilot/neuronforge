/**
 * `isValidTimezone`: the strict zone check behind the timezone save
 * (settings drawer D-1, C-14 as amended by SA-D1-1).
 *
 * Unlike `safeTimezone` it never trims and never falls back: the route stores
 * exactly what was picked and then reads it back with `===`.
 */

import { isValidTimezone } from '../businessTime';

describe('isValidTimezone', () => {
  it.each(['UTC', 'Etc/UTC', 'Asia/Jerusalem', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5', 'utc', 'EST'])(
    'accepts %j',
    (zone) => {
      expect(isValidTimezone(zone)).toBe(true);
    }
  );

  it.each([
    ['empty', ''],
    ['leading space (no trim)', ' UTC'],
    ['trailing space (no trim)', 'UTC '],
    ['unknown zone', 'Foo/Bar'],
    ['unknown zone with a leading letter', 'Mars/Olympus'],
    ['an offset ID (Intl accepts it, older browsers do not)', '+05'],
    ['a four-digit offset ID', '+0500'],
    ['an offset with a colon', '+05:00'],
    ['a semicolon', 'Asia/Jerusalem;drop'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { zone: 'UTC' }],
  ])('refuses %s', (_label, zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });

  it('refuses anything over 64 characters without calling Intl', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat');
    try {
      expect(isValidTimezone(`A${'a'.repeat(64)}`)).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('never throws, whatever it is given', () => {
    for (const value of ['%%%', '\u0000', 'x'.repeat(10_000), Symbol('z'), () => 'UTC']) {
      expect(() => isValidTimezone(value)).not.toThrow();
    }
  });
});
