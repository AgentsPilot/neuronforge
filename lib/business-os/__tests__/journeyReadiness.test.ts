/**
 * What stops a publish, and what merely advises.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The publish gate refused on EITHER gap, so a business that invoices for
 * everything could not put its website live until it connected Stripe — over a
 * payment step its clients would never have seen, because `journeySteps` drops
 * that step when there is no processor and `BookingLifecycleService` raises the
 * invoice regardless.
 *
 * Working hours are the opposite: the `datetime` step stays in the journey and
 * the calendar behind it is empty, so the client reaches a screen with nothing
 * to pick and stops. That is a page not worth publishing.
 *
 * This distinction is the whole rule, so it is asserted directly rather than
 * left to the call site to get right.
 */

import { isBlockingGap, describeJourneyGaps, type JourneyGap } from '../journeyReadiness';

const HOURS: JourneyGap = { kind: 'hours', services: ['Training 60 min'] };
const PROCESSOR: JourneyGap = { kind: 'processor', services: ['Training 60 min'] };
const INVOICING: JourneyGap = { kind: 'invoicing', services: ['Training 60 min'] };

describe('isBlockingGap', () => {
  it('blocks a publish when the calendar cannot be picked from', () => {
    expect(isBlockingGap(HOURS)).toBe(true);
  });

  it('does NOT block a publish for a missing payment processor', () => {
    // Invoicing is the fallback and it is automatic, so the journey still
    // completes and the business still gets paid.
    expect(isBlockingGap(PROCESSOR)).toBe(false);
  });

  /*
   * The other half of the "payments never block" decision.
   *
   * Saying a missing processor is harmless because clients are invoiced instead
   * is only true if an invoice can be issued. Without the business and invoice
   * details there is no way to send one, so the client books, the booking
   * completes, and the money is never asked for.
   */
  it('blocks when a service will be invoiced and no invoice can be issued', () => {
    expect(isBlockingGap(INVOICING)).toBe(true);
  });

  it('separates blocking from advisory when a business has all three', () => {
    const gaps = [HOURS, PROCESSOR, INVOICING];
    expect(gaps.filter(isBlockingGap)).toEqual([HOURS, INVOICING]);
    expect(gaps.filter(g => !isBlockingGap(g))).toEqual([PROCESSOR]);
  });
});

describe('describeJourneyGaps', () => {
  /*
   * The sentence states the PROBLEM, not the roster.
   *
   * It used to open with "Training 60 min, Custom Training, Intro ask clients
   * to pick a time…" — long, least-useful part first, and the same name
   * repeated across two gaps whenever one service had both problems. The fix is
   * the same single setting however many services are affected.
   */
  it('states the problem without listing the services', () => {
    const message = describeJourneyGaps([HOURS]);
    expect(message).toContain('no working hours');
    expect(message).not.toContain('Training 60 min');
  });

  /*
   * The advisory message says what WILL happen, not just what is missing —
   * because something sensible does happen, and an owner who is told only
   * "no processor connected" has no way to know their clients can still buy.
   */
  it('tells the owner that clients will be invoiced instead', () => {
    expect(describeJourneyGaps([PROCESSOR])).toContain('invoiced instead');
  });

  it('tells the owner an invoice could not be sent, not that a field is blank', () => {
    const message = describeJourneyGaps([INVOICING]);
    expect(message).toContain('no way to send one');
    expect(message).not.toContain('Training 60 min');
  });

  it('reads the same however many services are affected', () => {
    // One setting fixes all of them, so the count changes nothing the owner
    // would act on differently.
    const one: JourneyGap = { kind: 'hours', services: ['A'] };
    const many: JourneyGap = { kind: 'hours', services: ['A', 'B', 'C', 'D', 'E'] };
    expect(describeJourneyGaps([many])).toBe(describeJourneyGaps([one]));
  });

  it('keeps the affected services on the gap for a caller that wants them', () => {
    // Dropped from the sentence, not from the data.
    expect(HOURS.services).toEqual(['Training 60 min']);
  });
});

/**
 * A gate asks only for what its own job needs.
 *
 * `missingProfileFields` describes a COMPLETE BUSINESS PROFILE, which is a
 * broader idea than "can issue an invoice": it includes things the readiness
 * chain nudges for because they improve the product. Reusing it wholesale meant
 * a missing LOGO could stop a website being published — an invoice with no logo
 * is a perfectly valid document, and refusing to publish over an image is
 * absurd.
 *
 * The rule is asserted on the message, which is what an owner actually reads.
 */
describe('what the invoicing gap asks for', () => {
  const withFields = (missing: string[]): JourneyGap => ({
    kind: 'invoicing',
    services: ['Training'],
    missing,
  });

  it('names the fields that make an invoice a valid document', () => {
    const message = describeJourneyGaps([withFields(['tax_id', 'address', 'payment_method'])]);
    expect(message).toContain('tax ID');
    expect(message).toContain('business address');
    expect(message).toContain('bank details');
  });

  it('says nothing about fields it was not given', () => {
    // The filtering happens where the gap is built; this guards the message
    // from re-introducing them.
    expect(describeJourneyGaps([withFields(['tax_id'])])).not.toContain('logo');
  });

  it('falls back to the plain sentence when nothing is named', () => {
    const message = describeJourneyGaps([withFields([])]);
    expect(message).toContain('no way to send one');
    expect(message).not.toContain('Still needed');
  });

  it('names a field once even when both checks ask for it', () => {
    // `company_name` is required by the profile check AND the invoice check.
    const message = describeJourneyGaps([withFields(['company_name', 'company_name'])]);
    expect(message.match(/business name/g)).toHaveLength(1);
  });
});
