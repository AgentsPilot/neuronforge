/**
 * The calendar asks one question, on one clock, with one boundary.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW, OVER THREE SITTINGS
 *
 *   · "week of Nov 23 — Nov 29 shows the meetings; moving to the next week,
 *     they are gone"
 *   · "they show and disappear in a sec" — on Nov 30, then on Dec 7, then on
 *     the week after that
 *   · and once the rows stayed: "now it shows the meetings but without the
 *     chips filters"
 *
 * Four diagnoses were written and thrown away before the shape of it was clear,
 * because each symptom looks like its own bug. They are one bug, and it is not
 * a filter, a key, or a race. THE GRID AND ITS NEIGHBOURS WERE ASKING THREE
 * DIFFERENT QUESTIONS ABOUT WHAT "THIS WEEK" MEANS.
 *
 *   the columns      which business DAY is this, by date key
 *   the fetch        which INSTANTS, from two browser-local midnights
 *   the chip counts  which INSTANTS, from `weekDates[0]` — not a midnight at
 *                    all, because `getStartOfWeek` carried the time of day it
 *                    was called at
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE FAULTS, AND WHY EACH ONE HID THE OTHERS
 *
 * 1. `timezone` is a GUESS until the owner's preferences arrive — the browser's
 *    zone, declared as such where it is initialised. The grid re-renders when
 *    the real one lands. The fetch effect did not, because it watched
 *    `currentWeek` alone. So the first request was made for the guessed week
 *    and never corrected: rows appeared, the real zone arrived a second later,
 *    the columns moved under them, and what had been fetched no longer belonged
 *    to the week on screen. That is the "disappear in a sec", exactly.
 *
 *    Measured on the reporting account: business `Asia/Jerusalem` (UTC+2),
 *    browser UTC+3, which is why the owner read a 07:00Z appointment as 10:00
 *    and the product called it 09:00.
 *
 * 2. The window was built from two BROWSER midnights while the columns were
 *    resolved through the business's zone. Seven hours at each end of the week
 *    were drawn but never fetched.
 *
 * 3. `getStartOfWeek` never zeroed the time. `currentWeek` was "Monday 14:37",
 *    and the chip counter's `when >= weekDates[0]` therefore dropped every
 *    appointment earlier in the day than the moment the screen was opened. A
 *    chip whose count reads zero is not drawn — so a week holding three
 *    appointments showed three cards and no controls above them.
 *
 * Fault 3 was invisible while faults 1 and 2 were removing the rows: you cannot
 * notice a missing count over an empty grid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SUITE PROTECTS
 *
 * Not the three fixes — the ONE RULE they collapse into: every reader of "this
 * week" resolves it the way the columns do. Asserted at source because the
 * failure needs a browser in one zone, a business in another, an appointment
 * before noon and a screen opened after it, and it shows up as missing pixels
 * rather than as a wrong return value.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const CALENDAR = 'components/scheduling/SchedulingCalendarView.tsx';
const DIALOG = 'components/business-os/SchedulingDialog.tsx';
const CONTEXT = 'lib/business-os/LanguageContext.tsx';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the week is a run of business days, and starts at midnight', () => {
  const calendar = code(read(CALENDAR));

  it('the week start carries no time of day', () => {
    /*
     * The whole of fault 3 in one line. Without it `currentWeek` is whatever
     * o'clock the calendar was opened at, and every instant comparison against
     * it silently excludes that morning.
     */
    const fn = calendar.slice(
      calendar.indexOf('function getStartOfWeek'),
      calendar.indexOf('function getWeekDates')
    );

    expect(fn).toContain('d.setHours(0, 0, 0, 0);');
    /* Before the day arithmetic, or the branches below read a stale field. */
    expect(fn.indexOf('d.setHours(0, 0, 0, 0);')).toBeLessThan(fn.indexOf('const day = d.getDay();'));
  });

  it('which calendar day a column means is decided in exactly one place', () => {
    /*
     * It was a function declared 250 lines below the first thing that needed
     * it, so the fetch window could not use it and wrote its own arithmetic.
     * Module level is what makes one rule possible.
     */
    expect(calendar).toContain('const dateKeyOfColumn = (date: Date) =>');
    /* And the in-component helper delegates rather than restating it. */
    expect(calendar).toContain('const columnDateKey = dateKeyOfColumn;');
  });
});

