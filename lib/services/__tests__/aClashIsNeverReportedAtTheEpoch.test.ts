/**
 * A refused booking names the hour it clashes with, or no hour at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER WAS TOLD
 *
 * Booking from the calendar, Tuesday 10 November at 10:00. Service chosen,
 * client chosen, and on Create:
 *
 *     This time overlaps an existing booking at 1970-01-01T00:00:00.000Z
 *
 * The refusal was correct — 10:00 really was taken, and the public booking page
 * for that day correctly starts its list at 11:30. Only the sentence was
 * nonsense, and a correct refusal wearing a 1970 date reads as a broken system
 * rather than a busy diary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE EPOCH CAME FROM
 *
 * `checkOverlap` finds the busy MEETINGS, then returns their parent BOOKINGS.
 * A package's container booking carries no `start_time` of its own — the hours
 * live on its sessions — so the clash found on a session was reported with the
 * container's absent time, and `new Date(null).toISOString()` prints the epoch
 * without complaining.
 *
 * Two fixes, because either alone leaves a hole:
 *
 *   · the repository substitutes the clashing SESSION's hour where the booking
 *     has none, so there is something true to say;
 *   · the message formats defensively, so anything still unusable yields NO
 *     time rather than a wrong one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SERVICE = 'lib/services/BookingLifecycleService.ts';
const REPOSITORY = 'lib/repositories/SchedulingRepository.ts';

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

const service = read(SERVICE);
const repository = read(REPOSITORY);

/** Comments stripped: they quote the very string this file forbids. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** `clashingHour`, lifted from the source so the real rule is exercised. */
const clashingHour = (() => {
  const from = service.indexOf('function clashingHour');
  /* To the function's own closing brace, not to whatever comes next in the
     file — the slice used to swallow the module's other declarations. */
  const to = service.indexOf('\n}\n', from) + 3;
  const body = service.slice(from, to);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(
    `${body.replace(/: unknown/, '').replace(/: string/g, '')}; return clashingHour;`
  )() as (v: unknown) => string;
})();

describe('the value that produced 1970', () => {
  it.each([null, undefined, '', '   '])('gives no hour for %p', value => {
    /*
     * THE BUG, AS ONE ASSERTION. A package container's `start_time` is null,
     * and every one of these used to format as the Unix epoch.
     */
    expect(clashingHour(value)).toBe('');
  });

  it('gives no hour for something that is not a date', () => {
    expect(clashingHour('not a date')).toBe('');
    expect(clashingHour(0)).toBe('');
  });

  it('never yields the epoch, whatever it is given', () => {
    for (const value of [null, undefined, '', 0, false, {}, [], 'x']) {
      expect(clashingHour(value)).not.toContain('1970');
    }
  });
});

describe('a real hour is still named', () => {
  it('reads back the time it was given', () => {
    expect(clashingHour('2026-11-10T08:00:00.000Z')).toBe(' at 2026-11-10T08:00:00.000Z');
  });

  it('leads with a space, so the sentence reads without one baked in', () => {
    /* The caller writes "overlaps an existing booking${hour}" — the space has
       to travel with the hour, or the two run together. */
    expect(clashingHour('2026-11-10T08:00:00.000Z').startsWith(' at ')).toBe(true);
  });
});

describe('both messages go through it', () => {
  it('the create path', () => {
    expect(code(service)).toContain(
      'This time overlaps an existing booking${clashingHour(conflict.start_time)}'
    );
  });

  it('the reschedule path', () => {
    expect(code(service)).toContain(
      'That time overlaps an existing booking${clashingHour(clash.start_time)}'
    );
  });

  it('and neither formats a date directly any more', () => {
    expect(code(service)).not.toMatch(/overlaps an existing booking at \$\{new Date/);
  });
});

describe('the repository gives the message something true to say', () => {
  it('fetches the clashing session’s own hour', () => {
    /* Selecting only `booking_id` is what left the caller with nothing but a
       container that has no time. */
    expect(code(repository)).toContain("select('booking_id, start_time, end_time')");
  });

  it('substitutes it only where the booking has no hour of its own', () => {
    /* A booking WITH a start_time is its own appointment and already correct;
       overwriting it would report the wrong clash. */
    const fn = code(repository).slice(
      code(repository).indexOf('async checkOverlap'),
      code(repository).indexOf('async checkOverlap') + 4000
    );

    expect(fn).toContain('if (row.start_time) return booking;');
    expect(fn).toContain('session.start_time');
  });
});
