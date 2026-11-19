/**
 * The week the grid draws is the week its headings name.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `weekStartsOnSunday` is derived from `language`, and `language` opens at
 * `'en'` and is reassigned from localStorage AFTER mount. Two things read it:
 *
 *   `dayNames`     recomputed on every render, so it followed the change
 *   `currentWeek`  a `useState` INITIALISER, so it ran once and never did
 *
 * A Hebrew owner therefore got a Monday-start week wearing Sunday-first
 * headings: every column sat one day off the name above it, and an appointment
 * in the last column was filed under the wrong weekday entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE SAME SHAPE AGAIN, IN THE TIMEZONE
 *
 * `timezone` came out of the same context at `'UTC'` and became the real zone
 * once the locale request returned. It is what sorts an appointment into a day
 * column, so the first paint bucketed by one rule and the second by another.
 * Seeding it from the browser makes the two agree; the stored value still wins
 * a moment later, and `user_preferences.timezone` remains the authority.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Both bugs need a context value to CHANGE after mount to show themselves. A
 * render test mounts once with its value already settled, which is exactly the
 * case that always worked — the reason this survived in a file that is
 * otherwise heavily tested.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const view = readFileSync(
  join(process.cwd(), 'components/scheduling/SchedulingCalendarView.tsx'),
  'utf8'
);

const context = readFileSync(
  join(process.cwd(), 'lib/business-os/LanguageContext.tsx'),
  'utf8'
);

describe('the calendar week follows the language it is labelled in', () => {
  it('still derives the week start from the language', () => {
    expect(view).toContain("const weekStartsOnSunday = language === 'he'");
  });

  it('recomputes the week when that answer changes', () => {
    /*
     * The initialiser alone is not enough: it runs once, and the value it
     * reads is the pre-localStorage one.
     */
    expect(view).toMatch(/useEffect\(\(\) => \{[\s\S]*setCurrentWeek\(previous =>[\s\S]*\}, \[weekStartsOnSunday\]\)/);
  });

  it('keeps the owner on the week they were looking at', () => {
    const effect = view.slice(
      view.indexOf('THE WEEK FOLLOWS THE LANGUAGE'),
      view.indexOf('[weekStartsOnSunday]')
    );

    /*
     * Recomputed from a day inside the CURRENT week, never from `new Date()`:
     * an owner three weeks ahead must not be thrown back to today because
     * their language finished loading.
     */
    expect(effect).toContain('previous.getDate() + 3');
    expect(effect).not.toContain('new Date()');
  });

  it('returns the same object when the week has not moved, so it cannot loop', () => {
    const effect = view.slice(
      view.indexOf('THE WEEK FOLLOWS THE LANGUAGE'),
      view.indexOf('[weekStartsOnSunday]')
    );

    /* `currentWeek` drives a fetch. A new Date object every run would refetch
       the week forever. */
    expect(effect).toContain('corrected.getTime() === previous.getTime() ? previous : corrected');
  });
});

describe('the timezone does not change under the first paint', () => {
  it('opens at the browser zone rather than UTC', () => {
    expect(context).not.toMatch(/useState<string>\('UTC'\)/);
    expect(context).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
  });

  it('runs the browser answer through safeTimezone', () => {
    /* A browser can report something unusable; the fallback is what keeps that
       from becoming the value every surface then formats against. */
    expect(context).toMatch(/safeTimezone\(Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone\)/);
  });

  it('still lets the stored value win', () => {
    /* The guess is an opening bid. `user_preferences.timezone` is the
       authority, and the locale load overwrites. */
    expect(context).toContain('setTimezone(safeTimezone(locale.timezone))');
  });
});