describe('the window fetched is the week drawn', () => {
  const calendar = code(read(CALENDAR));

  const weekEffect = calendar.slice(
    calendar.indexOf('if (!onWeekChange) return;'),
    calendar.indexOf('}, [currentWeek, timezone]);')
  );

  it('is built on the business clock, not from browser midnights', () => {
    expect(weekEffect).toContain("businessInstant(firstKey, '00:00', timezone)");
    expect(weekEffect).toContain("businessInstant(afterLastKey, '00:00', timezone)");
  });

  it('from the same date key the columns use', () => {
    expect(weekEffect).toContain('dateKeyOfColumn(currentWeek)');
    /* Seven days on, by date key — not `setDate(+7)` on an instant, which is
       the browser-local arithmetic this replaced. */
    expect(weekEffect).toContain('shiftBusinessDateKey(firstKey, 7)');
  });

  it('and is re-asked when the clock itself resolves', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * FAULT 1, AND THE ONE LINE THAT FIXES IT.
     *
     * `timezone` opens as the browser's zone and is replaced by the owner's a
     * moment later. Everything that buckets an instant into a day re-runs then.
     * An effect that does not is making a request for a week nobody is looking
     * at any more.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(calendar).toContain('}, [currentWeek, timezone]);');
  });

  it('the synced-calendar overlay asks for that same week', () => {
    /* It read `currentWeek.toISOString()` directly — "Monday 14:37" in the
       browser's zone — so it missed that Monday morning and reached into the
       next Monday afternoon. Two windows for one week is the same fault again. */
    const busy = calendar.slice(
      calendar.indexOf('const fetchExternalBusySlots'),
      calendar.indexOf('}, [currentWeek, externalEventsRefreshTrigger, timezone]);')
    );

    expect(busy).toContain("businessInstant(firstKey, '00:00', timezone)");
    expect(busy).toContain("shiftBusinessDateKey(firstKey, 7)");
    expect(busy).not.toContain('weekEnd.setDate(');
  });
});

describe('the chips count what the grid draws', () => {
  const calendar = code(read(CALENDAR));

  const counter = calendar.slice(
    calendar.indexOf('const outcomeCounts = statusMatched'),
    calendar.indexOf('const weekBookings = getWeekBookings();')
  );

  it('by business date key, the way the columns and the week filter do', () => {
    expect(counter).toContain('businessDateKey(new Date(entry.start_time), timezone)');
    expect(counter).toContain('dateKeyOfColumn(weekDates[0])');
    expect(counter).toContain('dateKeyOfColumn(weekDates[6])');
  });

  it('and never by comparing instants against the week boundary again', () => {
    /*
     * The exact expression that hid three appointments behind no chips. Named
     * so it cannot return: it reads as obviously correct, and is wrong twice
     * over — browser midnights, and not even midnights.
     */
    expect(counter).not.toContain('when >= weekDates[0]');
    expect(counter).not.toMatch(/weekDates\[6\]\.getTime\(\) \+ 24 \* 60 \* 60 \* 1000/);
  });

  it('while the week filter keeps asking it the same way', () => {
    /* The two must agree; this is the half that was already right. */
    const filter = calendar.slice(
      calendar.indexOf('const getWeekBookings = () => {'),
      calendar.indexOf('const getServiceName')
    );

    expect(filter).toContain('businessDateKey(new Date(booking.start_time), timezone)');
    expect(filter).toContain('columnDateKey(weekDates[0])');
  });
});

