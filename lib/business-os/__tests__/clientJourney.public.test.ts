import { journeySteps, shouldTakePayment } from '../clientJourney';

/**
 * The three services this was found on, verbatim from the database.
 *
 * The public booking page showed all three the same journey — every one sent to
 * pick a time, none asked for payment — because the endpoint the page reads its
 * services from selected neither `is_scheduled` nor `collection`. The widget
 * asks `is_scheduled !== false`, so an ABSENT field reads as scheduled.
 */
const FREE_APPOINTMENT = { is_scheduled: true, collection: null, price: 0 };
const PAID_PRODUCT = { is_scheduled: false, collection: 'online' as const, price: 1000 };
const INVOICED_APPOINTMENT = { is_scheduled: true, collection: 'invoice' as const, price: 200 };

const READY = { processorReady: true };

describe('journeySteps — three services, three journeys', () => {
  it('a free appointment picks a time and never pays', () => {
    expect(journeySteps(FREE_APPOINTMENT, READY)).toEqual([
      'service', 'datetime', 'details', 'confirmation',
    ]);
  });

  it('a paid product pays and never picks a time', () => {
    // The regression: this was being sent to a date step for a thing that has
    // no date.
    expect(journeySteps(PAID_PRODUCT, READY)).toEqual([
      'service', 'details', 'payment', 'confirmation',
    ]);
  });

  it('an invoiced appointment picks a time and is billed afterwards', () => {
    expect(journeySteps(INVOICED_APPOINTMENT, READY)).toEqual([
      'service', 'datetime', 'details', 'confirmation',
    ]);
  });

  it('gives three different journeys, which is the whole point', () => {
    const journeys = [FREE_APPOINTMENT, PAID_PRODUCT, INVOICED_APPOINTMENT]
      .map(service => journeySteps(service, READY).join('>'));
    expect(new Set(journeys).size).toBe(2); // the two appointments legitimately match
    expect(journeys[1]).not.toEqual(journeys[0]);
  });

  describe('what a service arriving without its journey fields does', () => {
    it('becomes one fixed journey, which is why every service looked the same', () => {
      // Both defaults point the same way: `is_scheduled !== false` reads an
      // absent field as scheduled, and an absent collection is treated as
      // unknown-so-assume-online. So a service stripped of its journey fields
      // is an appointment that pays — whatever it actually is.
      //
      // This is the shape the public endpoint was serving, and it is why a
      // product and an invoiced programme walked the same three screens.
      const stripped = { price: 1000 };
      expect(journeySteps(stripped, READY)).toEqual([
        'service', 'datetime', 'details', 'payment', 'confirmation',
      ]);
    });

    it('differs from all three real services', () => {
      const stripped = journeySteps({ price: 1000 }, READY).join('>');
      for (const service of [FREE_APPOINTMENT, PAID_PRODUCT, INVOICED_APPOINTMENT]) {
        expect(journeySteps(service, READY).join('>')).not.toEqual(stripped);
      }
    });
  });

  it('drops the payment step when no processor can take the money', () => {
    // Better than showing a card form with nothing behind it.
    expect(journeySteps(PAID_PRODUCT, { processorReady: false })).toEqual([
      'service', 'details', 'confirmation',
    ]);
  });
});

describe('shouldTakePayment reads the service, not the business', () => {
  it('charges for a service collected online inside a business with no method set', () => {
    // The divergence: the widget passed the business-wide `collection_method`,
    // which is null once collection moves onto services. The steps said pay,
    // this said do not, and the client met a payment step that took nothing.
    expect(shouldTakePayment({ price: 1000, collection: 'online', processorReady: true })).toBe(true);
  });

  it('does not charge for an invoiced service inside a card-taking business', () => {
    expect(shouldTakePayment({ price: 200, collection: 'invoice', processorReady: true })).toBe(false);
  });

  it('never charges for a free service', () => {
    expect(shouldTakePayment({ price: 0, collection: 'online', processorReady: true })).toBe(false);
  });
});

/**
 * Intake is not part of the booking.
 *
 * It used to be a step, placed after the payment. The setting now says what it
 * always meant — the client is EMAILED the form once the booking is confirmed —
 * so the flow ends at confirmation. These lock that down, because the failure
 * would be silent: a client walked into a form they were never meant to see
 * mid-booking, and an owner's journey strip disagreeing with it.
 */
