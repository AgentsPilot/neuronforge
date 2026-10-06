/**
 * A PLAN CARD MAY ONLY BE DRAWN FOR A BOOKING THAT IS ON A PLAN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY IT IS A SOURCE TEST
 *
 * The drawer decided "this sale is an instalment plan" from the SERVICE's
 * configuration alone — `payment_type`, `installment_count`, `price`. That is a
 * statement about how the service is MEANT to be sold, not about what happened
 * to this booking.
 *
 * The two came apart the moment a path billed such a service in full. The
 * owner's own booking path did exactly that, so a ₪800 service configured as
 * "2 × ₪400" was charged ₪800 and the card displayed ₪400 — and the refund the
 * card offered followed the display rather than the charge. Two wrongs that
 * concealed each other: the owner saw precisely the figure they expected.
 *
 * The card now defers to the money: if what arrived already covers the whole
 * price, this was not billed as a plan whatever the service says. That rule
 * also survives the case where a plan was charged correctly but never recorded
 * locally — a Stripe subscription whose webhook never bound — where the
 * agreement is still the best description of what the client was asked for.
 *
 * This test pins it because the failure it prevents is silent, is about money,
 * and is easy to reintroduce by "simplifying" the check back to the service
 * fields alone.
 *
 * Rendering the drawer to assert this would mean standing up a component whose
 * load path spans several endpoints. The condition is three lines of source, so
 * the source is what is checked.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const DRAWER = join(__dirname, '..', 'CRMContactDrawerV2.tsx');

describe('the contact drawer decides a plan from the booking, not the service', () => {
  const source = readFileSync(DRAWER, 'utf8');

  /** The `const isPlan = …;` assignment, whitespace and all. */
  const condition = source.match(/const isPlan\s*=\s*([\s\S]*?);/);

  it('has exactly one place that decides it', () => {
    const occurrences = source.match(/const isPlan\s*=/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it('defers to the money that actually arrived', () => {
    /*
     * `billedInFull` is computed from the booking's transactions and its paid
     * invoice. A path that ignored the plan and took the whole price leaves
     * exactly that trace, and the card must follow it rather than the service's
     * configuration — otherwise it shows "1 of 2 × ₪400" over an ₪800 charge,
     * and offers a ₪400 refund against it.
     */
    expect(condition).not.toBeNull();
    expect(condition![1]).toContain('billedInFull');
  });

  it('still requires the service to be sold in instalments', () => {
    // Both halves matter: the booking says a plan exists, the service says what
    // its shape is. Dropping the second would draw a plan card for a quote's
    // staged invoice, which is a different arrangement with its own display.
    expect(condition![1]).toContain('installments');
    expect(condition![1]).toContain('installment_count');
  });
});
