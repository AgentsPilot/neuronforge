/**
 * A payment plan whose booking the drawer has not got is still that client's debt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * Two screens, one client, two answers:
 *
 *   money page                     $407.04 outstanding
 *   contact drawer, Payments       $185.00 outstanding
 *
 * Received ($417.01) and returned ($240.00) agreed to the cent on both. Only
 * the owed figure was short — by $222.04, which is exactly the two unbilled
 * sessions of one pay-as-you-go package. The drawer told the owner a client
 * owed them less than half of what they owe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY, AND WHY NEITHER HALF IS WRONG ON ITS OWN
 *
 * `buildMoneyItems` is given bookings and a `plansByBookingId` map, and it
 * attaches a plan to the booking that carries it. A plan whose booking is NOT
 * in the array has nothing to attach to and is dropped — silently, because
 * nothing in the signature says the two arguments have to agree.
 *
 * The drawer built its booking array from `sessions`, which is the JOURNEY's
 * array. And the journey deliberately ABSORBS a package container into the
 * booking whose quote sold it — `foldPackageMeetings` filters it out through
 * `absorbed`. That is right for a timeline: the sessions belong beside the
 * quote that produced them, not on a row of their own.
 *
 * But the MONEY is keyed on the container. `payment_plan_installments.booking_id`
 * is the container's id, so the plan arrived for a booking the journey had just
 * removed. Two correct decisions, taken in different modules, that compose into
 * a wrong number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS KEEPS
 *
 * A plan brings its booking with it. Whatever the journey does with the
 * container, every booking the money endpoint names is in the array that
 * builds the money list — so the drawer can never again owe its totals to an
 * array assembled for a different question.
 *
 * Asserted at source because the failure is a row that is ABSENT. No render
 * test of a package reaches it without also reproducing the absorption, and a
 * total that is merely too small looks exactly like a client who owes less.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const SECTION = 'components/crm/contact-drawer/PaymentsSection.tsx';
const DRAWER = 'components/crm/contact-drawer/CRMContactDrawerV2.tsx';

/** Source with comments removed, so these notes cannot satisfy a match. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('every plan the endpoint names reaches the money list', () => {
  const section = code(read(SECTION));

  it('the booking carrying each plan is captured, not just the plan', () => {
    /*
     * The one-line version of the bug: `byBooking[item.bookingId] = item.plan`
     * alone keeps the money and throws away the thing it has to hang on.
     */
    expect(section).toContain('const [moneyOnlyBookings, setMoneyOnlyBookings] = useState<');
    expect(section).toContain('setMoneyOnlyBookings(carriers);');
  });

  it('in the same pass that reads the plan, so the two cannot disagree', () => {
    const fetcher = section.slice(
      section.indexOf('const fetchPlans = async ()'),
      section.indexOf('const handleToggle')
    );

    expect(fetcher).toContain('byBooking[item.bookingId] = item.plan;');
    expect(fetcher).toContain('carriers.push({');
    /* One guard decides both: an item without a plan contributes neither. */
    expect(fetcher).toContain('if (!item.bookingId || !item.plan) continue;');
  });

  it('and those bookings are appended to what builds the items', () => {
    const build = section.slice(
      section.indexOf('bookings: ['),
      section.indexOf('plansByBookingId,', section.indexOf('bookings: ['))
    );

    expect(build).toContain('...moneyOnlyBookings');
  });

  it('skipping any the journey already has, so one order is one row', () => {
    /*
     * `buildMoneyItems` keys on the booking id. A duplicate entry would split
     * one order into two rows — the opposite failure, and just as wrong.
     */
    expect(section).toContain(
      '.filter(booking => !sessions.some(session => session.booking.id === booking.id))'
    );
  });

  it('and the memo recomputes when they arrive', () => {
    /*
     * They land from a fetch, after the first render. Left out of the
     * dependencies the list would be built once, from the journey alone, and
     * the fix would be dead code that reads as live.
     */
    expect(section).toContain(
      '[invoices, payments, sessions, contactId, plansByBookingId, moneyOnlyBookings, t]'
    );
  });
});

describe('the journey really does remove the container', () => {
  const drawer = code(read(DRAWER));

  it('absorbing it into the booking whose quote sold it', () => {
    /*
     * The other half of the cause, pinned so it is findable from here. This is
     * CORRECT and must stay — the sessions belong beside the quote on a
     * timeline. It is only the money that must not inherit it.
     */
    expect(drawer).toContain('const absorbed = new Set(');
    expect(drawer).toMatch(
      /\.filter\(card => !meetingsByParent\.has\(card\.booking\.id\) \|\| !absorbed\.has\(card\.booking\.id\)\)/
    );
  });

  it('so a package container can be missing from `sessions` by design', () => {
    /* `hostOf` is what decides a container has a better home than itself. */
    expect(drawer).toContain('hostOf.set(containerId, host);');
  });
});
