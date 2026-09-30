/**
 * The trial's credit total — a permanent guard (credit deduction slice 5,
 * requirement BD-16 and B-12, SA constraints 1–3).
 *
 * The figure itself is the user's (2,000 credits, 2026-09-30) and is pinned in
 * `productionConfig.test.ts`. This suite guards what must stay true whatever the
 * figure becomes:
 *
 * 1. It is a one-off TOTAL, never a monthly rate: running out ends the trial
 *    (FR-18, FR-27), and the plan screen's "or when the credits run out" wording
 *    keys on the `total` shape.
 * 2. It is a whole number (the value schema is integer).
 * 3. It comfortably exceeds a real setup (B-12). The worst measured setup month
 *    is ~347 credits and one generated image is ~250
 *    (docs/architecture/BUSINESS_OS_CREDIT_PRICING.md §4.6), so a total near the
 *    old 250 would end a genuine trial on its first day. The floor of 1,000 was
 *    confirmed by SA (slice 5 workplan review, Q-1). There is deliberately no
 *    upper bound: that is a pricing decision.
 */

import { COHORTS } from '@/lib/business-os/entitlements/config/cohorts';

/** SA Q-1: about 3× the worst measured setup month, room for four images. */
const SETUP_FLOOR_CREDITS = 1000;

const allowance = COHORTS.trial.values['credits.allowance'] as unknown;

describe('the trial credit total (BD-16, B-12)', () => {
  it('is a one-off total, never a monthly rate', () => {
    expect(allowance).toEqual({ total: expect.any(Number) });
    expect(allowance).not.toHaveProperty('perMonth');
  });

  it('is a whole number', () => {
    const { total } = allowance as { total: number };
    expect(Number.isInteger(total)).toBe(true);
  });

  it(`comfortably exceeds a real setup (at least ${SETUP_FLOOR_CREDITS.toLocaleString('en-US')} credits)`, () => {
    const { total } = allowance as { total: number };
    expect(total).toBeGreaterThanOrEqual(SETUP_FLOOR_CREDITS);
  });
});
