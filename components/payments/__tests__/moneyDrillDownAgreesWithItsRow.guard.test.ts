/**
 * The drill-down under an order says the same thing as the row above it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * A credited order read, on one screen:
 *
 *     שלמה המלך · quote · payment plan      credited   2/2 paid   −₪800.00
 *       Payment 1   22 Nov 2026   paid      ₪400.00
 *       Payment 2   —             paid      ₪400.00
 *
 * Three separate faults, each small, and together a table that contradicts its
 * own heading:
 *
 *   1. NO REFUND. The row says the whole ₪800 went back; both periods say paid
 *      with nothing returned, and nothing says WHICH period the money came off
 *      — the only reason to list periods apart.
 *
 *   2. A DASH FOR A PAID PERIOD. The date column showed `dueDate` and nothing
 *      else, and a MILESTONE has no due date, because it falls due when the
 *      work is done. So a paid period printed "—" beside a sibling that showed
 *      a date. `paidAt` was already on the period, already read by the drawer's
 *      own schedule, and ignored only here.
 *
 *   3. A PLURAL VERB. `payments.paid_lower` is "שולמו" / "pagados" because it
 *      follows a count ("2/2 שולמו"). Against a single row it says this one
 *      payment "were paid". Invisible in English, where "paid" is
 *      number-neutral, which is why it survived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The table is built inside a `useMemo` in a component whose props are a large
 * `MoneyItem` graph, and the faults are a field read, a fallback and a
 * translation key. Rendering it needs the whole payments view; what has to hold
 * is which fields the row consults, and that is a property of the source.
 *
 * The arithmetic that does have rules in it is tested for real in
 * `shareOfTotal`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { dictionarySource } from '@/tests/helpers/dictionarySource';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const row = read('components/payments/MoneyRow.tsx');
const items = read('lib/payments/moneyItems.ts');
const route = read('app/api/payments/money/route.ts');
const strip = read('components/payments/MoneySummaryStrip.tsx');
const copy = dictionarySource();

describe('a paid period says when it was paid', () => {
  it('prefers paidAt, falling back to the due date', () => {
    expect(row).toMatch(/const stamp = settled \? period\.paidAt \?\? period\.dueDate : period\.dueDate/);
  });

  it('no longer reads the due date alone', () => {
    expect(row).not.toMatch(/when: period\.dueDate \? formatDate\(period\.dueDate\) : '—'/);
  });

  it('still shows a dash when there is genuinely no date', () => {
    /*
     * An unbilled milestone has neither. A dash is right there; it was only
     * wrong on a period that had been paid.
     */
    expect(row).toMatch(/when: stamp \? formatDate\(stamp\) : '—'/);
  });
});

describe('one payment is not plural', () => {
  it('the row uses the singular key', () => {
    expect(row).toMatch(/state: settled\s*\n\s*\? t\('payments\.paid_one'\)/);
  });

  it('the singular key exists in all three languages', () => {
    const hits = copy.match(/'payments\.paid_one':/g) ?? [];

    expect(hits).toHaveLength(3);
  });

  it('and it really is singular in Hebrew and Spanish', () => {
    /*
     * The point of the key. Copying `paid_lower`'s value into it would satisfy
     * every other assertion here and fix nothing.
     */
    expect(copy).toMatch(/'payments\.paid_one': 'שולם'/);
    expect(copy).toMatch(/'payments\.paid_one': 'pagado'/);
  });

  it('the aggregate still uses the plural, which is correct after a count', () => {
    expect(row).toMatch(/periodsPaid\}\/\$\{item\.plan\.installmentCount\} \$\{t\('payments\.paid_lower'\)/);
  });
});

