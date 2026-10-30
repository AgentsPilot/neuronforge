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
 * A SOURCE-LEVEL GUARD, because the query sits behind a forty-branch
 * `Promise.all` in a route that needs most of the database mocked before it
 * will run. This asserts the lines that encode the decision — the same
 * approach as `lib/__tests__/system-initializer-removed.guard.test.ts`. It
 * cannot prove the query returns the right rows; it can prove nobody quietly
 * changed which statuses it asks for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE QUERY WENT
 *
 * It was three near-identical blocks inline in `route.ts`, each selecting
 * `scheduling_services(price)`. It is now one function in
 * `lib/business-os/reports/bookedValue.ts`, called three times with different
 * ranges — because the price stopped coming from the service. For quote-sold
 * work `scheduling_services.price` is NULL and `Number(price) || 0` reported
 * zero: measured on one account, 24 of 41 bookings priced at nothing, ten of
 * them really invoiced 25,866.64.
 *
 * None of the three decisions below changed. They are asserted in the new home
 * rather than retired, which is the whole reason this file is being edited
 * instead of deleted.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '..', 'route.ts'), 'utf8');

const bookedValue = readFileSync(
  join(process.cwd(), 'lib/business-os/reports/bookedValue.ts'),
  'utf8'
);

/** The booking read that decides which rows are priced at all. */
const query = bookedValue.slice(
  bookedValue.indexOf("from('scheduling_bookings')"),
  bookedValue.indexOf('const { data: bookingRows')
);

describe('booked this week', () => {
  it('is asked for by the route, three ranges through one definition', () => {
    /* This week, last week, the reporting period. One rule, so the three can
       no longer drift from each other the way three inline copies could. */
    expect(route.match(/bookedValueInRange\(/g)?.length).toBe(3);
  });

  it('excludes cancelled bookings', () => {
    expect(query).toContain(".neq('status', 'cancelled')");
  });

  it('still counts a no-show', () => {
    /*
     * The client booked. If this ever needs to change it is a product decision
     * and this test should be the thing that fails first — not a card quietly
     * reporting a smaller number one morning.
     */
    expect(query).not.toContain("'no_show'");
    expect(query).not.toMatch(/\.in\('status'/);
  });

  it('dates a booking by when it was placed, not when it happens', () => {
    /*
     * `created_at`, not `start_time`. A card badged THIS WEEK that filtered on
     * start_time would count every appointment already on the books for any
     * future date — the week's figure would include next month. It would also
     * drop every package, whose container has no `start_time` at all.
     */
    expect(query).toMatch(/\.gte\('created_at', from\)/);
    expect(query).not.toMatch(/start_time/);
  });

  it('prices from the agreement before falling back to the service', () => {
    /* The order is the decision: an accepted proposal is what was agreed, and
       it is never ADDED to its own invoices — a package raises one invoice per
       installment, and summing both bills the client twice in the report. */
    expect(bookedValue).toMatch(/if \(proposal\) \{[\s\S]*?\} else if \(invoiced/);
    expect(bookedValue).toMatch(/else if \(servicePrice > 0\)/);
    expect(bookedValue).toContain("eq('status', 'accepted')");
  });

  it('is wrapped so the positional destructuring still matches', () => {
    /*
     * The route reads this slot as `{ data: bookedValuePeriodData }`, and the
     * function resolves to the value itself. Handing it over unwrapped makes
     * the variable `undefined` and `.total` throw at request time — and nothing
     * catches it first: the `Promise.all` result widens, so the typecheck is
     * clean and the build is clean. It was written that way once.
     */
    expect(route.match(/bookedValueInRange\([\s\S]{0,120}?\.then\(data => \(\{\s*data,?\s*\}\)\)/g)?.length).toBe(3);
  });

  it('never adds two currencies together', () => {
    /* CLAUDE.md § Currency. The sum this replaced added raw numbers whatever
       they were denominated in. */
    expect(bookedValue).toContain('byCurrency');
    expect(bookedValue).toContain('primaryCurrency');
  });
});