describe('intake is never a step in the booking flow', () => {
  const service = { is_scheduled: true, collection: 'online' as const, price: 200 };

  it('is absent even when the business collects intake', () => {
    const steps = journeySteps(service, { processorReady: true, intakeEnabled: true });

    expect(steps).not.toContain('intake');
    expect(steps[steps.length - 1]).toBe('confirmation');
  });

  it('gives the same journey whether intake is on or off', () => {
    // The whole point: turning intake on must not lengthen what the client
    // walks through, because the form arrives afterwards by email.
    expect(journeySteps(service, { processorReady: true, intakeEnabled: true })).toEqual(
      journeySteps(service, { processorReady: true, intakeEnabled: false })
    );
  });

  it('holds for a free service too', () => {
    const free = { is_scheduled: true, collection: null, price: 0 };

    expect(journeySteps(free, { intakeEnabled: true })).toEqual([
      'service',
      'datetime',
      'details',
      'confirmation',
    ]);
  });
});

/**
 * A quoted service — the seam.
 *
 * The journey stops at a request instead of running to payment, because nobody
 * has said what the work costs yet. Both halves use the same step vocabulary;
 * the second half resumes once a proposal is accepted.
 */
describe('journeySteps — a service that is quoted, not bought', () => {
  const QUOTED_JOB = { is_scheduled: false, collection: null, price: null, sale_mode: 'proposal' as const };

  it('stops at the request', () => {
    expect(journeySteps(QUOTED_JOB, READY)).toEqual(['service', 'details', 'request']);
  });

  it('never asks for payment, however ready the processor is', () => {
    // The client cannot pay: there is no price. A card form here would be a
    // form with nothing behind it.
    for (const options of [{ processorReady: true }, { processorReady: false }]) {
      expect(journeySteps(QUOTED_JOB, options)).not.toContain('payment');
    }
  });

  it('books a consultation first when the service is scheduled', () => {
    /*
     * CORRECTION. This test used to assert the opposite, on the reasoning that
     * the date belongs after acceptance. That is true for the WORK — but not
     * for the meeting where the work gets scoped.
     *
     * "Book a free site visit and I'll quote you" is how most contractors
     * sell, and a therapist's free intake call before proposing a treatment
     * plan is the same shape. In both the client picks a time, and the quote
     * follows the meeting. Blocking the date step made that flow impossible.
     */
    const consultationFirst = { ...QUOTED_JOB, is_scheduled: true };
    expect(journeySteps(consultationFirst, READY)).toEqual([
      'service', 'datetime', 'details', 'request',
    ]);
  });

  it('skips the date for a quoted job that has no meeting to book', () => {
    // A refit quoted from photographs. Same ending, one step shorter.
    expect(journeySteps({ ...QUOTED_JOB, is_scheduled: false }, READY)).toEqual([
      'service', 'details', 'request',
    ]);
  });

  it('is unaffected by collection, which describes the half that has not happened', () => {
    // QUOTED_JOB is unscheduled, so three steps is the whole journey here. What
    // is being asserted is that `collection` changes nothing — there is no
    // payment step to configure until a price exists.
    for (const collection of ['online', 'invoice', null] as const) {
      expect(journeySteps({ ...QUOTED_JOB, collection }, READY))
        .toEqual(['service', 'details', 'request']);
    }
  });

  it('carries a price without becoming buyable', () => {
    // A therapist's plan has a known total and is still quoted: the client is
    // shown the plan and accepts it, rather than paying for it off a page.
    expect(journeySteps({ ...QUOTED_JOB, price: 2700 }, READY))
      .toEqual(['service', 'details', 'request']);
  });

  it('leaves every direct service exactly as it was', () => {
    // The column defaults to 'direct', and an older page sends nothing at all.
    for (const saleMode of ['direct', null, undefined] as const) {
      expect(journeySteps({ ...PAID_PRODUCT, sale_mode: saleMode }, READY))
        .toEqual(journeySteps(PAID_PRODUCT, READY));
    }
  });
});