describe('an unanswered week is not an empty one', () => {
  const calendar = code(read(CALENDAR));
  const dialog = code(read(DIALOG));

  it('the grid is told whether it holds the week it is drawing', () => {
    expect(calendar).toContain('weekSettled?: boolean;');
    /* Settled by default, so the caller that owns all its own rows and passes
       no `onWeekChange` behaves exactly as it always has. */
    expect(calendar).toContain('weekSettled = true');
  });

  it('and says so instead of claiming nothing is booked', () => {
    expect(calendar).toContain("t('scheduling.loading_week')");
    expect(calendar).toContain("t('scheduling.loading_week_desc')");
  });

  it('the owner of the fetch clears it when a new week is asked for', () => {
    expect(dialog).toContain('setCalendarSettled(false);');
    /* And sets it only once the answer for that week is in hand. */
    expect(dialog).toContain('setCalendarSettled(true);');
  });

  it('re-asks even for the week already on screen', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THIS CASE ONCE ASSERTED THE OPPOSITE, AND THAT WAS THE BUG.
     *
     * An early return when the window matched the one on screen looked like a
     * free saving: the effect fires on `timezone` as well as `currentWeek`, and
     * when the guessed zone and the real one agree, the second ask changes
     * nothing.
     *
     * It is also the path a REMOUNT takes. The grid renders behind `loading`,
     * so anything that toggles that flag tears it down and builds it again;
     * the fresh mount asks for its week, the window is unchanged, and the early
     * return meant nothing was fetched. The grid then showed the week exactly
     * as it stood before whatever caused the reload.
     *
     * Reported as "service set from calendar is not presented in the calendar":
     * a 16:00 appointment the server returned, the confirmation mail announced
     * and the booking card displayed, drawn nowhere. The header read 16 over a
     * week holding 17, and Held read 3 of 4.
     *
     * One fetch of one week is cheap. Correctness is not.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(dialog).not.toMatch(
      /\.to === week\.to\) return;/
    );
    /* The comparison survives — it decides the FLASH, not the fetch. */
    expect(dialog).toContain('const sameWeek =');
    expect(dialog).toContain('if (!sameWeek) setCalendarSettled(false);');
  });

  it('and the fetch is reached on every call', () => {
    /* Nothing may stand between the week being recorded and it being asked
       for. `stillWanted` is what makes a duplicate harmless. */
    const handler = dialog.slice(
      dialog.indexOf('const handleWeekChange'),
      dialog.indexOf('const refreshBookingsSilently')
    );

    expect(handler).not.toContain('return;');
    expect(handler).toContain('fetchCalendarWeek(week)');
  });

  it('saving a booking refreshes the week it was made in', () => {
    /*
     * `fetchAllData` reloads `bookings` — the quick picks and the conflict
     * warning — and never touches `calendarBookings`, which is what the grid
     * draws. Used as the save handler, a booking was saved, mailed and listed
     * while the calendar it was made from carried on without it.
     *
     * `refreshBookingsSilently` is the handler the calendar's own actions
     * already use, and it reloads both.
     */
    expect(dialog).toContain('void refreshBookingsSilently();');
    expect(dialog).toMatch(/if \(calendarWeek\.current\) await fetchCalendarWeek\(calendarWeek\.current\);/);
  });

  it('with the temporary diagnostic gone', () => {
    /* It printed every client's appointments to the browser console on every
       week change, and `console`-shaped logging of client data is not a thing
       this product ships (CLAUDE.md rule 3). */
    expect(dialog).not.toContain('CALENDAR WEEK');
  });
});

describe('the clock really does arrive late, which is why all of this matters', () => {
  const context = code(read(CONTEXT));

  it('timezone opens as the browser’s guess', () => {
    expect(context).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
  });

  it('and is replaced once the owner’s preference is read', () => {
    /* If this ever becomes synchronous, the fixes above stay correct and stop
       being load-bearing. If it stays asynchronous — it will, it is a fetch —
       every reader of `timezone` must re-run when it lands. */
    expect(context).toContain('setTimezone(safeTimezone(locale.timezone));');
  });
});

describe('the copy exists in every language', () => {
  it.each(['en', 'he', 'es'])('%s', language => {
    const file = read(`lib/business-os/translations/${language}.ts`);

    for (const key of ['scheduling.loading_week', 'scheduling.loading_week_desc']) {
      expect(file).toContain(key);
    }
  });
});

