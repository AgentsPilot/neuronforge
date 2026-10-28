/**
 * The booking strip shows the whole week and greys the days it cannot take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DID BEFORE
 *
 * Every day in the window was offered as if it were bookable. A visitor
 * discovered the business is closed on Saturdays by choosing one and waiting
 * for "no available times" — once per closed day, with a network round trip
 * each time. Over a fortnight that is tedious; over the ninety days a business
 * may accept, it is unusable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SHOWN, NOT HIDDEN — WHICH IS THE PRODUCT DECISION
 *
 * A week missing its Saturday reads as something failing to load. A week with
 * Saturday struck through reads as a business that is closed on Saturdays. The
 * second is the truth and costs nothing extra to render.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT HAD TO STAY CHEAP
 *
 * `windowsForDate` is a pure read of hours already in memory, so ninety days
 * cost ninety array lookups on a request the page was making anyway. Asking
 * the slot engine the same question would be ninety database round trips for
 * an answer that only decides whether to grey a button — which is why the
 * assertions below pin the cheap source rather than the result.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const flow = read('components/website/blocks/ProcessFlowSection.tsx');
const scheduling = read('app/api/website/scheduling/availability/route.ts');
const booking = read('app/api/website/booking/availability/route.ts');

describe('the server answers which days are closed', () => {
  it.each([
    ['scheduling', () => scheduling],
    ['booking', () => booking],
  ])('%s availability reports closedDates', (_name, source) => {
    expect(source()).toMatch(/closedDates/);
    expect(source()).toMatch(/windowsForDate\([\s\S]{0,80}\)\.length === 0/);
  });

  it.each([
    ['scheduling', () => scheduling],
    ['booking', () => booking],
  ])('%s bounds the window it will walk', (_name, source) => {
    /*
     * The number arrives from a query string on a public URL. Unbounded, a
     * visitor could ask it to walk ten thousand days.
     */
    expect(source()).toMatch(/120/);
  });

  it('folds time off in with the weekly hours', () => {
    /*
     * `windowsForDate` returns [] for an `unavailable` exception as well as a
     * weekday with no hours, so a holiday greys out exactly like a Sunday.
     * Passing an empty array instead would publish the ordinary week over a
     * closure the owner had set.
     */
    expect(scheduling).toMatch(/windowsForDate\(availability, cursor, timeOff \?\? \[\]\)/);
  });

  it('widens the time-off query to cover that window', () => {
    // Asking only about today's date would leave every future holiday open.
    expect(scheduling).toMatch(/closedWindow > 0 \? businessDateKey\(new Date\(\), timezone\) : date/);
  });

  it('says nothing when the business has set no hours at all', () => {
    /*
     * That case is already reported through `reason`, and greying ninety days
     * would read as "closed for three months" about a setting the owner has
     * simply not filled in yet.
     */
    expect(booking).toMatch(/closedDaysWindow > 0 && hasAvailabilityConfigured && availabilitySettings/);
  });
});

describe('the strip renders them', () => {
  it('disables a closed day rather than dropping it', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Filtering closed days out of the list would pass any test about
     * "cannot book a closed day" and leave a visitor looking at a week with
     * holes in it.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(flow).toMatch(/const closed = closedDates\?\.has\(date\) \?\? false/);
    expect(flow).toMatch(/disabled=\{closed\}/);
    expect(flow).not.toMatch(/dates\.filter\([^)]*closed/);
  });

  it('says why, rather than only looking different', () => {
    // Colour alone is not an explanation, and is invisible to a screen reader.
    expect(flow).toMatch(/aria-disabled=\{closed\}/);
    expect(flow).toMatch(/title=\{closed \? labels\.dayClosed : undefined\}/);
  });

  it('asks for the closed days on a request it was making anyway', () => {
    // No second round trip to grey a button.
    expect(flow).toMatch(/&closed_days=\$\{DEFAULT_ADVANCE_BOOKING_DAYS\}/);
  });

  it('knows them BEFORE a date is picked', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE BUG THE FIRST VERSION SHIPPED WITH.
     *
     * The fetch was gated on `selectedDate`, which is precisely when the
     * closed days stop being useful: the strip is drawn the moment the step
     * opens, so every day looked bookable until the visitor had already
     * chosen one. The greying arrived after the mistake it prevents.
     *
     * With no date chosen the request asks about today and keeps only the
     * answers that describe the BUSINESS — its clock, its window, its closed
     * days — which is why the date-specific writes below are gated instead.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(flow).toMatch(/if \(!selectedService\) return;/);
    expect(flow).not.toMatch(/if \(!selectedService \|\| !selectedDate\) return;/);
  });

  it('does not let that opening request speak about a date', () => {
    // "No available times" on a screen where nothing has been picked.
    expect(flow).toMatch(/if \(selectedDate\) setSlots\(mappedSlots\)/);
    expect(flow).toMatch(/if \(selectedDate\) setLoadingSlots\(false\)/);
  });

  it('is translated everywhere the strip is', () => {
    expect(flow.split("dayClosed:").length - 1).toBe(3);
  });
});
