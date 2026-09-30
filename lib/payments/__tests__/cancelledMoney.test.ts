/**
 * Potential money lost: billed or agreed, then called off.
 *
 * The figure behind Money Lost on the reports page and on the insight
 * dashboard. It exists so an owner can see how much business they agreed and
 * then did not get — a question neither Revenue nor Outstanding answers.
 *
 * ── WHAT THESE TESTS ARE REALLY GUARDING ────────────────────────────────────
 * Not the arithmetic. The arithmetic is a subtraction. What is worth testing is
 * that this figure NEVER CONTRADICTS a figure shown next to it:
 *
 *   1. vs the Refund Rate card, one card to its left. Refunding with "cancel
 *      booking" on voids the unpaid invoices as it goes, so a single booking
 *      can finish with a refunded payment BESIDE a cancelled invoice. Counting
 *      face value in both would tell the owner the same money was handed back
 *      AND written off.
 *
 *   2. vs itself, when a plan phase and the invoice raised for it both exist.
 *      Same double-count trap `billedAsAnEntry` already defuses for owed money.
 *
 *   3. vs nothing at all — a draft invoice nobody sent. There is no figure to
 *      contradict; the loss is simply invented. The client was never told a
 *      number, so no number was ever coming.
 *
 * And that one definition serves both surfaces: `cancelledMoneyOf` is called by
 * `totalMoney` here AND by `app/api/business-os/stats/route.ts`, which reads
 * completely different queries. If those two ever drift they drift by exactly
 * the refunded amount, and NEITHER page looks wrong — so the shared rule is
 * tested directly, on the loose rows the stats route actually passes it.
 */
import {
  buildMoneyItems,
  cancelledMoneyOf,
  cancelledPlanMoneyOf,
  totalMoney,
  type MoneyBooking,
  type MoneyInvoice,
  type MoneyTransaction,
} from '../moneyItems';

const booking: MoneyBooking = {
  id: 'bk-1',
  title: 'job',
  startTime: '2026-09-14T16:00:00Z',
  contactId: 'c1',
};

const invoice = (over: Partial<MoneyInvoice> = {}): MoneyInvoice =>
  ({
    id: 'inv-1', invoice_number: 'INV-1', amount: 800, currency: 'ILS',
    status: 'sent', paid_at: null, created_at: '2026-09-20T00:00:00Z',
    contact_id: 'c1', booking_id: 'bk-1', refunded_amount: 0,
    sent_at: '2026-09-20T00:00:00Z', ...over,
  }) as MoneyInvoice;

const transaction = (over: Partial<MoneyTransaction> = {}): MoneyTransaction =>
  ({
    id: 'tx-1', amount: 800, currency: 'ILS', status: 'succeeded',
    paid_at: '2026-09-21T00:00:00Z', created_at: '2026-09-21T00:00:00Z',
    contact_id: 'c1', booking_id: 'bk-1', invoice_id: 'inv-1', refunded_amount: 0, ...over,
  }) as MoneyTransaction;

const period = (over: Record<string, unknown> = {}) => ({
  id: 'p1', installmentNumber: 1, amount: 800, currency: 'ILS',
  dueDate: null, status: 'pending', paidAt: null, transactionId: null,
  trigger: 'manual', invoiceId: null, ...over,
});

const build = (opts: {
  invoices?: MoneyInvoice[];
  transactions?: MoneyTransaction[];
  periods?: Array<Record<string, unknown>>;
}) =>
  buildMoneyItems({
    bookings: [booking],
    invoices: opts.invoices ?? [],
    transactions: opts.transactions ?? [],
    plansByBookingId: opts.periods
      ? {
          'bk-1': {
            id: 'plan-1',
            installmentCount: opts.periods.length,
            periodsPaid: 0,
            status: 'active',
            periods: opts.periods as never,
          },
        }
      : {},
  });

describe('the shared rule, on the loose rows the stats route passes it', () => {
  it('writes off a cancelled invoice that was sent', () => {
    expect(cancelledMoneyOf({ status: 'cancelled', amount: 800, sentAt: 'x' })).toBe(800);
  });

  it('writes off NOTHING for an invoice that was never sent', () => {
    // A drafted-and-binned invoice. The client was never told a number, so no
    // number was ever coming and nothing was lost. Same reasoning that keeps
    // `draft` out of OUTSTANDING_STATUSES, with the sign flipped.
    expect(cancelledMoneyOf({ status: 'cancelled', amount: 800, sentAt: null })).toBe(0);
  });

  it('counts an absent sentAt as sent, rather than silently zeroing it', () => {
    // A caller that predates the field passes nothing. Writing its money down
    // to zero would be a worse default than counting it: it would hide real
    // losses with no error anywhere.
    expect(cancelledMoneyOf({ status: 'cancelled', amount: 800 })).toBe(800);
  });

  it('ignores anything that is not cancelled', () => {
    for (const status of ['paid', 'sent', 'overdue', 'draft', 'refunded']) {
      expect(cancelledMoneyOf({ status, amount: 800, sentAt: 'x' })).toBe(0);
    }
  });

  it('accepts the strings PostgREST hands back for numerics', () => {
    // The stats route passes raw DB rows. `numeric` arrives as a string, and
    // '800' - '300' in JS is not something to leave to chance.
    expect(cancelledMoneyOf({ status: 'cancelled', amount: '800', refunded: '300', sentAt: 'x' })).toBe(500);
  });
});

