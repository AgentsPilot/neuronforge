/**
 * A booking's service is looked up for every booking the services band uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * The reports page, "מה אנשים קונים" — what people buy. A row labelled `Other`
 * holding ₪1,975 over six payments, in a table whose every other row named a
 * service. Asked what it was, the honest answer looked like "money that names
 * no service", and the owner's reply was the correct one:
 *
 *     "how come we have booking without services. we can't book without
 *      service. Check it again"
 *
 * They were right. Measured live on 2026-11-03: all 52 bookings on that account
 * name a service. Not one is missing it. The report was wrong, not the data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT: ONE MAP, FILLED FROM ONE POPULATION, READ BY TWO
 *
 * `bookingServiceById` was filled exactly once, from the bookings of invoices
 * carrying no `service_id` — five of them on that account.
 *
 * Two hundred lines below, the payment-plan instalments are attributed through
 * that same map. They are not even fetched until after it was built, so an
 * instalment's booking could never have been in it. Every lookup missed,
 * `?? null` turned the miss into "this names no service", and the money was
 * filed as unattributed:
 *
 *     ₪400    booking 03c99d75  ->  service d92aed46
 *     ₪400    booking 5729ae18  ->  service d92aed46
 *     ₪500    booking ad2ebd0a  ->  service f69ccbf0
 *     ₪75.05  booking b5fae424  ->  service 5be8fe70
 *
 * ₪1,375.05 of a ₪1,975 "Other" row, every penny of it attributable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching the branch needs an authenticated request and nine tables agreeing —
 * a booking, a service, a plan, its instalments, an invoice, a transaction. The
 * thing that broke is structural and stays structural: a lookup filled for one
 * reader and used by two. This asserts the lookup is a FUNCTION called for both
 * populations, which is what makes a third reader safe by construction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = 'app/api/business-os/stats/route.ts';

const source = fs
  .readFileSync(path.join(process.cwd(), SOURCE), 'utf8')
  .replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the booking-to-service lookup', () => {
  it('is a function, not a one-off fill', () => {
    /*
     * THE FIX, AS ONE ASSERTION. A single inline fill can only ever serve the
     * reader it was written beside; the second reader is then silently wrong,
     * which is exactly what happened.
     */
    expect(code).toMatch(/const learnBookingServices = async \(/);
  });

  it('is called for the invoices that name only a booking', () => {
    expect(code).toMatch(/await learnBookingServices\(\s*\[\.\.\.revenueInvoices, \.\.\.cancelledInvoices\]/);
  });

  it('is called for the plan instalments too — the half that was missing', () => {
    /*
     * The whole bug. Without this call the instalments read a map that was
     * built before they were fetched.
     */
    expect(code).toMatch(/await learnBookingServices\(\s*\(serviceOwedStages \|\| \[\]\)/);
  });

  it('is called for the instalments BEFORE they are attributed', () => {
    /* Order is the defect. A lookup filled after its reader has run is the
       same as not filled at all, and nothing fails to say so. */
    const fill = code.indexOf('await learnBookingServices(\n      (serviceOwedStages');
    const read = code.indexOf('bookingServiceById.get(stage.booking_id)');

    expect(fill).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(read);
  });

  it('skips ids it already knows, so the second call is usually free', () => {
    expect(code).toMatch(/!bookingServiceById\.has\(/);
  });

  it('binds the lookup error instead of discarding it', () => {
    /*
     * A discarded 42703 here is this bug with no symptom: PostgREST rejects the
     * whole select for one unknown column, the map comes back empty, and every
     * booking reads as unattributed. That is how the wrong answer was reached
     * while investigating this very row.
     */
    const fn = code.slice(
      code.indexOf('const learnBookingServices'),
      code.indexOf('await learnBookingServices(')
    );

    expect(fn).toMatch(/const \{ data: rows, error \} =/);
    expect(fn).toMatch(/if \(error\)/);
    expect(fn).toMatch(/requestLogger\.warn/);
  });
});

describe('what still counts as unattributed', () => {
  it('a stage with no booking is not counted at all, rather than filed as Other', () => {
    /* It has no row on the money page either — see the comment there. Counting
       it here and not there is how the two screens came to disagree. */
    expect(code).toMatch(/if \(!stage\.booking_id\) return;/);
  });

  it('a settled stage is skipped, because it was counted as its transaction', () => {
    expect(code).toMatch(/if \(stage\.transaction_id\) return;/);
  });
});
