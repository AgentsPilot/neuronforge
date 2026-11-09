/**
 * A plan sold twice must still bill its later periods.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS
 *
 * `planCanNoLongerCharge` decides whether a dated period may be invoiced. For a
 * period with no `subscription_id` it asks "does a subscription exist that is
 * collecting this money?" — and that is a question about THIS SALE.
 *
 * It was asked of `payment_plan_id`, which names the SERVICE's plan rather than
 * the sale, with `.maybeSingle()`. A subscription row is written per sale, so
 * the second time a service was sold by card the lookup matched two rows,
 * `.maybeSingle()` failed with "JSON object requested, multiple (or no) rows
 * returned", and the catch answered "leave the period alone".
 *
 * Permanently, and silently: every later period of every invoice-based plan on
 * that service was skipped on every run. The busier the service, the sooner it
 * began — and nothing was wrong at Stripe or with the client's card. The
 * invoice that would have asked for the money was simply never raised, which is
 * what "the future payments are not getting charged" actually was.
 *
 * Measured 2026-11-08: bookings c6d50600, d11a212c and 051609a7, each period 2
 * of 2, due 1-3 November, all still pending and all three throwing on that
 * lookup. One plan template carried 16 subscription rows, another 2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NEGATIVE ASSERTION IS STILL THE ONE THAT MATTERS
 *
 * A client paying twice — once on their card and once on an invoice — is worse
 * than a receivable nobody chased. So multiplicity must now be read as
 * EVIDENCE rather than an error, without weakening any fail-closed case:
 * this sale having its own subscription still skips, and an UNATTACHED
 * subscription (a smart link paid before the booking existed, which
 * `bindPlanSubscription` documents) still skips.
 *
 * `strandedPlanPeriods.test.ts` states the same rule behaviourally, but against
 * a local mirror that never modelled the lookup — which is how this survived
 * it. Hence the source assertions below: the mirror cannot catch a bug that
 * lives in the query.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SERVICE = join(__dirname, '..', '..', 'services', 'PaymentReminderService.ts');

describe('the subscription question is asked per sale', () => {
  const source = readFileSync(SERVICE, 'utf8');

  /** The body of `planCanNoLongerCharge`, up to the next method. */
  const guard = source.slice(
    source.indexOf('private async planCanNoLongerCharge'),
    source.indexOf('private async businessToday')
  );

  it('has the guard to read', () => {
    expect(guard.length).toBeGreaterThan(0);
  });

  it('never asks a plan-wide lookup for a single row', () => {
    /*
     * The whole defect. `.maybeSingle()` on a column that is not unique turns
     * an ordinary "are there any?" into a thrown error, and the catch here
     * resolves every error to "skip" — so the failure is invisible and total.
     */
    /*
     * Bounded to that one statement. The second lookup in this method DOES use
     * `.maybeSingle()` and is right to: it filters on `id`, which is unique.
     * The defect is specific to asking it of a non-unique column.
     */
    const from = guard.indexOf("eq('payment_plan_id'");
    const planWide = guard.slice(from, guard.indexOf(';', from));
    expect(planWide).not.toContain('maybeSingle');
  });

  it('identifies the sale, not just the service plan', () => {
    expect(guard).toContain("eq('payment_plan_id', stage.payment_plan_id)");
    /* The sale is what decides it, so the rows must carry it and be compared. */
    expect(guard).toContain('booking_id');
    expect(guard).toMatch(/row\.booking_id === stage\.booking_id/);
  });

  it('still refuses to bill when an unattached subscription could be this sale', () => {
    expect(guard).toMatch(/some\(row => !row\.booking_id\)/);
  });

  it('is given the booking id by the scan that calls it', () => {
    /*
     * The guard cannot compare a field the scan never selected. This was the
     * second half of the fix and is just as easy to drop again.
     */
    const scan = source.slice(source.indexOf('async billDueDatedStages'));
    const select = scan.slice(scan.indexOf(".from('payment_plan_installments')"), scan.indexOf(".eq('status', 'pending')"));
    expect(select).toContain('booking_id');
  });
});

/**
 * The rule itself, in the shape the scan applies it.
 *
 * A local mirror for the same reason `strandedPlanPeriods.test.ts` uses one:
 * the service's module pulls in a PDF renderer Jest cannot transform. The
 * source assertions above are what keep this mirror honest.
 */
function canNoLongerCharge(
  stage: { payment_plan_id?: string | null; booking_id?: string | null },
  subscriptions: Array<{ booking_id: string | null }>
): boolean {
  if (!stage.payment_plan_id) return false;
  if (subscriptions.length === 0) return true;
  if (stage.booking_id && subscriptions.some(row => row.booking_id === stage.booking_id)) return false;
  if (subscriptions.some(row => !row.booking_id)) return false;
  return Boolean(stage.booking_id);
}

describe('a later period on an invoice-based plan', () => {
  const SALE = { payment_plan_id: 'plan-1', booking_id: 'booking-A' };

  it('is billed when the service has never been sold by card', () => {
    expect(canNoLongerCharge(SALE, [])).toBe(true);
  });

  it('is billed when every subscription belongs to a DIFFERENT sale', () => {
    /* The case that was broken: the lookup matched these and threw. */
    const otherSales = [{ booking_id: 'booking-B' }, { booking_id: 'booking-C' }];
    expect(canNoLongerCharge(SALE, otherSales)).toBe(true);
  });

  it('is billed however many other sales there are', () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ booking_id: `other-${i}` }));
    expect(canNoLongerCharge(SALE, many)).toBe(true);
  });

  it('is NOT billed when this sale has its own subscription', () => {
    const mine = [{ booking_id: 'booking-B' }, { booking_id: 'booking-A' }];
    expect(canNoLongerCharge(SALE, mine)).toBe(false);
  });

  it('is NOT billed while any subscription is still unattached', () => {
    /* A smart link paid before its booking existed. It may be this sale's. */
    expect(canNoLongerCharge(SALE, [{ booking_id: null }])).toBe(false);
  });

  it('is NOT billed when the sale cannot be named at all', () => {
    const nameless = { payment_plan_id: 'plan-1', booking_id: null };
    expect(canNoLongerCharge(nameless, [{ booking_id: 'booking-B' }])).toBe(false);
  });

  it('is NOT billed when the period belongs to no plan', () => {
    expect(canNoLongerCharge({ payment_plan_id: null, booking_id: 'booking-A' }, [])).toBe(false);
  });
});
