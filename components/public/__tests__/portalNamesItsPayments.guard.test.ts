/**
 * The portal's payment list is in the agreement's order, and names each payment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The list sorted by due date and renumbered from the result. A MILESTONE has
 * no due date — it falls due when the work is done — and a null sorted as the
 * empty string, which precedes every real date. So a two-stage job rendered its
 * final milestone as "1." and its deposit as "2.":
 *
 *     agreement                     portal showed
 *     1. מקדמה          21 Nov      1. ₪4,500  refunded ₪2,250   ← the FINAL one
 *     2. עם סיום העבודה  —          2. ₪4,500                     ← the deposit
 *
 * The refund then sat against the wrong number. Right figure, wrong row, which
 * is worse than not showing it: a client reading that believes their deposit
 * was partly returned. Nothing errored, and with two equal amounts the page
 * looked entirely plausible.
 *
 * The column that answers "which payment is this" already existed and was not
 * being selected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY A NUMBER IS NOT ENOUGH
 *
 * Even in the right order, "a refund against 2." is unanswerable by a client who
 * never saw a numbered schedule. The milestone's own name is what identifies it,
 * so it is selected, passed through, and rendered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The ordering is decided in a route handler that reaches Supabase on three
 * tables before it maps anything, and the bug is a dropped column plus a
 * comparator — no single unit returns a wrong value. What must hold is that the
 * column is fetched and that the comparator is the instalment number, and both
 * are properties of the source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const route = read('app/api/book/manage/[token]/route.ts');
const card = read('components/public/AppointmentCard.tsx');
const email = read('lib/email/templates/base-template.ts');
const sender = read('lib/services/BookingEmailService.ts');

describe('the order is the agreement’s order', () => {
  it('sorts by instalment number, not by due date', () => {
    expect(route).toMatch(/Number\(a\.installment_number \?\? 0\) - Number\(b\.installment_number \?\? 0\)/);
  });

  it('never sorts the portal’s periods by date again', () => {
    /*
     * The specific comparator that caused it. A date sort is defensible-looking
     * — a schedule IS chronological — which is why it needs naming rather than
     * leaving to judgement: a milestone has no date to sort on.
     */
    /* Either spelling: the bug was on the mapped `dueDate`, but the raw
       `due_date` column sorts just as wrongly and reads just as reasonably. */
    expect(route).not.toMatch(/a\.(dueDate|due_date) \?\? ''\)\.localeCompare/);
  });

  it('keeps the stored number rather than renumbering the result', () => {
    /*
     * Renumbering is what turned a sorting mistake into a WRONG STATEMENT. Had
     * the rows kept their own numbers, a bad sort would merely have listed them
     * out of order — visibly odd, and not a lie about which payment was which.
     */
    expect(route).toMatch(/number: Number\(row\.installment_number \?\? 0\)/);
    expect(route).not.toMatch(/\.map\(\(period, index\) => \(\{ \.\.\.period, number: index \+ 1 \}\)\)/);
  });
});

describe('each payment is named', () => {
  it('the route selects the label', () => {
    expect(route).toMatch(/\.select\('installment_number, label,/);
  });

  it('the route passes it on', () => {
    expect(route).toMatch(/label: \(row\.label as string \| null\) \?\? null/);
  });

  it('the card renders it', () => {
    expect(card).toMatch(/\{period\.label && \(/);
    expect(card).toMatch(/\{period\.label\}/);
  });

  it('the card survives a plan with no labels', () => {
    /*
     * A uniform instalment plan has none, and the number is the only name those
     * payments have. The label is optional in the type, so an unnamed period
     * renders the row it always did.
     */
    expect(card).toMatch(/label\?: string \| null;/);
  });
});

describe('the receipt names them too', () => {
  it('selects the label alongside the schedule', () => {
    expect(sender).toMatch(/\.select\('installment_number, label, amount, due_date, status, paid_at, invoice_id'\)/);
  });

  it('passes it into the schedule block', () => {
    expect(sender).toMatch(/label: \(row\.label as string \| null\) \?\? null/);
  });

  it('escapes it, because the owner typed it', () => {
    /*
     * It comes from a free-text field on the quote builder and goes straight
     * into an HTML email. Every other owner-supplied string in this template is
     * escaped; a plan label is no different.
     */
    expect(email).toMatch(/const name = period\.label \? escapeHtml\(period\.label\) : ''/);
  });

  it('puts the name on the row', () => {
    expect(email).toMatch(/\$\{name \? ` \$\{name\}` : ''\}/);
  });
});
