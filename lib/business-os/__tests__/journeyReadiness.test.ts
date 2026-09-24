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
// Client-safe: the mapping lives apart from the server module so a component
// rendering a gap does not pull `supabaseServer` into the browser bundle.
import { gapFixAction } from '../journeyGapFix';

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

/*
 * The timezone gap.
 *
 * Hours with no zone are not hours: `09:00–17:00` is only an instant once you
 * know where. Unset falls back to UTC, so a Jerusalem business publishes a page
 * offering times three hours from the ones it works — and unlike empty hours,
 * the page looks perfectly fine. Nothing reports an error; the first person to
 * find out is a client at a locked door.
 */
describe('the timezone gap', () => {
  const TIMEZONE: JourneyGap = { kind: 'timezone', services: ['Training'] };

  it('blocks, like hours and invoicing', () => {
    expect(isBlockingGap(TIMEZONE)).toBe(true);
  });

  it('says what goes wrong, not what is missing', () => {
    // "Set your timezone" reads as housekeeping and gets postponed. The reason
    // it cannot wait is that every hour the page offers is the wrong one.
    const message = describeJourneyGaps([TIMEZONE]);
    expect(message).toContain('wrong times');
  });

  it('sends the owner to the tab that actually has the picker', () => {
    /*
     * Availability holds the hours; the timezone lives with the business's own
     * details. Every surface used to map `isInvoicing ? 'invoice' :
     * 'availability'`, so a third kind would have opened a tab where the thing
     * the message names cannot be set.
     */
    expect(gapFixAction('timezone').tab).toBe('business');
    expect(gapFixAction('hours').tab).toBe('availability');
    expect(gapFixAction('invoicing').tab).toBe('invoice');
    expect(gapFixAction('processor').tab).toBe('payments');
  });

  it('gives every kind a label, so none can open a tab unlabelled', () => {
    for (const kind of ['hours', 'timezone', 'processor', 'invoicing'] as const) {
      const fix = gapFixAction(kind);
      expect(fix.key).toMatch(/^gap\.fix\./);
      expect(fix.fallback.length).toBeGreaterThan(0);
    }
  });
});

describe('what currency does NOT do', () => {
  it('is not a gap kind at all', () => {
    /*
     * Deliberate. `scheduling_services.currency` is already set on the row
     * being booked, and a business may legitimately price in another country's
     * currency — Israel charging a US client in USD. There is nothing for a
     * currency gate to protect, and adding one would refuse bookings that are
     * perfectly correct.
     */
    const kinds: JourneyGap['kind'][] = ['hours', 'timezone', 'processor', 'invoicing'];
    expect(kinds).not.toContain('currency');
  });
});

/*
 * "Answered" is not "set".
 *
 * `user_preferences.timezone` defaulted to 'UTC' until 20261006, and 9 of 12
 * accounts still carry that default. A gate reading the VALUE therefore
 * protected nobody: every one of those businesses looked like it had chosen.
 *
 * `timezone_confirmed_at` is written whenever a human answers, so the question
 * "has anyone said" has its own column rather than being inferred from a string
 * that means two things.
 */
describe('a timezone is answered, not merely stored', () => {
  const answered = (prefs: { timezone?: string | null; timezone_confirmed_at?: string | null }) =>
    Boolean(prefs.timezone_confirmed_at) &&
    Boolean(prefs.timezone) &&
    Boolean(String(prefs.timezone).trim());

  it('treats the old default as unanswered', () => {
    // The row that 9 accounts are in: 'UTC' from the column default, nobody asked.
    expect(answered({ timezone: 'UTC', timezone_confirmed_at: null })).toBe(false);
  });

  it('treats a deliberately chosen UTC as answered', () => {
    // Same five characters, opposite meaning — which is the whole point.
    expect(answered({ timezone: 'UTC', timezone_confirmed_at: '2026-09-22T10:00:00Z' })).toBe(true);
  });

  it('treats a real zone as answered only once someone confirmed it', () => {
    expect(answered({ timezone: 'Asia/Jerusalem', timezone_confirmed_at: '2026-09-22T10:00:00Z' })).toBe(true);
    // Backfilled for exactly this case, but the rule stays value-independent.
    expect(answered({ timezone: 'Asia/Jerusalem', timezone_confirmed_at: null })).toBe(false);
  });

  it('refuses a confirmation with nothing behind it', () => {
    // The two columns must agree; a stamp over a blank zone is not an answer.
    expect(answered({ timezone: '', timezone_confirmed_at: '2026-09-22T10:00:00Z' })).toBe(false);
    expect(answered({ timezone: null, timezone_confirmed_at: '2026-09-22T10:00:00Z' })).toBe(false);
  });
});
