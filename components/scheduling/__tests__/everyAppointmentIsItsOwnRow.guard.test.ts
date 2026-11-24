/**
 * A package's sessions are separate rows, in both views of the calendar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * Paging the calendar's LIST from "Nov 23 — Nov 29" to "Nov 30 — Dec 6":
 *
 *   · the cards did not change. Two of them still read Tue, Nov 24, under a
 *     heading announcing the following week
 *   · two rows showed Mon, Nov 30, 9:00 AM — the same hour twice, for sessions
 *     an hour apart
 *   · every count above read 0 — All (0), Confirmed (0), Cancelled (0) — over
 *     four visible cards
 *   · and "No bookings yet" was drawn underneath them
 *
 * Four symptoms, one cause, and none of them is a filter. The counts and the
 * week filter were right all along; the DOM was not being replaced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY: ONE BOOKING ROW, MANY APPOINTMENTS
 *
 * A package holds its sessions in `scheduling_meetings` and its purchase in a
 * single `scheduling_bookings` row. The calendar expands that into one entry
 * per meeting by spreading the booking and overriding the time — so `id` is the
 * SAME string on every session of the package.
 *
 * Keyed on `booking.id`, React sees three children with one key. It then reuses
 * nodes across renders rather than replacing them, which is exactly the list
 * above: stale cards surviving a week change, two rows claiming one hour, and
 * freshly-computed counts disagreeing with what is on screen.
 *
 * `appointment_key` — the meeting's own id — exists for this. The GRID was
 * fixed first and carries its own note saying duplicate keys "left filtered
 * blocks on screen". The list was missed, so the same defect survived in one of
 * the two views for as long as the other one was fixed.
 *
 * Asserted at source because it is a one-token mistake that no render test of
 * a single booking can reach: it needs a PACKAGE, two sessions, and a week
 * change, and it shows up as stale pixels rather than as wrong data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const CALENDAR = 'components/scheduling/SchedulingCalendarView.tsx';
const DIALOG = 'components/business-os/SchedulingDialog.tsx';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('both views key on the appointment', () => {
  const calendar = code(read(CALENDAR));

  it('never keys a rendered appointment on the booking alone', () => {
    /*
     * The whole bug in one token. Any `key={booking.id}` in this file is a
     * package rendering its sessions under one key again.
     */
    expect(calendar).not.toContain('key={booking.id}');
  });

  it('keys on appointment_key, falling back to the id', () => {
    /* Two call sites: the grid and the list. The fallback matters for an
       ordinary booking, which has one appointment and no meeting row. */
    const keyed = calendar.match(
      /key=\{\(booking as \{ appointment_key\?: string \}\)\.appointment_key \?\? booking\.id\}/g
    );

    expect(keyed ?? []).toHaveLength(2);
  });

  it('and the expansion gives every meeting one of its own', () => {
    /*
     * The key has to be unique per MEETING, not per booking. The fallback
     * string exists for a meeting row with no id — older data — and still
     * differs per session because the start time is in it.
     */
    expect(calendar).toContain('appointment_key: meeting.id ?? `${booking.id}:${meeting.start_time}`');
    /* And a booking with no meetings keeps its own id, which is unique
       because there is exactly one appointment on it. */
    expect(calendar).toContain('appointment_key: booking.id');
  });
});

describe('the week filter and the counts stay honest', () => {
  const calendar = code(read(CALENDAR));

  it('the list renders the week it is headed by', () => {
    /*
     * `weekBookings` is `getWeekBookings()`, which filters on the business
     * clock's date key. It was never the faulty half — a list rendering some
     * other array would be a different bug with the same symptom, so it is
     * pinned here beside the key.
     */
    expect(calendar).toContain('{weekBookings.map(booking => {');
    expect(calendar).toMatch(/const weekBookings = getWeekBookings\(\);/);
  });

  it('and the counts are taken from the same week', () => {
    /* The chips read 0 over four cards. The counts were right; this keeps
       them derived from the week rather than from the fetch. */
    expect(calendar).toMatch(/const inWeek =[\s\S]{0,200}weekDates\[0\]/);
  });
});

describe('the week on screen is the week that answers', () => {
  const dialog = code(read(DIALOG));

  it('a response for another week is dropped, not rendered', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE OTHER HALF OF THE SAME REPORT: "they show and disappear in a sec".
     *
     * Paging puts two requests in flight, and development fires every effect
     * twice so there are two on the first paint as well. Nothing sequenced
     * them: the state was written by whichever response the network returned
     * last.
     *
     * When that was the PREVIOUS week's, the week on screen emptied itself a
     * moment after filling — the stale payload is trimmed to its own week and
     * therefore holds nothing for this one.
     *
     * It bites hardest on a package, which arrives as ONE booking carrying its
     * meetings: losing that row loses every session of the week at once.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(dialog).toContain('const stillWanted =');
    expect(dialog).toMatch(/calendarWeek\.current\?\.from === week\.from/);
    expect(dialog).toContain('if (!stillWanted) return;');
  });

  it('and the guard runs BEFORE the state is written', () => {
    /* After it, the stale answer would already be on screen. */
    const fetcher = dialog.slice(
      dialog.indexOf('const fetchCalendarWeek'),
      dialog.indexOf('const handleWeekChange')
    );

    expect(fetcher.indexOf('if (!stillWanted) return;')).toBeLessThan(
      fetcher.indexOf('setCalendarBookings(')
    );
  });

  it('with the week recorded before the request goes out', () => {
    /* `calendarWeek.current` is what the guard compares against, so it has to
       be assigned synchronously by the caller rather than awaited. */
    expect(dialog).toMatch(/calendarWeek\.current = week;[\s\S]{0,200}fetchCalendarWeek\(week\)/);
  });
});