describe('a blocked hour says what is blocking it', () => {
  const calendar = code(read(CALENDAR));
  const repository = code(read('lib/repositories/ExternalCalendarEventRepository.ts'));

  it('the synced event is read with its name', () => {
    /*
     * `title` sat on `external_calendar_events` from the beginning and no read
     * path selected it, so the diary drew an unexplained grey block over an
     * hour it knew the name of. An owner cannot tell that from a broken grid —
     * and did not.
     */
    expect(repository).toContain("select('start_time, end_time, provider, is_all_day, title')");
    expect(repository).toContain('title: (event.title as string | null) ?? null');
  });

  it('and carried all the way to the block', () => {
    expect(repository).toMatch(/export interface BusySlot \{[\s\S]{0,200}title: string \| null;/);
    expect(calendar).toMatch(/interface ExternalBusySlot \{[\s\S]{0,260}title\?: string \| null;/);
  });

  it('which names the event, its hours and which calendar it came from', () => {
    expect(calendar).toContain("slot.title?.trim() || t('scheduling.busy_untitled')");
    expect(calendar).toContain("t('scheduling.busy_from_google')");
    expect(calendar).toContain("t('scheduling.busy_from_outlook')");
    /* Hours on the business clock, like every other hour on this grid. */
    expect(calendar).toContain('businessClock(new Date(slot.start), timezone)');
  });

  it('the hatched CELL distinguishes its two causes', () => {
    /*
     * A synced event and one of the owner's own appointments behind a chip
     * both wore the word "BUSY". They call for opposite responses: one is
     * elsewhere in your life, the other is a filter you can switch off.
     */
    expect(calendar).toContain('const externalBlockerAt = (date: Date, hour: number)');
    expect(calendar).toContain("t('scheduling.busy_hidden')");
    expect(calendar).toContain("t('scheduling.busy_hidden_hint')");
  });

  it('and the band stays recessive beside a real appointment', () => {
    /*
     * It wore the cell's own diagonal hatch, a full border and two lines of
     * text, the second truncated to a fragment — as loud as the owner's actual
     * work and stacked on a second texture. Reported as "too messy", and the
     * question it prompted was the right one: is this mine or my calendar's.
     *
     * A synced event is the REASON an hour is not free, not work in it. One
     * quiet band, a rule down the leading edge, the name on one line.
     */
    const band = calendar.slice(
      calendar.indexOf('key={`external-${slotIndex}`}'),
      calendar.indexOf('{(() => { const concurrency = layoutConcurrentBookings')
    );

    expect(band).toContain("borderInlineStart: '2px solid rgba(148, 163, 184, 0.5)'");
    /* No second texture: the cell underneath already carries the hatch. */
    expect(band).not.toContain('repeating-linear-gradient');
    /* And the hours and source move to the hover text, which needs the band to
       accept a pointer at all — it was `pointer-events-none`, so the tooltip
       could never have appeared. */
    expect(band).not.toContain('pointer-events-none');
    expect(band).toContain('title={`${name}');
  });

  it('and says it is a synced event on its face, not only on hover', () => {
    /*
     * "Is this busy from the synced calendar or the platform meeting?" — asked
     * twice, about a band that was labelled correctly both times. The name
     * cannot settle it: a Google event called "Quotation Offering time" looks
     * exactly like a service in an account that sells quotations.
     *
     * The band sits in the appointments column, so the question is the natural
     * one. A glyph answers it at a glance, in every language, and costs none
     * of the width the name needs.
     */
    const band = calendar.slice(
      calendar.indexOf('key={`external-${slotIndex}`}'),
      calendar.indexOf('{(() => { const concurrency = layoutConcurrentBookings')
    );

    expect(band).toContain('<CalendarClock');
    /* Decoration beside a name that is already read out. */
    expect(band).toContain('aria-hidden="true"');
    /* It must never be what gets truncated when the name is long. */
    expect(band).toContain('shrink-0');
  });

  it('and the cell beneath does not repeat the name the band carries', () => {
    /*
     * Both drew the event's name, one over the other. The cell stays a plain
     * hatch under a timed event — and keeps its voice for an ALL-DAY one,
     * which draws no band and would otherwise be silent.
     */
    expect(calendar).toContain('if (blocker && !blocker.is_all_day) return null;');
  });

  it('and the words exist in every language', () => {
    for (const language of ['en', 'he', 'es']) {
      const file = read(`lib/business-os/translations/${language}.ts`);

      for (const key of [
        'scheduling.busy_untitled',
        'scheduling.busy_from_google',
        'scheduling.busy_from_outlook',
        'scheduling.busy_hidden',
        'scheduling.busy_hidden_hint',
      ]) {
        expect(file).toContain(key);
      }
    }
  });
});
