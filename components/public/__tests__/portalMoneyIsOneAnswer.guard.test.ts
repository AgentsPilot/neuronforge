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
