/**
 * Both refund paths act on everything the caller asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER DID, AND WHAT THEY GOT
 *
 * A one-payment booking. Refund part of it, and tick "cancel the booking as
 * well". The money went back, the API answered 200 with `success: true`, and
 * the booking kept its old status — still reading "waiting on the client".
 *
 * Half the instruction was dropped, and the response said everything worked.
 * That is the worst shape this can take: a silent, POSITIVE failure. Nothing on
 * screen suggested the cancel had not happened, so the owner had no reason to
 * check.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONLY ONE PAYMENT
 *
 * This route has two paths. SEVERAL transactions — a payment plan — go through
 * the group path, which honoured `stop_plan` AND `cancel_booking`. ONE
 * transaction goes through the single path, which read `stop_plan` and nothing
 * else.
 *
 * So a plan-backed booking cancelled correctly and a one-payment booking did
 * not, which is exactly how it was reported.
 *
 * The schema was never the problem: `cancel_booking` is declared, and the
 * refine refuses the request unless a `cancel_reason` comes with it. The caller
 * is made to supply both, and then one path threw it away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDERING, WHICH IS NOT INCIDENTAL
 *
 * The cancel runs AFTER the refund on both paths. The group path states why in
 * its own words: freeing the slot emails the client, and telling somebody their
 * booking is off while their money is still held is worse than telling them
 * nothing yet.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SOURCE = 'app/api/payments/refunds/route.ts';

const source = fs
  .readFileSync(path.join(process.cwd(), SOURCE), 'utf8')
  .replace(/\r\n/g, '\n');

/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the instruction is accepted in full', () => {
  it('the schema declares both switches', () => {
    expect(code).toMatch(/cancel_booking: z\.boolean\(\)\.optional\(\)/);
    expect(code).toMatch(/stop_plan/);
  });

  it('and refuses either without a reason to tell the client', () => {
    expect(code).toMatch(/!\(body\.stop_plan \|\| body\.cancel_booking\) \|\| !!body\.cancel_reason/);
  });
});

describe('both paths act on it', () => {
  it('cancels the booking on BOTH paths, not just the group one', () => {
    /*
     * THE BUG, AS ONE ASSERTION. One call site is the group path; the single
     * path had none, so a one-payment booking was never cancelled.
     */
    const calls = code.match(/await cancelBookingBehind\(/g) ?? [];

    expect(calls).toHaveLength(2);
  });

  it('stops the plan on both paths, which already worked', () => {
    /* Kept so a later tidy-up cannot remove one and recreate the asymmetry in
       the other direction. */
    const calls = code.match(/await stopPlanBehind\(/g) ?? [];

    expect(calls).toHaveLength(2);
  });

  it('reports what it did, so a dropped instruction cannot hide behind a 200', () => {
    /* `booking_cancelled` in both responses: the caller can see whether the
       second half of the request actually happened. */
    const reported = code.match(/booking_cancelled/g) ?? [];

    expect(reported.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the cancel never runs before the money is back', () => {
  it('on the single path', () => {
    /* Freeing the slot emails the client. Told their booking is off while the
       refund is still held is worse than told nothing yet. */
    const single = code.slice(code.lastIndexOf('const planStopped'));
    const refundAt = code.indexOf('const result = await refund({');
    const cancelAt = code.lastIndexOf('await cancelBookingBehind(');

    expect(refundAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeGreaterThan(refundAt);
    expect(single).toContain('cancelBookingBehind');
  });

  it('on the group path', () => {
    /* Anchored on where the refunds are actually performed — `refundGroup` —
       rather than on a field that is also read elsewhere in the block. */
    const groupRefund = code.indexOf('await refundGroup({');
    const groupCancel = code.indexOf('await cancelBookingBehind(');

    expect(groupRefund).toBeGreaterThan(-1);
    expect(groupCancel).toBeGreaterThan(groupRefund);
  });
});
