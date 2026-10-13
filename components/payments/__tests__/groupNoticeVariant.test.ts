/**
 * Which sentence a booking refund shows, for every shape of booking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A UNIT TEST AND NOT A REGEX
 *
 * This decision has been wrong twice in two days, and both times it was correct
 * code making a wrong choice:
 *
 *   1. "All {count} payments will be refunded in full — ₪400 in total" on a
 *      booking paid half by card and half in cash. Money that could not be
 *      returned was left out of the total but not out of the sentence.
 *
 *   2. Once blocked money was counted, a payment already refunded in full
 *      counted as blocked too — so the dialog offered to return "the remaining
 *      ₪0.00" from a row the owner had just refunded themselves.
 *
 * Both lived inline in JSX, where the only way to check them was to read the
 * whole expression and imagine the data. Enumerating them is the point.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND A PROPOSAL CAN CARRY TEN STAGES
 *
 * So "every shape" means every N — the two-payment case is the one that gets
 * tested by hand and the ten-payment case is the one that ships wrong. The
 * counts below run to ten on purpose.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { groupNoticeVariant } from '../RefundModal';

/** Nothing held back: the ordinary plan where every payment can be returned. */
const clean = (refundableCount: number) =>
  groupNoticeVariant({ refundableCount, blockedAmount: 0, blockedMethod: null });

describe('nothing is held back', () => {
  it('says nothing when a single payment is coming back', () => {
    /*
     * The shape of a job already half refunded: one card payment left to
     * return, the cash one settled weeks ago. The plain single-payment dialog
     * is accurate on its own, and "all 1 payments will be refunded in full"
     * is the sentence this prevents.
     */
    expect(clean(1)).toBeNull();
  });

  it('says nothing when there is nothing to return at all', () => {
    // Reached while the dialog is still loading its figures.
    expect(clean(0)).toBeNull();
  });

  it.each([2, 3, 5, 10])('names the count when %i payments are coming back', count => {
    expect(clean(count)).toBe('plain');
  });
});

describe('money is held back', () => {
  it('names it as manual when it all arrived one way we can name', () => {
    // Cash has to be handed over; the sentence says so.
    expect(
      groupNoticeVariant({ refundableCount: 1, blockedAmount: 400, blockedMethod: 'cash' })
    ).toBe('manual');
  });

  it('stays generic when the blocked money has no single method', () => {
    /*
     * Two blocked payments taken different ways have no honest single
     * sentence — and a Stripe payment whose charge reference was never written
     * is blocked for a reason that has nothing to do with cash. Telling that
     * owner to hand money back sends them after money that does not exist.
     */
    expect(
      groupNoticeVariant({ refundableCount: 1, blockedAmount: 400, blockedMethod: null })
    ).toBe('partial');
  });

  it.each([1, 2, 10])('warns regardless of how many are coming back (%i)', refundableCount => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Held-back money outranks the count. An earlier version only showed a
     * notice when several payments were returning, which silently dropped
     * the warning in exactly the case it was written for: one card payment
     * returning here, one cash payment the owner still has to hand back.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(
      groupNoticeVariant({ refundableCount, blockedAmount: 400, blockedMethod: 'cash' })
    ).toBe('manual');
  });
});

describe('a payment that is already refunded is not held back', () => {
  it('is silent rather than offering to return nothing', () => {
    /*
     * Zero remaining is the signature: unrefundable because it is DONE, not
     * because the money is stuck. `refundGroup` takes the same view and skips
     * such a leg instead of failing it.
     */
    expect(
      groupNoticeVariant({ refundableCount: 1, blockedAmount: 0, blockedMethod: 'cash' })
    ).toBeNull();
  });

  it('still names the count when others are coming back', () => {
    expect(
      groupNoticeVariant({ refundableCount: 4, blockedAmount: 0, blockedMethod: 'cash' })
    ).toBe('plain');
  });
});
