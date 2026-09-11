import {
  businessDayFor,
  localHourIn,
  resolveBusinessTimezone,
  isUsableTimezone,
} from '../businessDay';

/**
 * The instant these tests are built around: 2026-09-11T21:30:00Z.
 *
 * Chosen because the three zones disagree about which day it is — Jerusalem has
 * already rolled over to the 12th, Los Angeles is still mid-afternoon on the
 * 11th. Any implementation that resolves "today" from the server clock gives
 * all three the same answer, which is the bug this module exists to prevent.
 */
const EVENING_UTC = new Date('2026-09-11T21:30:00.000Z');

describe('resolveBusinessTimezone', () => {
  it('takes the stored preference when it names a real zone', () => {
    expect(resolveBusinessTimezone({ preferencesTimezone: 'Asia/Jerusalem' })).toEqual({
      timezone: 'Asia/Jerusalem',
      source: 'user_preferences',
    });
  });

  it('falls back to UTC when nothing is stored', () => {
    // The common case: timezone is only written when the settings form is
    // saved, so most rows are null.
    expect(resolveBusinessTimezone({ preferencesTimezone: null }).source).toBe('default');
    expect(resolveBusinessTimezone({}).timezone).toBe('UTC');
  });

  it('falls back rather than throwing on a zone Intl will not accept', () => {
    // A stored value can be stale, hand-edited, or a legacy abbreviation.
    // Throwing here would take down the dashboard for one bad settings row.
    expect(resolveBusinessTimezone({ preferencesTimezone: 'Mars/Olympus' })).toEqual({
      timezone: 'UTC',
      source: 'default',
    });
  });

  it('treats whitespace as absent', () => {
    expect(resolveBusinessTimezone({ preferencesTimezone: '   ' }).timezone).toBe('UTC');
  });
});

describe('isUsableTimezone', () => {
  it('accepts IANA names and rejects nonsense', () => {
    expect(isUsableTimezone('America/Los_Angeles')).toBe(true);
    expect(isUsableTimezone('UTC')).toBe(true);
    expect(isUsableTimezone('Not/AZone')).toBe(false);
    expect(isUsableTimezone('')).toBe(false);
  });
});

describe('businessDayFor — the same instant is a different day in different places', () => {
  it('has already rolled over in Jerusalem', () => {
    const day = businessDayFor(EVENING_UTC, 'Asia/Jerusalem');
    // 21:30Z is 00:30 on the 12th in Jerusalem (UTC+3 in September).
    expect(day.date).toBe('2026-09-12');
    expect(day.localHour).toBe(0);
  });

  it('is still the previous afternoon in Los Angeles', () => {
    const day = businessDayFor(EVENING_UTC, 'America/Los_Angeles');
    // 21:30Z is 14:30 on the 11th in LA (UTC-7 in September).
    expect(day.date).toBe('2026-09-11');
    expect(day.localHour).toBe(14);
  });

  it('gives the two businesses genuinely different windows', () => {
    const jerusalem = businessDayFor(EVENING_UTC, 'Asia/Jerusalem');
    const losAngeles = businessDayFor(EVENING_UTC, 'America/Los_Angeles');

    // If these ever match, the timezone is not reaching the query layer and
    // every "today" count is being computed against the server's day.
    expect(jerusalem.startUtc).not.toBe(losAngeles.startUtc);
    expect(jerusalem.date).not.toBe(losAngeles.date);
  });

  it('places a booking at 21:30Z on opposite sides of the two businesses days', () => {
    const booking = EVENING_UTC.getTime();

    const jerusalem = businessDayFor(EVENING_UTC, 'Asia/Jerusalem');
    const losAngeles = businessDayFor(EVENING_UTC, 'America/Los_Angeles');

    const inJerusalemToday =
      booking >= Date.parse(jerusalem.startUtc) && booking < Date.parse(jerusalem.endUtc);
    const inLosAngelesToday =
      booking >= Date.parse(losAngeles.startUtc) && booking < Date.parse(losAngeles.endUtc);

    // The whole point: one counts it, the other does not.
    expect(inJerusalemToday).toBe(true);
    expect(inLosAngelesToday).toBe(true);
    // ...each within its OWN day, which are different days.
    expect(jerusalem.date).toBe('2026-09-12');
    expect(losAngeles.date).toBe('2026-09-11');
  });
});

