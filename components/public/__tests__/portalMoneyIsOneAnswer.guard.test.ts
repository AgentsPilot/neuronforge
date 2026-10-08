/**
 * The client portal states ONE thing about the money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO FAULTS, BOTH REPORTED FROM THE SAME CARD
 *
 * 1. TWO SOURCES, DISAGREEING. The stamp read
 *    `scheduling_bookings.payment_status`; the line under it read the state the
 *    portal route DERIVES from the invoices and the plan. On the reporting
 *    account, booking `8079b913` carries one paid invoice and one overdue one
 *    and its own column still says `paid` — so the card stamped a green PAID
 *    beside "₪300 to pay, overdue". The route derives that state precisely
 *    because the column is unreliable; the card then rendered the column
 *    anyway.
 *
 * 2. A DEMAND WITH NO WAY TO ACT ON IT. A quote billed session by session
 *    projects an instalment per session and raises an invoice only when each is
 *    billed. Six sessions of one quote on that account have an amount and no
 *    invoice, so the portal showed "לתשלום ₪74.99" with no button and no
 *    explanation, which reads as a broken page. That is how it was reported.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Both faults are about WHICH value is read, not about what renders. A render
 * test passes a prop and asserts the output, so it would have agreed with the
 * card in both states — it was the relationship between two props that was
 * wrong. Comments are stripped before matching, since the note beside each fix
 * quotes the expression it replaced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const codeOf = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const CARD = 'components/public/AppointmentCard.tsx';
const ROUTE = 'app/api/book/manage/[token]/route.ts';
const COPY = 'lib/i18n/public-pages.ts';

describe('the paid stamp follows what actually happened', () => {
  it('strips comments before matching, or it would fail on its own explanation', () => {
    expect(read(CARD)).toContain('scheduling_bookings.payment_status');
    expect(codeOf(CARD)).not.toContain('scheduling_bookings.payment_status');
  });

  it('prefers the derived state over the booking column', () => {
    const code = codeOf(CARD);
    expect(code).toMatch(/const settledState = payment \?/);
    expect(code).toMatch(/payment\.state === 'paid' \|\| payment\.state === 'refunded'/);
    // The old line, which read the column whenever it was present.
    expect(code).not.toMatch(/const stamp = paymentStatus \? PAYMENT_STAMP\[paymentStatus\]/);
  });

  it('still falls back to the column when no derived state is supplied', () => {
    // Other callers have no invoices to derive from, and for them the column is
    // the only answer there is.
    expect(codeOf(CARD)).toMatch(/: paymentStatus;/);
  });

  it('cannot stamp paid while anything is outstanding', () => {
    /*
     * `due` and `none` reach neither branch of the map, so a booking with money
     * outstanding carries no stamp whatever its column says. This is the whole
     * fix in one assertion.
     */
    const stampMap = codeOf(CARD).slice(
      codeOf(CARD).indexOf('const PAYMENT_STAMP'),
      codeOf(CARD).indexOf('export function AppointmentCard')
    );
    expect(stampMap).toContain('paid:');
    expect(stampMap).toContain('refunded:');
    expect(stampMap).not.toContain('due:');
  });
});

