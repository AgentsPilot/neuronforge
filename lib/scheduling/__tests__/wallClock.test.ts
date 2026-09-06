/**
 * The four hours that used to vanish.
 *
 * A slot picked at 13:00 was stored as 13:00Z and read back — correctly, in the
 * business's own zone — as 09:00. These assert the conversion that was missing,
 * including the two days a year where the offset changes underfoot.
 */

import { wallClockToInstant, instantToWallClock } from '../wallClock';

describe('wall clock to instant', () => {
  it('stores 1pm in New York as the moment it actually is', () => {
    // The exact case that lost four hours on the way into the database.
    expect(wallClockToInstant('2026-09-23T13:00:00', 'America/New_York'))
      .toBe('2026-09-23T17:00:00.000Z');
  });

  it('round-trips: what is stored reads back as the hour that was picked', () => {
    const picked = '2026-09-23T13:00:00';
    const stored = wallClockToInstant(picked, 'America/New_York');
    expect(instantToWallClock(stored, 'America/New_York')).toBe(picked);
  });

  it('handles a business east of Greenwich', () => {
    // Israel is UTC+3 in September.
    expect(wallClockToInstant('2026-09-23T09:00:00', 'Asia/Jerusalem'))
      .toBe('2026-09-23T06:00:00.000Z');
  });

  it('leaves UTC alone', () => {
    expect(wallClockToInstant('2026-09-23T13:00:00', 'UTC'))
      .toBe('2026-09-23T13:00:00.000Z');
  });

  /**
   * The offset depends on the instant, and the instant is what we are solving
   * for — so the conversion settles it in two passes. A single pass picks the
   * wrong side of a daylight-saving change.
   */
  it('uses the right offset either side of a daylight-saving change', () => {
    // US clocks go back on 2026-11-01: 1 Nov is EST (-5), 31 Oct is EDT (-4).
    expect(wallClockToInstant('2026-10-31T13:00:00', 'America/New_York'))
      .toBe('2026-10-31T17:00:00.000Z');
    expect(wallClockToInstant('2026-11-01T13:00:00', 'America/New_York'))
      .toBe('2026-11-01T18:00:00.000Z');
  });

  it('passes an instant through untouched', () => {
    // Already carries a zone, so there is nothing to interpret.
    expect(wallClockToInstant('2026-09-23T17:00:00Z', 'America/New_York'))
      .toBe('2026-09-23T17:00:00.000Z');
    expect(wallClockToInstant('2026-09-23T13:00:00-04:00', 'America/New_York'))
      .toBe('2026-09-23T17:00:00.000Z');
  });

  it('returns anything it cannot parse unchanged rather than inventing a time', () => {
    expect(wallClockToInstant('not a date', 'America/New_York')).toBe('not a date');
  });
});
