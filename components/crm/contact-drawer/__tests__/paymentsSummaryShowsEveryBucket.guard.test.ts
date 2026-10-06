/**
 * The contact's money summary reports every bucket, not three of four.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * `totalMoney` sorts a contact's money into buckets that do not overlap:
 * collected, outstanding, refunded and cancelled. The Payments & Invoices
 * summary rendered the first three and silently dropped `cancelled`.
 *
 * The figure was never wrong, just absent — which is the harder failure to
 * notice. A contact who booked ₪2,000 of work and called half of it off read as
 * a contact who had been billed ₪1,000: nothing on the line said money had been
 * lost rather than never asked for. And the rows directly underneath DID show
 * it, because `MoneyRow` paints a `cancelled` segment, so the loss was visible
 * per booking and missing from the sum of those same bookings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `overdue` IS NOT REQUIRED HERE
 *
 * It is the one bucket that is deliberately a subset. `moneyItems.ts` adds it
 * inside the outstanding branch and says so in terms — "a subset of what was
 * just added, never a second addition to the total". Rendering it beside
 * outstanding is a choice about emphasis; omitting it hides no money, because
 * outstanding already contains it.
 *
 * `cancelled` is the opposite: its own branch, counted nowhere else. Omitting it
 * drops money off the summary entirely, which is why it is asserted and overdue
 * is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SOURCE GUARD, because the alternative is mounting a collapsible section
 * with a seeded contact, a booking, an invoice and a cancellation to prove a
 * string appears. What has to stay true is structural — every non-subset bucket
 * `totalMoney` computes reaches this summary — and a source assertion holds
 * exactly that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const section = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/PaymentsSection.tsx'),
  'utf8'
);

/** Buckets that are money in their own right, each counted in no other. */
const INDEPENDENT_BUCKETS = ['collected', 'outstanding', 'refunded', 'cancelled'] as const;

describe('the contact money summary renders every independent bucket', () => {
  it.each(INDEPENDENT_BUCKETS)('reports totals.%s', bucket => {
    /*
     * Reading the field is the whole requirement. How it is formatted and which
     * colour it takes are presentation; that the number reaches the page at all
     * is the thing that was missing.
     */
    expect(section).toMatch(new RegExp(`totals\\.${bucket}`));
  });

  it('formats the cancelled figure as money in the contact currency', () => {
    // Printing a raw number here would read as a count of cancelled bookings
    // rather than the sum they were worth.
    expect(section).toMatch(/formatCurrency\(totals\.cancelled, moneyItems\[0\]\.currency\)/);
  });

  it('labels it with the same key as the orders list', () => {
    /*
     * `payments.cancelled_total` is what `MoneySummaryStrip` and `MoneyRow` use,
     * and it is translated in all three locales. A fresh string here would
     * either go untranslated in Hebrew or call the same money something else on
     * a different screen.
     */
    expect(section).toMatch(/payments\.cancelled_total/);
  });

  it('shows the line only when there is cancelled money', () => {
    /*
     * The strip's rule, for the strip's reason: a permanent zero beside three
     * live figures reads as a fourth problem the contact does not have. Most
     * contacts never cancel anything.
     */
    expect(section).toMatch(/totals\.cancelled > 0 &&/);
  });
});