describe('it must never restate the Refund Rate card beside it', () => {
  it('nets the refunded part out of the write-off', () => {
    expect(
      cancelledMoneyOf({ status: 'cancelled', amount: 800, refunded: 300, sentAt: 'x' })
    ).toBe(500);
  });

  it('writes off nothing at all when the whole thing came back', () => {
    // The refund + cancel-booking flow. Refunded money went back; that is the
    // refund card's fact. This card must stay silent about it or the two cards
    // report the same 800 twice under two different headings.
    expect(
      cancelledMoneyOf({ status: 'cancelled', amount: 800, refunded: 800, sentAt: 'x' })
    ).toBe(0);
  });

  it('never goes negative when a refund exceeds what we recorded', () => {
    // Refunded from the Stripe dashboard against a charge whose transaction was
    // never fully written back. A negative write-off is not a thing that can
    // happen to a business, and it would quietly subtract from other losses.
    expect(
      cancelledMoneyOf({ status: 'cancelled', amount: 800, refunded: 1000, sentAt: 'x' })
    ).toBe(0);
  });

  it('holds end to end: refunded and cancelled money add up, they do not overlap', () => {
    // One booking, refunded and then cancelled — the exact shape the dialog
    // produces. 800 collected and returned, a second 500 invoice voided unpaid.
    const items = build({
      invoices: [
        invoice({ id: 'inv-1', status: 'cancelled', amount: 800, refunded_amount: 800 }),
        invoice({ id: 'inv-2', invoice_number: 'INV-2', status: 'cancelled', amount: 500 }),
      ],
      transactions: [transaction({ amount: 800, refunded_amount: 800, status: 'refunded' })],
    });

    const t = totalMoney(items);
    expect(t.refunded).toBe(800);
    // 500 only. The refunded 800 is reported once, by `refunded`.
    expect(t.cancelled).toBe(500);
  });
});

describe('a stopped plan lost the owner its remaining phases', () => {
  it('writes off a cancelled phase that was never billed', () => {
    // Agreed in writing on a quote the client accepted, then the job stopped.
    // Nobody was ever ASKED for it, but it is exactly the "potential money"
    // this figure is named after — so unlike a binned draft, it counts.
    expect(cancelledPlanMoneyOf({ status: 'cancelled', amount: 700, invoiceId: null })).toBe(700);
  });

  it('writes off nothing for a phase whose invoice already represents it', () => {
    // That invoice is its own cancelled row. Counting both writes one phase off
    // twice — the trap `billedAsAnEntry` defuses for owed money.
    expect(cancelledPlanMoneyOf({ status: 'cancelled', amount: 700, invoiceId: 'inv-9' })).toBe(0);
  });

  it('ignores phases that are merely unbilled rather than cancelled', () => {
    expect(cancelledPlanMoneyOf({ status: 'pending', amount: 700, invoiceId: null })).toBe(0);
  });

  it('counts a stopped 3-phase job once, not twice, when phase 1 was invoiced', () => {
    // Phase 1 billed and then voided; phases 2 and 3 never billed. The loss is
    // the whole 2,100 and each phase contributes exactly once.
    const items = build({
      invoices: [invoice({ id: 'inv-1', status: 'cancelled', amount: 700 })],
      periods: [
        period({ id: 'p1', amount: 700, status: 'cancelled', invoiceId: 'inv-1' }),
        period({ id: 'p2', amount: 700, status: 'cancelled', invoiceId: null }),
        period({ id: 'p3', amount: 700, status: 'cancelled', invoiceId: null }),
      ],
    });

    expect(totalMoney(items).cancelled).toBe(2100);
  });

  it('leaves cancelled phases out of Outstanding, where they were never owed', () => {
    const items = build({
      periods: [
        period({ id: 'p1', amount: 700, status: 'cancelled' }),
        period({ id: 'p2', amount: 700, status: 'pending' }),
      ],
    });

    const t = totalMoney(items);
    expect(t.outstanding).toBe(700);
    expect(t.cancelled).toBe(700);
  });
});

describe('the buckets stay apart', () => {
  it('a business that lost nothing reports zero, not nothing', () => {
    const items = build({ invoices: [invoice({ status: 'paid', paid_at: '2026-09-21T00:00:00Z' })] });
    expect(totalMoney(items).cancelled).toBe(0);
  });

  it('keeps each currency in its own bucket', () => {
    // No FX rate exists anywhere in the platform, so a dollar loss must never
    // land in the shekel total.
    const items = build({
      invoices: [
        invoice({ id: 'inv-1', status: 'cancelled', amount: 800, currency: 'ILS' }),
        invoice({ id: 'inv-2', invoice_number: 'INV-2', status: 'cancelled', amount: 40, currency: 'USD' }),
      ],
    });

    const t = totalMoney(items);
    expect(t.byCurrency.ILS.cancelled).toBe(800);
    expect(t.byCurrency.USD.cancelled).toBe(40);
  });

  it('does not let a write-off leak into revenue', () => {
    // The whole reason this lives on reports and not on the orders page: it is
    // neither money in nor money still coming.
    const items = build({ invoices: [invoice({ status: 'cancelled', amount: 800 })] });
    const t = totalMoney(items);
    expect(t.collected).toBe(0);
    expect(t.outstanding).toBe(0);
    expect(t.cancelled).toBe(800);
  });
});
