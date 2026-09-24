/**
 * What "booked this week" counts, and what it deliberately does not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The verdict card's third figure is this query. An owner reading "3 booked"
 * reads it as three appointments won this week, so which rows are in and which
 * are out is a product decision, not an implementation detail:
 *
 *   cancelled  EXCLUDED — the appointment does not stand, and counting it would
 *              inflate the week with work that will not happen.
 *   no_show    COUNTED  — the client DID book. Not turning up is a separate
 *              problem, already watched by the no-show detector; folding it in
 *              here would make one number answer two questions.
 *
 * Decided with the owner on 2026-09-23 against live data: that week held one
 * confirmed, one no-show and one cancelled booking.
 *
 * A SOURCE-LEVEL GUARD, because the query lives inside a forty-branch
 * `Promise.all` in a route that needs most of the database mocked before it
 * will run. This asserts the one line that encodes the decision — the same
 * approach as `lib/__tests__/system-initializer-removed.guard.test.ts`. It
 * cannot prove the query returns the right rows; it can prove nobody quietly
 * changed which statuses it asks for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8');

/**
 * The booked-value queries, isolated from the other `scheduling_bookings` reads
 * in the file. They are the ones selecting a price off the joined service.
 */
const bookedValueQueries = source
  .split("from('scheduling_bookings')")
  .slice(1)
  .map(block => block.slice(0, 400))
  .filter(block => block.includes("select('scheduling_services(price)')"));

describe('booked this week', () => {
  it('has the queries this guard is about', () => {
    // This week, last week, and the reporting period. If this count changes,
    // the guard below may be looking at the wrong thing.
    expect(bookedValueQueries.length).toBe(3);
  });

  it('excludes cancelled bookings', () => {
    for (const query of bookedValueQueries) {
      expect(query).toContain(".neq('status', 'cancelled')");
    }
  });

  it('still counts a no-show', () => {
    /*
     * The client booked. If this ever needs to change it is a product decision
     * and this test should be the thing that fails first — not a card quietly
     * reporting a smaller number one morning.
     */
    for (const query of bookedValueQueries) {
      expect(query).not.toContain("'no_show'");
      expect(query).not.toMatch(/\.in\('status'/);
    }
  });

  it('dates a booking by when it was placed, not when it happens', () => {
    /*
     * `created_at`, not `start_time`. A card badged THIS WEEK that filtered on
     * start_time would count every appointment already on the books for any
     * future date — the week's figure would include next month.
     */
    for (const query of bookedValueQueries) {
      expect(query).toMatch(/\.gte\('created_at'/);
      expect(query).not.toMatch(/\.gte\('start_time'/);
    }
  });
});
