/**
 * What the refunds COST, which is not the amount refunded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe does not return the processing fee on a refunded payment. Give back
 * ₪200 and the business is down roughly ₪6.30 with nothing to show for it — and
 * because the sale and the refund cancel exactly on every screen that does not
 * subtract fees, an account with many refunds looks flat while it is losing
 * money. The column that records this has existed since `20260904_processor_fees`
 * and no detector read it.
 *
 * The detector already fired on the right condition. What it SAID was a ratio
 * ("18.8% refund rate"), which an owner reads as a service-quality signal and
 * can reasonably accept. The unrecoverable money is the actionable sentence.
 *
 * Three ways the money sentence goes wrong, and each has its own test:
 *
 *   summed across currencies  → shekels added to dollars, found by nobody
 *   null treated as zero      → the loss understated, silently
 *   put in processParameters  → written, stored, and never rendered
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { CashRefundPatternDetector } from '../CashRefundPatternDetector';

/** The smallest Supabase stand-in this detector exercises. */
function client(transactions: Record<string, unknown>[], contacts: Record<string, unknown>[] = []) {
  const table = (rows: Record<string, unknown>[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'not', 'limit']) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (r: unknown) => unknown) => resolve({ data: rows, error: null });
    return chain;
  };

  return {
    from: (name: string) => {
      if (name === 'payment_transactions') return table(transactions);
      if (name === 'crm_contacts') return table(contacts);
      // `isOnCooldown` and `logDetection` read the insights table.
      return table([]);
    },
  } as never;
}

const detectorFor = (transactions: Record<string, unknown>[]) => {
  const detector = new CashRefundPatternDetector(client(transactions));
  jest.spyOn(detector as never as { isOnCooldown: () => Promise<boolean> }, 'isOnCooldown')
    .mockResolvedValue(false);
  return detector;
};

/** A clean sale. The denominator of the refund rate. */
const sale = (id: string) => ({
  id,
  amount: '200',
  status: 'succeeded',
  refund_status: null,
  refunded_amount: null,
  created_at: new Date().toISOString(),
});

/** A refunded one, with whatever fee facts the test is about. */
const refunded = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  amount: '200',
  status: 'succeeded',
  refund_status: 'full',
  refunded_amount: '200',
  refund_reason: 'Client cancelled',
  contact_id: null,
  created_at: new Date().toISOString(),
  processor_fee: 6.3,
  fee_currency: 'ILS',
  ...over,
});

/** Enough volume to clear `minSamples: 10` and the 5% threshold. */
const withRefunds = (refunds: Record<string, unknown>[]) => [
  ...Array.from({ length: 12 }, (_, i) => sale(`s${i}`)),
  ...refunds,
];

describe('the money it reports', () => {
  it('names the fees the processor kept and will not return', async () => {
    const result = await detectorFor(
      withRefunds([refunded('r1'), refunded('r2'), refunded('r3')])
    ).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result!.narrationSubject).toContain('18.9 ILS');
    expect(result!.narrationSubject).toMatch(/not returned|not recoverable/);
  });

  /*
   * Stripe charges the fee in the SETTLEMENT currency, so a business settling
   * in ILS that takes a USD payment has a USD amount and an ILS fee. One total
   * across both would be a number with no meaning.
   */
  it('never adds one currency to another', async () => {
    const result = await detectorFor(
      withRefunds([
        refunded('r1', { processor_fee: 6.3, fee_currency: 'ILS' }),
        refunded('r2', { processor_fee: 2.5, fee_currency: 'USD' }),
        refunded('r3', { processor_fee: 3.7, fee_currency: 'ILS' }),
      ])
    ).evaluate('user-1');

    expect(result!.narrationSubject).toContain('10 ILS');
    expect(result!.narrationSubject).toContain('2.5 USD');
    // 12.5 would be the two added together.
    expect(result!.narrationSubject).not.toContain('12.5');
  });

  /*
   * The column is null for "not fetched yet", never for "cost nothing". A
   * figure built over partial data understates the loss, so the sentence says
   * how much it does not know rather than reporting the rest as the total.
   */
  it('says how many fees it does not know, rather than counting them as zero', async () => {
    const result = await detectorFor(
      withRefunds([
        refunded('r1'),
        refunded('r2', { processor_fee: null, fee_currency: null }),
        refunded('r3', { processor_fee: null, fee_currency: null }),
      ])
    ).evaluate('user-1');

    expect(result!.narrationSubject).toContain('6.3 ILS');
    expect(result!.narrationSubject).toContain('2 more');
  });

  it('says nothing about fees when it knows none of them', async () => {
    const result = await detectorFor(
      withRefunds([
        refunded('r1', { processor_fee: null }),
        refunded('r2', { processor_fee: null }),
        refunded('r3', { processor_fee: null }),
      ])
    ).evaluate('user-1');

    // An absent subject, not a sentence about 0 — the detector still fires on
    // the rate, it simply has nothing to add about cost.
    expect(result).not.toBeNull();
    expect(result!.narrationSubject).toBeUndefined();
  });
});

