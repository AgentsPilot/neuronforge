/**
 * The hours a person can actually pick.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `computeOpenTime` says when the business is open and not already busy, as
 * clock ranges. This turns that into discrete starts — the grid in the booking
 * dialog, and the list a client sees on the public page.
 *
 * Two rules carry the weight:
 *
 *   · the whole service must fit before the window closes, or a 60-minute
 *     booking is offered at 16:30 against a 17:00 close;
 *   · the wall clock resolves in the BUSINESS's zone, not the server's. On
 *     Vercel the server is UTC, so a business open at 09:00 in New York would
 *     otherwise publish slots at 09:00 UTC — 05:00 in its own reception.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { slotsInWindows } from '@/lib/scheduling/openTime';

const JERUSALEM = 'Asia/Jerusalem';
const NEW_YORK = 'America/New_York';
const DATE = '2026-10-19';

/** What the owner would read on their own clock. */
const asLocal = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));

const startsIn = (timeZone: string, windows: Array<{ start: string; end: string }>, durationMinutes = 60, stepMinutes = 30) =>
  slotsInWindows({ date: DATE, windows, timeZone, durationMinutes, stepMinutes }).map(s =>
    asLocal(s.start, timeZone)
  );

describe('stepping through a window', () => {
  it('offers a start every half hour', () => {
    expect(startsIn(JERUSALEM, [{ start: '09:00', end: '12:00' }])).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
    ]);
  });

  it('stops when the service no longer fits', () => {
    /*
     * The last start is 11:00, not 11:30: a 60-minute service beginning at
     * 11:30 would run past the 12:00 close.
     */
    const starts = startsIn(JERUSALEM, [{ start: '09:00', end: '12:00' }]);

    expect(starts).not.toContain('11:30');
    expect(starts[starts.length - 1]).toBe('11:00');
  });

  it('respects the step it is given', () => {
    expect(startsIn(JERUSALEM, [{ start: '09:00', end: '11:00' }], 60, 60)).toEqual([
      '09:00',
      '10:00',
    ]);
  });

  it('keeps a half-past start available, which is what closes awkward gaps', () => {
    /*
     * Stepping is independent of duration on purpose. A 90-minute gap from
     * 10:30 has no 60-minute booking that fits if starts only land on the hour.
     */
    expect(startsIn(JERUSALEM, [{ start: '10:30', end: '11:30' }])).toEqual(['10:30']);
  });
});

describe('a day in pieces', () => {
  it('walks every window', () => {
    const starts = startsIn(JERUSALEM, [
      { start: '09:00', end: '10:00' },
      { start: '14:00', end: '15:00' },
    ]);

    expect(starts).toEqual(['09:00', '14:00']);
  });

  it('offers nothing for a window shorter than the service', () => {
    expect(startsIn(JERUSALEM, [{ start: '09:00', end: '09:30' }])).toEqual([]);
  });

  it('offers nothing when the day has no free time at all', () => {
    expect(startsIn(JERUSALEM, [])).toEqual([]);
  });
});

describe('the business clock, not the server\'s', () => {
  it('a New York business opens at 09:00 in New York', () => {
    /*
     * The failure this prevents is silent and total: every client is shown a
     * different wrong hour, and nothing errors. 09:00 in New York is 13:00 UTC
     * in October — so a server-zone conversion would publish 09:00 UTC, which
     * that business reads as 05:00.
     */
    const [first] = slotsInWindows({
      date: DATE,
      windows: [{ start: '09:00', end: '12:00' }],
      timeZone: NEW_YORK,
      durationMinutes: 60,
    });

    expect(asLocal(first.start, NEW_YORK)).toBe('09:00');
    expect(first.start).toBe('2026-10-19T13:00:00.000Z');
  });

  it('and a Jerusalem business opens at 09:00 in Jerusalem', () => {
    const [first] = slotsInWindows({
      date: DATE,
      windows: [{ start: '09:00', end: '12:00' }],
      timeZone: JERUSALEM,
      durationMinutes: 60,
    });

    expect(first.start).toBe('2026-10-19T06:00:00.000Z');
  });

  it('the end carries the duration, not the window', () => {
    const [first] = slotsInWindows({
      date: DATE,
      windows: [{ start: '09:00', end: '17:00' }],
      timeZone: JERUSALEM,
      durationMinutes: 45,
    });

    expect(asLocal(first.end, JERUSALEM)).toBe('09:45');
  });
});

