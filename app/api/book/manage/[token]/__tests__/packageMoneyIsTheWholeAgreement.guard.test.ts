/**
 * A package's money is the package's, not one meeting's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * A package writes ONE `payment_plan_installments` row per CHILD booking. Six
 * meetings is six rows, each carrying the `booking_id` of the meeting it pays
 * for — verified on the live database against a six-meeting package sold at
 * ₪74.99 a meeting.
 *
 * The portal asked for this booking's rows alone:
 *
 *     .from('payment_plan_installments').eq('booking_id', booking.id)
 *
 * so it found exactly one, and told a client holding a six-payment agreement:
 *
 *     Payment plan
 *     0 of 1 payments made
 *     3 · meeting 3 · ₪74.99 · to pay
 *
 * Every other payment they had agreed to was invisible, the progress line was
 * false, and the only figure on screen was the least useful one. Nothing
 * errored, because one row is a perfectly valid plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE INVOICES MOVE WITH THE INSTALMENTS
 *
 * `plan.paid` counts settled instalments and `plan.total` counts all of them.
 * Widening one without the other would count `paid` over a single meeting and
 * `total` over six, so a plan two payments in would report "0 of 6 made" — a
 * worse answer than the one being fixed. `portalMoneyIsOneAnswer` exists
 * because this page has already told a client two different things about one
 * balance.
 *
 * The pay link moves with them for the same reason: an amount covering the
 * package beside a link scoped to one meeting shows a client what they owe and
 * no way to pay it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT MUST NOT CHANGE
 *
 * An ordinary booking has no children, so the id list must collapse to its own
 * id and leave every figure exactly as it was. The widening is for packages
 * only; it is not a licence to sum across unrelated bookings.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/book/manage/[token]/route.ts'),
  'utf8'
);

/** The `.from('x')` call and everything chained onto it. */
function query(table: string) {
  const at = route.indexOf(`.from('${table}')`);
  expect(at).toBeGreaterThan(-1);
  return route.slice(at, at + 400);
}

describe('the plan covers the agreement, not the meeting', () => {
  it('reads the instalments of the whole package', () => {
    expect(query('payment_plan_installments')).toMatch(/\.in\('booking_id', moneyIds\)/);
  });

  it('reads the invoices over the same set', () => {
    // Split them and `paid` counts one booking while `total` counts six.
    expect(query('payment_invoices')).toMatch(/\.in\('booking_id', moneyIds\)/);
  });

  it('never scopes either back to the single booking', () => {
    // The exact shape of the defect.
    for (const table of ['payment_plan_installments', 'payment_invoices']) {
      expect(query(table)).not.toMatch(/\.eq\('booking_id', booking\.id\)/);
    }
  });

  it('offers a pay link over the balance it just reported', () => {
    const payLink = route.slice(route.lastIndexOf(".from('payment_invoices')"));
    expect(payLink.slice(0, 400)).toMatch(/\.in\('booking_id', moneyIds\)/);
  });
});

describe('an ordinary booking is left exactly as it was', () => {
  it('builds the family from the container, falling back to itself', () => {
    expect(route).toMatch(/const moneyContainerId = booking\.parent_booking_id \?\? booking\.id;/);
  });

  it('collapses to its own id when there are no children', () => {
    /*
     * `familyRows?.length` and not `familyRows` — an empty array is truthy,
     * and `[containerId]` alone would quietly drop a plain booking's own
     * instalments on the floor.
     */
    expect(route).toMatch(/familyRows\?\.length[\s\S]{0,160}: \[booking\.id\]/);
  });

  it('keeps the family lookup inside the tenant', () => {
    // CLAUDE.md rule 4. A service-role read of someone else's package would
    // put another business's money in this client's portal.
    const family = route.slice(route.indexOf('const moneyContainerId'));
    expect(family.slice(0, 400)).toMatch(/\.eq\('user_id', booking\.user_id\)/);
  });
});

describe('a quote is only "coming" while the price is still open', () => {
  /*
   * `sale_mode: 'proposal'` says how a service is SOLD and never stops saying
   * it. A business that quotes for a job, agrees the figure in conversation,
   * and writes the plan directly never creates a `proposals` row — so the
   * portal showed "your quote is being prepared, we will email it when ready"
   * directly above an agreed six-payment plan stating the price.
   */
  it('requires that no money has been agreed or taken', () => {
    expect(route).toMatch(
      /awaitingQuote: quotesExpected && !quote && payment\.state === 'none'/
    );
  });

  it('still refuses to promise one on a booking never sold that way', () => {
    // The half the quote guard pins: without `quotesExpected` an ordinary
    // booking would tell its client to wait for a price nobody is writing.
    expect(route).toMatch(/awaitingQuote: quotesExpected &&/);
  });
});