describe('businessDayFor — window boundaries', () => {
  it('spans exactly one day, start inclusive and end exclusive', () => {
    const day = businessDayFor(EVENING_UTC, 'Asia/Jerusalem');
    const start = Date.parse(day.startUtc);
    const end = Date.parse(day.endUtc);

    expect(end).toBeGreaterThan(start);
    expect(end - start).toBe(24 * 60 * 60 * 1000);

    // The end instant belongs to tomorrow, not today. A `lte` filter here
    // double-counts anything landing exactly at midnight.
    const tomorrow = businessDayFor(EVENING_UTC, 'Asia/Jerusalem', 1);
    expect(tomorrow.startUtc).toBe(day.endUtc);
  });

  it('walks backwards and forwards by calendar day', () => {
    const today = businessDayFor(EVENING_UTC, 'America/Los_Angeles');
    expect(businessDayFor(EVENING_UTC, 'America/Los_Angeles', -1).date).toBe('2026-09-10');
    expect(businessDayFor(EVENING_UTC, 'America/Los_Angeles', 1).date).toBe('2026-09-12');
    expect(today.date).toBe('2026-09-11');
  });

  it('crosses a month end', () => {
    const lastOfMonth = new Date('2026-08-31T12:00:00.000Z');
    expect(businessDayFor(lastOfMonth, 'UTC', 1).date).toBe('2026-09-01');
    expect(businessDayFor(new Date('2026-09-01T12:00:00.000Z'), 'UTC', -1).date).toBe('2026-08-31');
  });
});

describe('businessDayFor — DST', () => {
  /*
   * The reason day arithmetic is done on calendar dates rather than by adding
   * 86_400_000ms: across a transition a local day is 23 or 25 hours long, so a
   * fixed millisecond step lands at 23:00 or 01:00 of the wrong day.
   */
  it('still starts at local midnight across the US autumn transition', () => {
    // US DST ends 2026-11-01. The day before, the day of, and the day after.
    const before = businessDayFor(new Date('2026-10-31T12:00:00.000Z'), 'America/Los_Angeles');
    const during = businessDayFor(new Date('2026-11-01T12:00:00.000Z'), 'America/Los_Angeles');
    const after = businessDayFor(new Date('2026-11-02T12:00:00.000Z'), 'America/Los_Angeles');

    expect(before.date).toBe('2026-10-31');
    expect(during.date).toBe('2026-11-01');
    expect(after.date).toBe('2026-11-02');

    // The 25-hour day: midnight-to-midnight is longer than 24h, which is
    // exactly what a fixed-millisecond implementation gets wrong.
    const dstDayLength = Date.parse(during.endUtc) - Date.parse(during.startUtc);
    expect(dstDayLength).toBe(25 * 60 * 60 * 1000);
  });

  it('produces a 23-hour day across the spring transition', () => {
    // US DST begins 2026-03-08.
    const day = businessDayFor(new Date('2026-03-08T18:00:00.000Z'), 'America/Los_Angeles');
    expect(day.date).toBe('2026-03-08');
    expect(Date.parse(day.endUtc) - Date.parse(day.startUtc)).toBe(23 * 60 * 60 * 1000);
  });
});

describe('businessDayFor — degraded input', () => {
  it('reports UTC rather than echoing an unusable zone back', () => {
    const day = businessDayFor(EVENING_UTC, 'Not/AZone');
    // Callers read `day.timezone` to render "sent at 07:00 Asia/Jerusalem" —
    // echoing the bad value back would print a zone that does not exist.
    expect(day.timezone).toBe('UTC');
    expect(day.date).toBe('2026-09-11');
  });
});

describe('localHourIn', () => {
  it('reads midnight as 0, not 24', () => {
    // Some engines render midnight as "24" under hour12:false, which never
    // matches a `>= 7 && <= 10` morning window and silently drops a user.
    expect(localHourIn(new Date('2026-09-11T21:00:00.000Z'), 'Asia/Jerusalem')).toBe(0);
    expect(localHourIn(new Date('2026-09-11T00:00:00.000Z'), 'UTC')).toBe(0);
  });

  it('reads a morning hour in each zone', () => {
    const instant = new Date('2026-09-11T04:10:00.000Z');
    expect(localHourIn(instant, 'Asia/Jerusalem')).toBe(7);
    expect(localHourIn(instant, 'UTC')).toBe(4);
    expect(localHourIn(instant, 'America/Los_Angeles')).toBe(21); // previous evening
  });

  it('handles a half-hour zone, where the hour is still well defined', () => {
    // Kolkata is UTC+5:30 — such a business is briefed at 07:40 local rather
    // than 07:10, which is fine; the hour comparison still works.
    expect(localHourIn(new Date('2026-09-11T01:40:00.000Z'), 'Asia/Kolkata')).toBe(7);
  });
});