describe('the denominator counts each payment once', () => {
  /*
   * The defect this replaced. `refund_status` is the authoritative field and
   * `status` is a projection that often still reads `succeeded` on a refunded
   * row, so the two sets overlap — and the old denominator added their lengths.
   */
  it('does not count a refunded payment in both halves', async () => {
    // 12 clean sales + 3 refunded = 15 payments, 3 refunds. 20%, not 16.7%.
    const result = await detectorFor(
      withRefunds([refunded('r1'), refunded('r2'), refunded('r3')])
    ).evaluate('user-1');

    expect(result!.currentValue).toBe(20);
  });

  /*
   * The same account with the projection CAUGHT UP. Both shapes occur in live
   * data, and the rate must not depend on which one a row happens to be in.
   */
  it('reports the same rate whether or not status caught up', async () => {
    const projected = await detectorFor(
      withRefunds([
        refunded('r1', { status: 'refunded' }),
        refunded('r2', { status: 'refunded' }),
        refunded('r3', { status: 'refunded' }),
      ])
    ).evaluate('user-1');

    expect(projected!.currentValue).toBe(20);
  });

  /*
   * It erred towards silence, which is why it went unnoticed for so long: a
   * low rate fires later than the threshold promises. An account at exactly
   * 5 refunds of 20 is 25%, and under the old arithmetic read as 20%.
   */
  it('no longer under-reports, so the threshold means what it says', async () => {
    const result = await detectorFor([
      ...Array.from({ length: 15 }, (_, i) => sale(`s${i}`)),
      ...Array.from({ length: 5 }, (_, i) => refunded(`r${i}`)),
    ]).evaluate('user-1');

    expect(result!.currentValue).toBe(25);
  });
});

describe('what it does not change', () => {
  /*
   * `estimatedImpactUsd` feeds impact ranking across every insight. Swapping a
   * four-figure refund total for a two-figure fee would quietly drop refund
   * problems down the dashboard — so the fee is reported in words, not by
   * moving a number other things sort on.
   */
  it('still ranks on the amount refunded, not on the fee', async () => {
    const result = await detectorFor(
      withRefunds([refunded('r1'), refunded('r2'), refunded('r3')])
    ).evaluate('user-1');

    expect(result!.estimatedImpactUsd).toBe(600);
  });

  it('still reports the rate as a percentage', async () => {
    const result = await detectorFor(
      withRefunds([refunded('r1'), refunded('r2'), refunded('r3')])
    ).evaluate('user-1');

    expect(result!.currentValueUnit).toBe('percent');
    /*
     * 3 refunds of 15 payments. It used to report 16.7.
     *
     * The denominator was `succeeded.length + refunded.length`, and a refunded
     * transaction is in BOTH — `refund_status` is authoritative while `status`
     * stays `succeeded` — so every refunded row was counted twice. The rate
     * came out LOW, which is why nobody noticed: the detector fired later than
     * its own threshold says, and a 15% account was reported at 12.5%, one
     * severity step down.
     */
    expect(result!.currentValue).toBe(20);
  });

  it('stays quiet for an account below the threshold', async () => {
    const quiet = [...Array.from({ length: 40 }, (_, i) => sale(`s${i}`)), refunded('r1')];

    expect(await detectorFor(quiet).evaluate('user-1')).toBeNull();
  });
});
