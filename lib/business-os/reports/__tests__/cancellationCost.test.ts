/**
 * What cancellations cost, and the ratio that makes it mean something.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The figure alone is inert. "6,575 was written off" gets filed away; "you took
 * 16,775 and lost 6,575, about 39% of what came in" gets looked into. So the
 * ratio is the product here, and the cases below are the ones where a ratio
 * either misleads or cannot honestly be given at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cancellationCost } from '@/lib/business-os/reports/cancellationCost';

type Rows = { data: unknown[] | null; error: unknown };

/**
 * The four reads, answered in the order the module issues them:
 * paid invoices, transactions, cancelled invoices, cancelled plan phases.
 */
function fakeClient(responses: {
  paid?: Rows;
  transactions?: Rows;
  cancelled?: Rows;
  phases?: Rows;
}) {
  const empty: Rows = { data: [], error: null };
  let invoiceCall = 0;

  return {
    from(table: string) {
      const chain: Record<string, unknown> = {
        _status: null as string | null,
        select: () => chain,
        eq(column: string, value: string) {
          if (column === 'status') chain._status = value;
          return chain;
        },
        in: () => chain,
        gte: () => chain,
        lt: () => chain,
        then(resolve: (value: Rows) => unknown) {
          let answer: Rows = empty;
          if (table === 'payment_transactions') answer = responses.transactions ?? empty;
          else if (table === 'payment_plan_installments') answer = responses.phases ?? empty;
          else if (table === 'payment_invoices') {
            /* The module reads this table twice: the paid set with `.in(...)`,
               then the cancelled set with `.eq('status','cancelled')`. */
            answer =
              chain._status === 'cancelled'
                ? (responses.cancelled ?? empty)
                : (responses.paid ?? empty);
            invoiceCall++;
          }
          return Promise.resolve(answer).then(resolve);
        },
      };
      return chain;
    },
    _invoiceCalls: () => invoiceCall,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in for SupabaseClient
  } as any;
}

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-29T00:00:00.000Z';

/* A cancelled invoice only counts when somebody was really asked for it — a
   send date, or a booking behind it. See `cancelledMoneyOf`. */
const realCancellation = (amount: number, over: Record<string, unknown> = {}) => ({
  id: 'inv-c',
  status: 'cancelled',
  amount,
  refunded_amount: null,
  currency: 'ILS',
  sent_at: '2026-10-05',
  booking_id: 'book-1',
  ...over,
});

describe('the ratio', () => {
  it('reports the loss against what actually came in', () => {
    return cancellationCost(
      fakeClient({
        paid: { data: [{ id: 'inv-1', amount: 30000, refunded_amount: null, currency: 'ILS' }], error: null },
        cancelled: { data: [realCancellation(10000)], error: null },
      }),
      'owner-1',
      FROM,
      TO
    ).then(cost => {
      expect(cost.collected).toBe(30000);
      expect(cost.lost).toBe(10000);
      /* The sentence the owner should read: a third of what you earned. */
      expect(cost.shareOfCollected).toBeCloseTo(33.33, 1);
      expect(cost.currency).toBe('ILS');
    });
  });

  it('is null, not zero, when nothing was collected', async () => {
    const cost = await cancellationCost(
      fakeClient({ cancelled: { data: [realCancellation(5000)], error: null } }),
      'owner-1',
      FROM,
      TO
    );

    /* Losing 5,000 in a period that took nothing is not "0% lost" and is not a
       percentage at all. The narrative needs to reach for a sentence instead. */
    expect(cost.lost).toBe(5000);
    expect(cost.shareOfCollected).toBeNull();
  });
});

describe('what counts as lost', () => {
  it('ignores a binned draft nobody was ever sent', async () => {
    const cost = await cancellationCost(
      fakeClient({
        paid: { data: [{ id: 'p', amount: 1000, refunded_amount: null, currency: 'ILS' }], error: null },
        cancelled: {
          data: [realCancellation(900, { sent_at: null, booking_id: null })],
          error: null,
        },
      }),
      'owner-1',
      FROM,
      TO
    );

    /* Deleting a draft is not losing money, and counting it would invent a debt
       and teach the owner to distrust the figure. */
    expect(cost.lost).toBe(0);
  });

  it('counts an agreed phase nobody was ever billed for', async () => {
    const cost = await cancellationCost(
      fakeClient({
        paid: { data: [{ id: 'p', amount: 1000, refunded_amount: null, currency: 'ILS' }], error: null },
        phases: {
          data: [{ status: 'cancelled', amount: 700, invoice_id: null, currency: 'ILS' }],
          error: null,
        },
      }),
      'owner-1',
      FROM,
      TO
    );

    /* A quote agreed at three phases and stopped after the first lost phases
       two and three. Nobody raised an invoice; it was still agreed in writing. */
    expect(cost.lost).toBe(700);
  });

  it('does not write off a phase twice when it has its own invoice', async () => {
    const cost = await cancellationCost(
      fakeClient({
        paid: { data: [{ id: 'p', amount: 1000, refunded_amount: null, currency: 'ILS' }], error: null },
        cancelled: { data: [realCancellation(700)], error: null },
        phases: {
          data: [{ status: 'cancelled', amount: 700, invoice_id: 'inv-c', currency: 'ILS' }],
          error: null,
        },
      }),
      'owner-1',
      FROM,
      TO
    );

    /* The invoice is its own cancelled row. Counting the phase as well bills
       the client twice in the report. */
    expect(cost.lost).toBe(700);
  });
});

describe('currencies are never added together', () => {
  it('reports the dominant one and says the figures are partial', async () => {
    const cost = await cancellationCost(
      fakeClient({
        paid: {
          data: [
            { id: 'a', amount: 9000, refunded_amount: null, currency: 'ILS' },
            { id: 'b', amount: 400, refunded_amount: null, currency: 'USD' },
          ],
          error: null,
        },
        cancelled: { data: [realCancellation(1000)], error: null },
      }),
      'owner-1',
      FROM,
      TO
    );

    /* CLAUDE.md § Currency. No rate exists here, so the larger currency's
       figures are the answer and the caller is told there were others. */
    expect(cost.currency).toBe('ILS');
    expect(cost.mixedCurrency).toBe(true);
    expect(cost.collected).toBe(9000);
  });
});

describe('it fails quietly', () => {
  it('reports nothing rather than taking the weekly note down', async () => {
    const cost = await cancellationCost(
      fakeClient({ paid: { data: null, error: { message: 'boom' } } }),
      'owner-1',
      FROM,
      TO
    );

    expect(cost).toEqual({
      collected: 0,
      lost: 0,
      shareOfCollected: null,
      currency: null,
      mixedCurrency: false,
    });
  });
});
