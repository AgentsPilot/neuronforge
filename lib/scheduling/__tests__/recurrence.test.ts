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

import {
  recurringDateKeys,
  recurringLocalInputs,
  cadenceOf,
  nextInSeries,
  MAX_OCCURRENCES,
  type Cadence,
} from '../recurrence';

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

/* ───────────────────────────────────────────────────────────────────────────
 * READING THE RHYTHM BACK OFF THE DATES.
 *
 * Reported: a fortnightly package reopened with its six correct dates above a
 * cadence chip reading "every week". A quote stores the instants and not the
 * spacing, so the chip was showing its own initial value.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('cadenceOf', () => {
  it('names the rhythm of the reported series', () => {
    // The live dates: six meetings, every second Thursday.
    expect(
      cadenceOf(['2026-10-08', '2026-10-22', '2026-11-05', '2026-11-19', '2026-12-03', '2026-12-17'])
    ).toBe('biweekly');
  });

  it('is the exact inverse of the generator, for every cadence', () => {
    // The property that matters: whatever the generator produced, this names.
    for (const cadence of ['weekly', 'biweekly', 'monthly'] as Cadence[]) {
      for (const count of [2, 3, 6, 12]) {
        expect(cadenceOf(recurringDateKeys('2026-01-15', cadence, count))).toBe(cadence);
      }
    }
  });

  it('names a monthly series that the month lengths bend', () => {
    // The 31st clamps to the 28th, 30th and so on, so a gap measured in days
    // would call this anything but monthly. Asking the generator does not.
    expect(cadenceOf(recurringDateKeys('2026-01-31', 'monthly', 6))).toBe('monthly');
  });

  it('names nothing when a date was moved by hand', () => {
    // One meeting pushed a day: no cadence generates this, and claiming one
    // would re-space the series the moment the owner touched the count.
    expect(
      cadenceOf(['2026-10-08', '2026-10-22', '2026-11-06', '2026-11-19'])
    ).toBeNull();
  });

  it('names nothing from too little to tell', () => {
    expect(cadenceOf([])).toBeNull();
    expect(cadenceOf(['2026-10-08'])).toBeNull();
    expect(cadenceOf(['not-a-date', '2026-10-22'])).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * WHERE THE NEXT MEETING GOES.
 *
 * Adding a seventh session to a fortnightly course opened the booking dialog
 * on tomorrow's first free hour, leaving the owner to work out a date the
 * series had already decided.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('nextInSeries', () => {
  /** The reported course: every second Thursday at 09:30. */
  const COURSE = [
    '2026-10-08T09:30',
    '2026-10-22T09:30',
    '2026-11-05T09:30',
    '2026-11-19T09:30',
    '2026-12-03T09:30',
    '2026-12-17T09:30',
  ];

  it('is a fortnight after the last one, at the same time', () => {
    expect(nextInSeries(COURSE)).toBe('2026-12-31T09:30');
  });

  it('does not care what order they arrive in', () => {
    const shuffled = [COURSE[3], COURSE[0], COURSE[5], COURSE[1], COURSE[4], COURSE[2]];
    expect(nextInSeries(shuffled)).toBe('2026-12-31T09:30');
  });

  it('follows a weekly series weekly', () => {
    expect(nextInSeries(['2026-10-08T14:00', '2026-10-15T14:00'])).toBe('2026-10-22T14:00');
  });

  it('follows a monthly series by the month, not by 30 days', () => {
    expect(nextInSeries(['2026-01-31T08:00', '2026-02-28T08:00'])).toBe('2026-03-31T08:00');
  });

  it('says nothing about a series with no rhythm', () => {
    // Hand-adjusted: proposing a date from a pattern that is not there would
    // be a guess dressed as the agreement.
    expect(nextInSeries(['2026-10-08T09:30', '2026-10-22T09:30', '2026-11-06T09:30'])).toBeNull();
  });

  it('says nothing about a single meeting', () => {
    expect(nextInSeries(['2026-10-08T09:30'])).toBeNull();
    expect(nextInSeries([])).toBeNull();
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * ONE MOVED MEETING MUST NOT COST THE SERIES ITS RHYTHM.
 *
 * Reported: "add new meeting opens the dialog with today's date." The course
 * runs every second Thursday at 09:30 and its last meeting is 17 Dec, so it
 * should open on 31 Dec. The second session had been moved from the 22nd to
 * the 23rd, so the diary's real gaps are 15, 13, 14, 14 days — a pattern no
 * cadence generates, which left the whole series unnamed.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a series the diary has drifted off', () => {
  /** As it stands: session two moved a day. */
  const DIARY = [
    '2026-10-08T09:30',
    '2026-10-23T09:30',
    '2026-11-05T09:30',
    '2026-11-19T09:30',
    '2026-12-03T09:30',
    '2026-12-17T09:30',
  ];

  /** As it was sold, which never moves. */
  const SOLD = [
    '2026-10-08T09:30',
    '2026-10-22T09:30',
    '2026-11-05T09:30',
    '2026-11-19T09:30',
    '2026-12-03T09:30',
    '2026-12-17T09:30',
  ];

  it('names no cadence on its own, which is why this was needed', () => {
    expect(cadenceOf(DIARY.map(d => d.slice(0, 10)))).toBeNull();
    expect(nextInSeries(DIARY)).toBeNull();
  });

  it('takes the rhythm from the agreement and the anchor from the diary', () => {
    // The reported expectation: a fortnight after 17 Dec, at 09:30.
    expect(nextInSeries(DIARY, SOLD)).toBe('2026-12-31T09:30');
  });

  it('moves on each time another is added, rather than repeating itself', () => {
    /*
     * The reason the anchor is the diary's last meeting and not the last one
     * sold: adding a seventh must then propose an eighth, not the seventh
     * again — which is now a slot it would collide with.
     */
    const withSeventh = [...DIARY, '2026-12-31T09:30'];
    expect(nextInSeries(withSeventh, SOLD)).toBe('2027-01-14T09:30');
  });

  it('proposes one even for a package down to a single meeting', () => {
    // One date names no rhythm by itself, but the quote still does.
    expect(nextInSeries(['2026-12-17T09:30'], SOLD)).toBe('2026-12-31T09:30');
  });

  it('still prefers the diary when the diary is regular', () => {
    // The agreement is only a second opinion; a clean series answers for
    // itself, and keeps the monthly anchor that regenerating preserves.
    expect(nextInSeries(SOLD, ['2026-01-05T08:00', '2026-01-12T08:00'])).toBe('2026-12-31T09:30');
  });

  it('says nothing when neither can name a rhythm', () => {
    expect(nextInSeries(DIARY, ['2026-10-08T09:30'])).toBeNull();
    expect(nextInSeries(DIARY)).toBeNull();
  });
});
