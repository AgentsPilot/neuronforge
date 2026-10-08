/**
 * A date on the client's portal is the same day the owner's screen says.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `formatPublicDate` took no zone, so every portal surface but one printed the
 * READER's device clock. The business side formats everything through
 * `timeZoneOptions`, which pins the business zone. Those two disagree for any
 * appointment within a few hours of midnight: the contact drawer said 6
 * November and the client's portal said 5 November, for one booking.
 *
 * Worse on a single screen. `AppointmentCard` formatted the TIME with the
 * business zone and the DATE without it, so the card named the right hour on
 * the wrong day — the one shape of this bug nobody questions, because the time
 * looks correct.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TESTS PASS BOTH ZONES EXPLICITLY
 *
 * Never the runner's. A test that leaned on `TZ` would pass in Israel and fail
 * in CI, which is the same class of bug it is here to catch.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { formatPublicDate } from '@/lib/i18n/public-pages';

/**
 * 00:30 on 6 November, Israel time — written as the instant it is.
 *
 * Chosen because the day differs by zone: it is still the 5th across the
 * Atlantic. An afternoon appointment would pass this test no matter how badly
 * the zone were handled, which is why the fixture is half past midnight.
 */
const JUST_AFTER_MIDNIGHT = new Date('2026-11-05T22:30:00Z');

const DAY_ONLY = { day: 'numeric', month: 'long', year: 'numeric' } as const;

/*
 * Asserted as whole strings, not with `toContain`.
 *
 * `toContain('6')` passes against "November 5, 2026" — the year supplies the
 * digit. That cost a red run here, and as a standing assertion it would have
 * been worse than no test: green whichever day it printed.
 */
describe('an instant is dated on the clock it is given', () => {
  it('reads as 6 November on the business clock', () => {
    expect(formatPublicDate(JUST_AFTER_MIDNIGHT, 'en', DAY_ONLY, 'Asia/Jerusalem')).toBe(
      'November 6, 2026'
    );
  });

  it('reads as 5 November on a reader clock west of it', () => {
    /*
     * The bug, stated as a passing assertion. This is what the client saw: the
     * same booking, a day earlier, because their phone was in New York.
     */
    expect(formatPublicDate(JUST_AFTER_MIDNIGHT, 'en', DAY_ONLY, 'America/New_York')).toBe(
      'November 5, 2026'
    );
  });

  it('formats Hebrew on the business clock too', () => {
    // The locale the portal actually runs in for this business.
    const he = formatPublicDate(JUST_AFTER_MIDNIGHT, 'he', DAY_ONLY, 'Asia/Jerusalem');

    expect(he).toBe('6 בנובמבר 2026');
  });
});

describe('the zone argument wins over one hidden in the options', () => {
  it('overrides options.timeZone', () => {
    /*
     * Applied last, deliberately — the same rule `timeZoneOptions` states on
     * the business side. A caller that has an explicit zone to pass should not
     * be quietly overruled by a stale one left in an options object.
     */
    const out = formatPublicDate(
      JUST_AFTER_MIDNIGHT,
      'en',
      { ...DAY_ONLY, timeZone: 'America/New_York' },
      'Asia/Jerusalem'
    );

    expect(out).toBe('November 6, 2026');
  });

  it('still honours options.timeZone when no argument is given', () => {
    // Backwards compatible: the one call site that already passed the zone this
    // way — the reschedule page — must keep working untouched.
    const out = formatPublicDate(JUST_AFTER_MIDNIGHT, 'en', {
      ...DAY_ONLY,
      timeZone: 'Asia/Jerusalem',
    });

    expect(out).toBe('November 6, 2026');
  });
});

describe('a bare SQL DATE is read on UTC, not on the business clock', () => {
  /**
   * `due_date` is a DATE: a day, with no time and no zone. It parses to
   * midnight UTC, and midnight is the most fragile instant there is.
   */
  const DUE = new Date('2026-11-05');

  it('is the 5th when read as UTC', () => {
    expect(formatPublicDate(DUE, 'en', { day: 'numeric', month: 'long' }, 'UTC')).toBe(
      'November 5'
    );
  });

  it('slips to the 4th when read west of UTC', () => {
    /*
     * Why `AppointmentCard` pins 'UTC' for the due date while pinning the
     * BUSINESS zone for the appointment. The two look like the same fix and are
     * not: an instant belongs on the business's clock, a calendar day belongs
     * on the clock it was written as, and using either rule for both is wrong
     * half the time.
     */
    expect(
      formatPublicDate(DUE, 'en', { day: 'numeric', month: 'long' }, 'America/New_York')
    ).toBe('November 4');
  });
});

describe('nothing is formatted at all without a usable date', () => {
  it('returns empty for an unparseable value', () => {
    // A row with a null start time reaches the portal; it must not print
    // "Invalid Date" to a client.
    expect(formatPublicDate('not a date', 'en', DAY_ONLY, 'Asia/Jerusalem')).toBe('');
  });
});