describe('the refund reaches the period it came off', () => {
  it('the type carries it', () => {
    expect(items).toMatch(/refundedAmount\?: number \| null;/);
  });

  it('the route joins it from the invoices AND the charges it had already read', () => {
    /*
     * `refunded_amount` is derived by trigger onto the INVOICE a period raised,
     * never onto the installment row — `payment_plan_installments` has no such
     * column — so a join is the only way. It reuses the invoice select the list
     * rows already need: no second query.
     *
     * AND the transactions, which is the half that was missing. A plan billed
     * to a CARD raises no invoice: Stripe charges the subscription and the
     * refund lands on the `payment_transactions` row, so `invoice_id` on the
     * period is null and the invoice map can never answer for it. Measured
     * 2026-10-26: the drawer's detail panel read "Refunded $30.00" off the
     * charge while the schedule above it showed the period on a green dot.
     *
     * Invoice first, charge second — an invoiced period's refund belongs to
     * its document. Both maps are built from selects the route already makes.
     */
    expect(route).toMatch(/const refundByInvoice = new Map<string, number>\(\)/);
    expect(route).toMatch(/for \(const invoice of invoices\.data \?\? \[\]\)/);

    expect(route).toMatch(/const refundByTransaction = new Map<string, number>\(\)/);
    expect(route).toMatch(/for \(const transaction of transactions\.data \?\? \[\]\)/);

    /* Both keys reach the period, in that order. */
    expect(route).toMatch(/refundByInvoice\.get\(row\.invoice_id\)/);
    expect(route).toMatch(/refundByTransaction\.get\(row\.transaction_id\)/);
  });

  it('the row reads it', () => {
    expect(row).toMatch(/const returned = Number\(period\.refundedAmount \|\| 0\)/);
  });

  it('a standalone invoice shows its refund too', () => {
    /*
     * `MoneyEntry.refunded` had carried the figure all along and the other
     * branch of this table never read it, so a lone invoice credited in part
     * was just as silent as the schedule.
     */
    expect(row).toMatch(/returned: one\.refunded/);
  });

  it('states the gross, with the refund on its own line', () => {
    /*
     * The amount stays what was PAID. The row reads "paid on the 22nd", so a
     * net figure there says the client paid ₪200 on a day they paid ₪400 — the
     * same misstatement the contact drawer's stage row was fixed for.
     */
    expect(row).toMatch(/\{formatCurrency\(line\.amount, item\.currency\)\}/);
    expect(row).toMatch(/\(line\.returned \?\? 0\) > 0 && \(/);
  });

  it('borrows the contact drawer’s wording rather than inventing a third', () => {
    expect(row).toMatch(/crm\.stage\.refund_breakdown/);
  });

  it('isolates the line from the right-to-left text around it', () => {
    const from = row.indexOf('WHAT BECAME OF IT, under what was paid');
    expect(from).toBeGreaterThan(-1);

    expect(row.slice(from, from + 2000)).toMatch(/<bdi>/);
  });
});

describe('the strip does not say one thing twice with two numbers', () => {
  it('the bar segment has its own label', () => {
    /*
     * The cell above is everything owed (₪4,250) and this segment is that minus
     * the late part (₪2,650). Both read "Still to collect", so one screen
     * carried the same words against two amounts whose difference was exactly
     * the overdue cell beside them.
     */
    expect(strip).toMatch(/label: t\('payments\.not_yet_due'\)/);
  });

  it('the new label exists in all three languages', () => {
    const hits = copy.match(/'payments\.not_yet_due':/g) ?? [];

    expect(hits).toHaveLength(3);
  });

  it('the cell above still reports the whole of what is owed', () => {
    // Money that is late is money that is owed. The cell contains it; the bar
    // separates it. Both are right, and they needed different words.
    expect(strip).toMatch(/value: money\(c => c\.outstanding\)/);
  });

  it('the percentages are rounded as a set', () => {
    expect(strip).toMatch(/const shares = shareOfTotal\(/);
    expect(strip).not.toMatch(/Math\.round\(\(segment\.value \/ total\) \* 100\)/);
  });
});
