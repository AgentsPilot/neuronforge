/**
 * An appointment on another day does not block this day's hours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `generateTimeSlots` decides whether a slot is taken by comparing hours and
 * minutes — a slot is a wall-clock time, and `businessClock` answers in exactly
 * that form. What it does not answer is WHICH DAY, and nothing asked.
 *
 * While every caller passed one day's bookings that was invisible. The portal's
 * reschedule diary passes a whole month's in a single call, on the stated
 * reasoning that "an appointment three weeks away cannot overlap" a day's own
 * windows. It can: the comparison never looked at the date, so a 10:00
 * appointment on the 25th blocked the 10:00 slot on every day in the sweep.
 * Around 38 appointments spread over a month covered 09:00-17:00 between them,
 * so every working day reported nothing free and a client who had just had a
 * booking cancelled found the entire month greyed out with no way to rebook.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *
 * The invariant, not the arithmetic: asking with a WIDE busy list must give the
 * same answer as asking with only that day's rows. That is the assumption both
 * call sites already make, and the one that was silently false. Anything that
 * reintroduces a date-blind comparison fails here.
 *
 * The overnight and straddling cases are pinned too, because the cheap fix for
 * the above — an equality test on the start date — would quietly put those
 * hours back on sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateTimeSlots } from '@/lib/scheduling/availableSlots';

const WINDOW = [{ start: '09:00', end: '17:00' }];
const TZ = 'UTC';

/* Far enough ahead that "is the slot in the past" never enters into it. */
const DAY = '2099-03-12';
const OTHER_DAY = '2099-03-26';

const hourOn = (date: string, from: string, to: string) => ({
  start_time: `${date}T${from}:00:00.000Z`,
  end_time: `${date}T${to}:00:00.000Z`,
});

describe('a busy hour belongs to its own day', () => {
  it('ignores an appointment on a different date', () => {
    const free = generateTimeSlots(DAY, WINDOW, 60, [], [], TZ).length;
    expect(free).toBeGreaterThan(0);

    const withElsewhere = generateTimeSlots(
      DAY,
      WINDOW,
      60,
      [hourOn(OTHER_DAY, '10', '11')],
      [],
      TZ
    );

    expect(withElsewhere).toHaveLength(free);
    expect(withElsewhere.some(slot => slot.start_time === `${DAY}T10:00:00`)).toBe(true);
  });

  it('still takes the hour when the appointment IS on this day', () => {
    const free = generateTimeSlots(DAY, WINDOW, 60, [], [], TZ).length;

    const withToday = generateTimeSlots(DAY, WINDOW, 60, [hourOn(DAY, '10', '11')], [], TZ);

    expect(withToday.length).toBeLessThan(free);
    expect(withToday.some(slot => slot.start_time === `${DAY}T10:00:00`)).toBe(false);
  });

  /*
   * THE INVARIANT. This is the one that would have caught the bug: the sweep
   * hands over a month, and must be told what the single day would have said.
   */
  it('answers a month-wide list exactly as it answers that day alone', () => {
    const wholeMonth = [
      hourOn(DAY, '10', '11'),
      hourOn('2099-03-02', '09', '10'),
      hourOn('2099-03-05', '11', '12'),
      hourOn('2099-03-18', '12', '13'),
      hourOn(OTHER_DAY, '13', '14'),
      hourOn('2099-03-30', '14', '15'),
      hourOn('2099-03-31', '15', '16'),
    ];

    const fromWide = generateTimeSlots(DAY, WINDOW, 60, wholeMonth, [], TZ);
    const fromDay = generateTimeSlots(DAY, WINDOW, 60, [hourOn(DAY, '10', '11')], [], TZ);

    expect(fromWide.map(s => s.start_time)).toEqual(fromDay.map(s => s.start_time));
    /* And the day is not wiped out, which is what the bug actually did. */
    expect(fromWide.length).toBeGreaterThan(0);
  });

  it('applies the same rule to external calendar events', () => {
    const free = generateTimeSlots(DAY, WINDOW, 60, [], [], TZ).length;

    const elsewhere = generateTimeSlots(DAY, WINDOW, 60, [], [hourOn(OTHER_DAY, '10', '11')], TZ);
    expect(elsewhere).toHaveLength(free);

    const here = generateTimeSlots(DAY, WINDOW, 60, [], [hourOn(DAY, '10', '11')], TZ);
    expect(here.length).toBeLessThan(free);
  });

  /*
   * An equality test on the start date would pass everything above and break
   * these two: hours of THIS day are genuinely occupied by a span that began
   * before it.
   */
  it('keeps an overnight appointment blocking the morning it runs into', () => {
    const overnight = {
      start_time: '2099-03-11T22:00:00.000Z',
      end_time: `${DAY}T10:00:00.000Z`,
    };

    const slots = generateTimeSlots(DAY, WINDOW, 60, [overnight], [], TZ);

    expect(slots.some(slot => slot.start_time === `${DAY}T09:00:00`)).toBe(false);
    /* and the rest of the day is still for sale */
    expect(slots.some(slot => slot.start_time === `${DAY}T11:00:00`)).toBe(true);
  });

  it('keeps a multi-day event blocking a day it straddles entirely', () => {
    const away = {
      start_time: '2099-03-10T00:00:00.000Z',
      end_time: '2099-03-14T23:59:00.000Z',
    };

    expect(generateTimeSlots(DAY, WINDOW, 60, [], [away], TZ)).toHaveLength(0);
  });
});
