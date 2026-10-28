/**
 * A client who has already paid is never asked to pay again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE PORTAL SHOWED
 *
 * A settled booking opened on a money tile reading:
 *
 *     ₪400.00
 *     Paid
 *     [ Pay now ]
 *
 * Two statements on one card contradicting each other, and the one that looked
 * actionable was the wrong one. On a refunded booking it was worse: the money
 * had gone back, and the page invited the client to send it again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CAUSE
 *
 * Both pay buttons — the one on the booking card and the one on the money tile
 * — were gated on `payment.invoiceId`, and a settled booking keeps its invoice
 * for ever. Existing is not the same as owing.
 *
 * The route already derives the answer. `payment.state` is computed from the
 * invoices rather than any single status column, and the line explaining how to
 * pay when there is no link was already asking `state === 'due'`. Two rules
 * about collecting money, in one file, disagreeing — which is why the fix is
 * one predicate both buttons read rather than the same test written twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const page = readFileSync(
  join(process.cwd(), 'app/book/manage/[token]/page.tsx'),
  'utf8'
);

describe('offering to collect', () => {
  it('asks whether money is owed, not whether an invoice exists', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * `state === 'due'` excludes paid, refunded and nothing-owed in a single
     * test, and it is the route's own derived answer rather than a status
     * column this page would have to interpret for itself.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(page).toMatch(
      /const canPayNow = payment\?\.state === 'due' && Boolean\(payment\.invoiceId\)/
    );
  });

  it('still requires the invoice, because that is what gets paid', () => {
    // `due` with no invoice is money owed that nothing can settle yet; the
    // page says so in words instead, a few lines below.
    expect(page).toMatch(/Boolean\(payment\.invoiceId\)/);
  });
});

describe('both buttons, one rule', () => {
  it('neither is gated on the invoice alone any more', () => {
    /*
     * The booking card and the money tile each had their own copy of this
     * condition. Two copies of a rule about taking money is how they came to
     * disagree with the label printed directly above them.
     */
    expect(page).not.toMatch(/\{payment\?\.invoiceId && \(\s*\n\s*<button/);
    expect(page).not.toMatch(/\{payment\.invoiceId && \(\s*\n\s*<button/);
  });

  it('both read the shared predicate', () => {
    // Three occurrences: the definition, and one per button.
    expect(page.split('canPayNow').length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe('what must not be lost', () => {
  it('the tile still states the payment, whatever its state', () => {
    /*
     * The fix removes an ACTION, not the information. A paid booking still
     * shows its amount and says "paid"; a refunded one still says the money
     * went back. Hiding the tile would be the opposite mistake — the figure
     * is the thing most clients open this page to check.
     */
    expect(page).toMatch(/payment\.state === 'paid'\s*\n?\s*\?\s*t\('paid'\)/);
    expect(page).toMatch(/payment\.state === 'refunded'/);
  });

  it('a client with money owed and no pay link is still told how to pay', () => {
    // The branch that already used `state === 'due'`, and the reason this
    // page could be internally inconsistent in the first place.
    expect(page).toMatch(/payment\.state === 'due' && !payment\.payUrl/);
  });
});
