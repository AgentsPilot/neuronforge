/**
 * Expanding "every Tuesday at 10, twelve times".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner describes the pattern once; the quote still stores twelve explicit
 * dates. So the only thing that can be wrong here is the arithmetic, and two
 * parts of it have bitten this codebase before:
 *
 *   · A MONTH IS NOT 30 DAYS. `planSchedule` carries the same note after a
 *     twelve-month plan billed its last stage five days early.
 *   · AN HOUR IS NOT A FIXED OFFSET. Stepping instants by 7 × 24 hours moves a
 *     10:00 appointment to 09:00 after the clocks change. These functions work
 *     on date KEYS so the hour the owner typed is applied once, at the end.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { recurringDateKeys, recurringLocalInputs, MAX_OCCURRENCES } from '../recurrence';

describe('weekly', () => {
  it('starts on the first meeting and steps seven days', () => {
    expect(recurringDateKeys('2026-10-07', 'weekly', 4)).toEqual([
      '2026-10-07',
      '2026-10-14',
      '2026-10-21',
      '2026-10-28',
    ]);
  });

  it('crosses a month end', () => {
    expect(recurringDateKeys('2026-10-28', 'weekly', 3)).toEqual([
      '2026-10-28',
      '2026-11-04',
      '2026-11-11',
    ]);
  });

  it('crosses a year end', () => {
    expect(recurringDateKeys('2026-12-28', 'weekly', 3)).toEqual([
      '2026-12-28',
      '2027-01-04',
      '2027-01-11',
    ]);
  });

  it('stays on the same weekday for a year of sessions', () => {
    // The thing an owner would notice instantly, and the thing a DST bug
    // breaks: every date must be the same day of the week.
    const keys = recurringDateKeys('2026-03-03', 'weekly', 52);
    const weekdays = new Set(keys.map(key => new Date(`${key}T12:00:00Z`).getUTCDay()));
    expect(weekdays.size).toBe(1);
  });
});

describe('fortnightly', () => {
  it('steps fourteen days', () => {
    expect(recurringDateKeys('2026-10-07', 'biweekly', 3)).toEqual([
      '2026-10-07',
      '2026-10-21',
      '2026-11-04',
    ]);
  });
});

describe('monthly', () => {
  it('keeps the day of the month', () => {
    expect(recurringDateKeys('2026-10-15', 'monthly', 4)).toEqual([
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
    ]);
  });

  it('clamps a 31st into a short month', () => {
    expect(recurringDateKeys('2026-01-31', 'monthly', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('measures from the ORIGINAL day, so February does not drag the series earlier', () => {
    // Stepping from the last date used would give 28 Feb → 28 Mar → 28 Apr,
    // quietly moving every later session three days.
    const keys = recurringDateKeys('2026-01-31', 'monthly', 3);
    expect(keys[2]).toBe('2026-03-31');
  });

  it('knows a leap February', () => {
    expect(recurringDateKeys('2028-01-31', 'monthly', 2)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('crosses a year end', () => {
    expect(recurringDateKeys('2026-11-20', 'monthly', 3)).toEqual([
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
    ]);
  });
});

describe('how many it will make', () => {
  it('counts the first meeting as one of them', () => {
    expect(recurringDateKeys('2026-10-07', 'weekly', 1)).toEqual(['2026-10-07']);
  });

  it('caps at a year of weekly sessions', () => {
    expect(recurringDateKeys('2026-10-07', 'weekly', 500)).toHaveLength(MAX_OCCURRENCES);
  });

  it('makes nothing of nonsense', () => {
    expect(recurringDateKeys('2026-10-07', 'weekly', 0)).toEqual([]);
    expect(recurringDateKeys('next Tuesday', 'weekly', 4)).toEqual([]);
    expect(recurringDateKeys('07/10/2026', 'weekly', 4)).toEqual([]);
    expect(recurringDateKeys('2026-10-07', 'weekly', Number.NaN)).toEqual([]);
  });
});

describe('as the dialog holds them', () => {
  it('carries the hour the owner typed, unchanged, to every meeting', () => {
    expect(recurringLocalInputs('2026-10-07', '10:00', 'weekly', 3)).toEqual([
      '2026-10-07T10:00',
      '2026-10-14T10:00',
      '2026-10-21T10:00',
    ]);
  });

  it('keeps 10:00 at 10:00 across the clocks changing', () => {
    /*
     * Europe and Israel move their clocks in late October. The series below
     * straddles it, and every entry must still read 10:00 — that is the hour the
     * client was told, and the whole reason this steps dates rather than
     * instants.
     */
    const inputs = recurringLocalInputs('2026-10-20', '10:00', 'weekly', 4);
    expect(inputs.every(value => value.endsWith('T10:00'))).toBe(true);
  });

  it('refuses an hour that is not one', () => {
    expect(recurringLocalInputs('2026-10-07', '10', 'weekly', 3)).toEqual([]);
    expect(recurringLocalInputs('2026-10-07', '', 'weekly', 3)).toEqual([]);
  });
});