describe('a service with no length', () => {
  it('produces nothing rather than looping for ever', () => {
    /* `durationMinutes: 0` would step zero minutes at a time. */
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '17:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 0,
      })
    ).toEqual([]);
  });
});

describe('every slot starts available', () => {
  it('because what is busy is subtracted by the caller', () => {
    /*
     * This function knows only the open windows. Real bookings come from
     * `busyMeetings`, which reads `scheduling_meetings` — the table that holds
     * the time since the meeting was separated from the booking.
     */
    const slots = slotsInWindows({
      date: DATE,
      windows: [{ start: '09:00', end: '11:00' }],
      timeZone: JERUSALEM,
      durationMinutes: 60,
    });

    expect(slots.every(s => s.available)).toBe(true);
  });
});

describe('the step, which is the appointment\'s own length unless asked otherwise', () => {
  it('offers a 60-minute service on the hour', () => {
    /*
     * The default was a fixed 30, which produced a column of times half an
     * hour apart for an hour-long service — and that is how it was read. The
     * tests below pass `stepMinutes: 30` explicitly because they are about the
     * past filter, not about the step.
     */
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '12:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 60,
      }).map(s => asLocal(s.start, JERUSALEM))
    ).toEqual(['09:00', '10:00', '11:00']);
  });
});

describe('hours that have already gone', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The booking dialog offered 09:00, 09:30, 10:00, 10:30 and 11:00 at twenty
   * past eleven. The server refuses a booking in the past, so each of those was
   * a click that could only end in a refusal — and the day counts on the strip
   * were wrong by the same amount: "6 free" for a day with two hours left.
   *
   * The suggestions already filtered the past and the grid did not, which is
   * the two-opinions problem this module exists to prevent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const at = (clock: string) => new Date(`${DATE}T${clock}:00+03:00`);

  it('are dropped when the caller says where now is', () => {
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '13:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 60,
        stepMinutes: 30,
        notBefore: at('11:12'),
      }).map(s => asLocal(s.start, JERUSALEM))
    ).toEqual(['11:30', '12:00']);
  });

  it('and kept when it does not', () => {
    /* A report asking what a day's shape WAS must not have the past removed. */
    expect(startsIn(JERUSALEM, [{ start: '09:00', end: '13:00' }])).toContain('09:00');
  });

  it('a start exactly now has already started', () => {
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '11:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 60,
        stepMinutes: 30,
        notBefore: at('09:00'),
      }).map(s => asLocal(s.start, JERUSALEM))
    ).toEqual(['09:30', '10:00']);
  });

  it('a whole day behind the clock offers nothing', () => {
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '17:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 60,
        notBefore: at('23:00'),
      })
    ).toEqual([]);
  });

  it('and a day still ahead of it is untouched', () => {
    /* Tomorrow's grid is whole: the cut applies to instants, not to the date
       the caller asked about. */
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '12:00' }],
        timeZone: JERUSALEM,
        durationMinutes: 60,
        stepMinutes: 30,
        notBefore: new Date(`${DATE}T00:00:00+03:00`),
      }).map(s => asLocal(s.start, JERUSALEM))
    ).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('is applied on the business clock, not the reader’s', () => {
    /*
     * The same instant, a business in New York. 11:12 in Jerusalem is 04:12
     * there, so a New York day opening at 09:00 has lost nothing.
     */
    expect(
      slotsInWindows({
        date: DATE,
        windows: [{ start: '09:00', end: '11:00' }],
        timeZone: NEW_YORK,
        durationMinutes: 60,
        stepMinutes: 30,
        notBefore: at('11:12'),
      }).map(s => asLocal(s.start, NEW_YORK))
    ).toEqual(['09:00', '09:30', '10:00']);
  });
});
