/**
 * "You keep" counts money that arrived, never money still to be charged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * An instalment plan of ₪800 in two periods: the first ₪400 collected, the
 * second not yet charged. ₪200 was refunded out of the first. The totals strip
 * reported:
 *
 *     total ₪800   ·   returned ₪200   ·   you keep ₪600
 *
 * ₪600 is `total - refunded`. It counts the second period — money the client
 * has not been asked for and may never pay — as money already in hand. The
 * business holds ₪200.
 *
 * The two formulas agree whenever a plan is fully collected, which is why this
 * survived: every single payment and every finished plan looked right.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { keptAfterRefund, planTotals } from '@/components/payments/PaymentPlanTotals';

describe('what the business keeps', () => {
  it('ignores a period that has not been charged yet', () => {
    const collected = 400; // period 1
    const refunded = 200;

    expect(keptAfterRefund(collected, refunded)).toBe(200);

    /* The figure that used to be shown, named so a regression is unmistakable. */
    const agreedTotal = 800;
    expect(agreedTotal - refunded).toBe(600);
    expect(keptAfterRefund(collected, refunded)).not.toBe(agreedTotal - refunded);
  });

  it('agrees with the old formula once everything has been collected', () => {
    /* Why the bug went unnoticed: on a settled plan the two are identical. */
    const total = 800;
    expect(keptAfterRefund(total, 200)).toBe(total - 200);
  });

  it('is zero when every collected penny went back, not negative', () => {
    expect(keptAfterRefund(400, 400)).toBe(0);
  });

  it('floors at zero when the refund exceeds the charge', () => {
    /* A data fault; a negative "kept" would read as a debt to the client. */
    expect(keptAfterRefund(400, 500)).toBe(0);
  });

  it('is the whole deduction — `collected` is gross of refunds', () => {
    /*
     * A partly refunded period keeps `status: 'paid'`, so `planTotals` counts
     * its full amount. Subtracting the refund here is therefore the only
     * deduction, not a second one on top of an already-netted figure.
     */
    const stages = [
      { installment_number: 1, amount: 400, status: 'paid' },
      { installment_number: 2, amount: 400, status: 'pending' },
    ];

    const totals = planTotals(stages as never, 800);

    expect(totals).toMatchObject({ total: 800, collected: 400, outstanding: 400 });
    expect(keptAfterRefund(totals.collected, 200)).toBe(200);

    /* And the row adds up: collected = kept + returned. */
    expect(keptAfterRefund(totals.collected, 200) + 200).toBe(totals.collected);
  });

  it('still reports what is outstanding, so the row can be made to add up', () => {
    /*
     * The refund trio replaced the ordinary three cells, so the ₪400 still to
     * come vanished from the strip entirely and the job read as finished.
     */
    const stages = [
      { installment_number: 1, amount: 400, status: 'paid' },
      { installment_number: 2, amount: 400, status: 'pending' },
    ];

    const { total, collected, outstanding } = planTotals(stages as never, 800);

    expect(outstanding).toBe(400);
    expect(collected + outstanding).toBe(total);
  });
});
