/**
 * THE FIGURES, THE BAR AND THE FILTER MUST AGREE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The orders page now shows a figure per state, a bar per order, and a filter
 * behind each figure. Three readings of the same money, and the only thing
 * stopping them drifting is that all three go through `itemFlow` / `totalMoney`
 * / `isLateEntry`. A number the reader can click has to open a list that
 * matches it, or the number is worse than nothing.
 *
 * `overdue` is deliberately a SUBSET of `outstanding`. Every test here checks
 * that, because a fourth bucket would double-count every late invoice the
 * moment somebody summed the row of figures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { itemFlow, isLateEntry, isLatePeriod, totalMoney } from '../moneyItems';
import type { MoneyItem } from '../moneyItems';

const YESTERDAY = '2020-01-01';
const NEXT_YEAR = '2999-01-01';

const entry = (over: Partial<MoneyItem['entries'][number]>) =>
  ({
    key: 'e1',
    method: 'invoice',
    status: 'awaiting_payment',
    amount: 100,
    refunded: 0,
    currency: 'ILS',
    date: NEXT_YEAR,
    dateKind: 'due',
    invoiceId: 'i1',
    invoiceNumber: 'INV-1',
    transactionIds: [],
    description: null,
    contactName: null,
    contactEmail: null,
    ...over,
  }) as MoneyItem['entries'][number];

const item = (over: Partial<MoneyItem>): MoneyItem =>
  ({
    key: 'k',
    kind: 'booking',
    title: 'x',
    status: 'awaiting_payment',
    method: 'invoice',
    amount: 100,
    refunded: 0,
    currency: 'ILS',
    date: NEXT_YEAR,
    bookingId: 'b1',
    contactId: null,
    contactName: null,
    entries: [],
    simple: false,
    ...over,
  }) as MoneyItem;

describe('what counts as late', () => {
  it('a due date that has passed, without waiting for the overdue sweep', () => {
    // The sweep is a cron. A figure that read `status` alone would sit at zero
    // all morning and jump when a job ran.
    expect(isLateEntry(entry({ status: 'awaiting_payment', date: YESTERDAY }))).toBe(true);
  });

  it('and the status, for anything the processor already marked', () => {
    expect(isLateEntry(entry({ status: 'overdue', date: NEXT_YEAR }))).toBe(true);
  });

  it('but never money that has already settled', () => {
    expect(isLateEntry(entry({ status: 'paid', date: YESTERDAY }))).toBe(false);
    expect(isLateEntry(entry({ status: 'cancelled', date: YESTERDAY }))).toBe(false);
  });

  it('nor a date that is not a due date', () => {
    // `dateKind: 'created'` means the row is dated by when it was raised.
    expect(isLateEntry(entry({ dateKind: 'created', date: YESTERDAY }))).toBe(false);
  });

  it('a plan period goes by its own due date, having no status for it', () => {
    // Only the due date, because that is all the rule reads. Passing a whole
    // period here described the fixture rather than the behaviour — and an
    // object literal carrying fields the parameter does not declare is an
    // excess-property error, which is what the first version of this was.
    expect(isLatePeriod({ dueDate: YESTERDAY })).toBe(true);
    expect(isLatePeriod({ dueDate: NEXT_YEAR })).toBe(false);
    expect(isLatePeriod({ dueDate: null })).toBe(false);
  });
});

describe('overdue is part of outstanding, never beside it', () => {
  const late = item({ entries: [entry({ date: YESTERDAY, amount: 250 })] });

  it('the same money appears in both figures', () => {
    const flow = itemFlow(late);
    expect(flow.outstanding).toBe(250);
    expect(flow.overdue).toBe(250);
  });

  it('so the summary must subtract it to show what is merely waiting', () => {
    const totals = totalMoney([
      late,
      item({ key: 'k2', entries: [entry({ key: 'e2', date: NEXT_YEAR, amount: 100 })] }),
    ]);

    expect(totals.outstanding).toBe(350);
    expect(totals.overdue).toBe(250);
    // What the "Outstanding" card renders — and 100 + 250 is the whole 350.
    expect(totals.outstanding - totals.overdue).toBe(100);
  });
});

describe('a row and the summary read the same money', () => {
  it('itemFlow summed equals totalMoney, which is what keeps the bar honest', () => {
    const items = [
      item({ entries: [entry({ status: 'paid', amount: 400, dateKind: 'paid' })] }),
      item({ key: 'k2', entries: [entry({ key: 'e2', date: YESTERDAY, amount: 250 })] }),
      item({
        key: 'k3',
        entries: [],
        plan: {
          periods: [
            { id: 'p1', installmentNumber: 1, amount: 300, dueDate: NEXT_YEAR, status: 'pending', currency: 'ILS' },
            { id: 'p2', installmentNumber: 2, amount: 300, dueDate: YESTERDAY, status: 'pending', currency: 'ILS' },
          ],
        },
      } as never),
    ];

    const totals = totalMoney(items);
    const summed = items.reduce(
      (acc, one) => {
        const flow = itemFlow(one);
        return {
          collected: acc.collected + flow.collected,
          outstanding: acc.outstanding + flow.outstanding,
          overdue: acc.overdue + flow.overdue,
          cancelled: acc.cancelled + flow.cancelled,
          refunded: acc.refunded + flow.refunded,
        };
      },
      { collected: 0, outstanding: 0, overdue: 0, cancelled: 0, refunded: 0 }
    );

    expect(summed.collected).toBe(totals.collected);
    expect(summed.outstanding).toBe(totals.outstanding);
    expect(summed.overdue).toBe(totals.overdue);
    expect(summed.cancelled).toBe(totals.cancelled);
    expect(summed.refunded).toBe(totals.refunded);
  });

  it('a plan of twelve periods still yields at most five segments', () => {
    /*
     * The bar groups by STATE, not by period, so its width is bounded by the
     * number of states and never by the length of the schedule. Twelve
     * instalments — four paid, one late, seven to come — is three segments.
     */
    const twelve = item({
      key: 'k12',
      /*
       * The four settled periods carry their invoices, as they do in reality: a
       * period is billed by raising one, and `billedAsAnEntry` then counts the
       * invoice rather than the period so the same money is not added twice.
       * Without them `collected` would read zero here and the test would be
       * describing its own fixture rather than the product.
       */
      entries: Array.from({ length: 4 }, (_, i) =>
        entry({ key: `paid${i}`, status: 'paid', amount: 100, dateKind: 'paid' })
      ),
      plan: {
        periods: Array.from({ length: 12 }, (_, i) => ({
          id: `p${i + 1}`,
          installmentNumber: i + 1,
          amount: 100,
          currency: 'ILS',
          dueDate: i < 5 ? YESTERDAY : NEXT_YEAR,
          status: i < 4 ? 'paid' : 'pending',
        })),
      },
    } as never);

    const flow = itemFlow(twelve);
    expect(flow.collected).toBe(400); // four settled
    expect(flow.outstanding).toBe(800); // eight unpaid
    expect(flow.overdue).toBe(100); // the fifth, past its date

    const segments = [flow.collected, flow.outstanding - flow.overdue, flow.overdue, flow.cancelled, flow.refunded]
      .filter(v => v > 0);
    // Collected · waiting · late. Three, not twelve — and it would still be
    // three at a hundred instalments.
    expect(segments).toHaveLength(3);
  });
});