describe('an amount with no invoice behind it says so', () => {
  it('labels the unbilled case instead of leaving a figure with no action', () => {
    const code = codeOf(CARD);
    expect(code).toMatch(/\{!payment\.payUrl && \(/);
    expect(code).toContain("t('portal.not_billed_yet')");
  });

  it('has that wording in every language the portal speaks', () => {
    // A missing key renders the key itself to a client, in their own portal.
    const copy = read(COPY);
    expect(copy.match(/'portal\.not_billed_yet':/g) ?? []).toHaveLength(3);
    expect(copy).toMatch(/'portal\.not_billed_yet': 'not invoiced yet'/);
    expect(copy).toMatch(/'portal\.not_billed_yet': 'טרם הונפקה חשבונית'/);
  });

  it('and the route still offers a link wherever one can be paid', () => {
    const code = codeOf(ROUTE);
    // Open, unpaid, unrefunded, non-zero: the ledger, not the status alone.
    expect(code).toMatch(/\.in\('status', \['sent', 'overdue'\]\)/);
    expect(code).toMatch(/!row\.paid_at/);
    expect(code).toMatch(/payUrl: outstanding > 0 \? payUrl : null/);
  });
});

describe('the portal reports a partial refund', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/book/manage/[token]/route.ts'),
    'utf8'
  );
  const card = fs.readFileSync(
    path.join(process.cwd(), 'components/public/AppointmentCard.tsx'),
    'utf8'
  );

  it('sums what came back across the booking’s invoices', () => {
    /*
     * `state` reaches 'refunded' only when `booking.payment_status` does, and
     * that takes a FULL refund. A client refunded ₪2,250 of ₪9,000 opened their
     * portal to "₪9,000 paid · 2 of 2 payments" — the money was back in their
     * account and the one page they can check said nothing about it.
     *
     * Summed from the invoices because a job billed in stages carries the refund
     * on whichever stage was returned.
     */
    expect(route).toMatch(/const refundedTotal = \(invoices \?\? \[\]\)\.reduce/);
    expect(route).toMatch(/refunded_amount, refunded_at/);
  });

  it('sends it whatever the state says', () => {
    expect(route).toMatch(/refunded: refundedTotal > 0 \? refundedTotal : null/);
  });

  it('the card shows it beside the paid figure, not instead of it', () => {
    /*
     * The client did pay ₪9,000; the refund is a second event. Replacing the
     * figure would say they paid ₪6,750 on a day they paid ₪9,000 — the same
     * misstatement the owner-side stage row had.
     */
    expect(card).toMatch(/payment\.state !== 'refunded' && Number\(payment\.refunded \|\| 0\) > 0/);
  });
});

describe('the portal lists the payments themselves', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/book/manage/[token]/route.ts'),
    'utf8'
  );
  const card = fs.readFileSync(
    path.join(process.cwd(), 'components/public/AppointmentCard.tsx'),
    'utf8'
  );

  it('sends a period per payment, joined to its own invoice', () => {
    /*
     * "2 of 2 paid" summarises something the client cannot see. On a job billed
     * in stages they need to know which payment was which — and once money is
     * returned, which one it came off. A refund attaches to the INVOICE a period
     * raised, so the join is what makes "against which" answerable at all.
     */
    expect(route).toMatch(/periods: \[\.\.\.installments\]/);
    expect(route).toMatch(/refundByInvoice\.get\(row\.invoice_id\)/);
  });

  /*
   * The ORDER of that list, and the name on each row, are pinned next door in
   * `portalNamesItsPayments.guard` — the date sort this used to require turned
   * out to be the bug, because a milestone has no due date to sort on. Left as
   * a pointer rather than restated, so the two cannot drift apart.
   */

  it('the card draws one line per payment, with its own refund', () => {
    expect(card).toMatch(/payment\.plan!\.periods!\.map\(period =>/);
    expect(card).toMatch(/const returned = Number\(period\.refunded \|\| 0\)/);
  });

  it('does not list a single payment under itself', () => {
    /*
     * One payment is already fully described by the line above the list, and
     * repeating it as a one-row table says the same thing twice.
     */
    expect(card).toMatch(/\(payment\.plan\?\.periods\?\.length \?\? 0\) > 1/);
  });

  it('reads a bare DATE on the clock it was written in', () => {
    /*
     * `due_date` has no time and no zone, so it parses to midnight UTC. Read
     * west of UTC that midnight is the previous day, and a client is told their
     * payment fell due a day before the invoice says.
     */
    /* Two assertions rather than one window: the call spans several lines at
       this indentation, and a character count that happens to span them today
       is a count that breaks on the next reformat. */
    expect(card).toMatch(/new Date\(`\$\{period\.dueDate\}T00:00:00Z`\)/);
    expect(card).toMatch(/\{ day: 'numeric', month: 'short' \},\s*'UTC'/);
  });
});
