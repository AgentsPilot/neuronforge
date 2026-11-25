/**
 * What a service asks for, shape by shape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This module restates rules that live in three other files, so the value of
 * these tests is not that the function returns what it was written to return.
 * It is that each case here names the SOURCE rule, so the day somebody changes
 * `journeyReadiness` or the publish route, the disagreement shows up as a red
 * test rather than as a service editor quietly asking for the wrong thing.
 *
 * `theGatesDoNotContradict` does the same job one level up, between the gates
 * themselves. This is the per-service layer underneath it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  serviceRequirements,
  serviceCollectsMoney,
  type ServiceShape,
} from '@/lib/business-os/setup/serviceRequirements';

/** An appointment, paid by card. The shape most accounts start from. */
const CARD: ServiceShape = {
  is_scheduled: true,
  price: 300,
  collection: 'online',
  sale_mode: 'direct',
};

describe('what a service asks of the business behind it', () => {
  it('asks for hours wherever a client picks a time', () => {
    expect(serviceRequirements({ ...CARD, price: 0, collection: null })).toContain('hours');
  });

  it('asks for none where nothing is booked against a time', () => {
    /* A product, a download, a quoted job with no appointment: no slot is held,
       so the diary is not involved. `availability.applies` says the same of the
       whole business. */
    expect(serviceRequirements({ ...CARD, is_scheduled: false })).not.toContain('hours');
  });

  it('treats an unanswered appointment flag as an appointment', () => {
    /*
     * Rows written before `is_scheduled` existed carry null, and those WERE
     * appointments. Unknown stays bookable, which is the direction that cannot
     * take working hours away from a business that needs them. The publish gate
     * reads the column the same way.
     */
    expect(serviceRequirements({ ...CARD, is_scheduled: null })).toContain('hours');
  });

  it('asks for a processor only where a card is actually taken', () => {
    expect(serviceRequirements(CARD)).toContain('processor');
    expect(serviceRequirements({ ...CARD, collection: 'invoice' })).not.toContain('processor');
  });

  it('asks for the invoice details BEFORE the processor', () => {
    /*
     * The order is the argument, not presentation. With no Stripe a card
     * service is invoiced — `journeyReadiness` keeps the processor gap
     * non-blocking for exactly that reason — so the invoice details are what
     * makes it work at all and the processor is the upgrade on top.
     *
     * Reversed, an owner meets a five-minute account application before the
     * two-minute thing that is actually required, and abandoning it leaves a
     * card service whose fallback cannot issue a document either.
     */
    const order = serviceRequirements(CARD);
    expect(order.indexOf('invoice')).toBeLessThan(order.indexOf('processor'));
    expect(order).toEqual(['hours', 'invoice', 'processor']);
  });

  it('never asks a quote for a processor, because a quote has no collection', () => {
    /*
     * `serviceShapeFields` clears `collection` for a proposal on purpose: what
     * a quote collects is decided in the quote. Asking for Stripe here would
     * demand an account for a payment that may never be by card.
     *
     * `theGatesDoNotContradict` pins the same pair from the shape's side: a
     * quote moves money and does not demand a processor.
     */
    const quote: ServiceShape = { is_scheduled: false, price: null, collection: null, sale_mode: 'proposal' };
    expect(serviceRequirements(quote)).not.toContain('processor');
    expect(serviceRequirements(quote)).toContain('invoice');
  });
});

describe('the invoice details, which every collecting shape owes', () => {
  it('asks a card service for them too', () => {
    /*
     * THE RULE THAT SURPRISES PEOPLE, and it is the graph's own. Two
     * independent reasons, either one sufficient:
     *
     *   `invoicing.mandatory` returns true once `payments` is complete, so
     *   connecting Stripe makes the paperwork compulsory — a card business
     *   still issues receipts, drawn from these fields;
     *
     *   and with no processor connected every priced service is invoiced
     *   instead, whatever it was set to collect.
     */
    expect(serviceRequirements(CARD)).toContain('invoice');
  });

  it('asks an invoiced service for them', () => {
    expect(serviceRequirements({ ...CARD, collection: 'invoice' })).toContain('invoice');
  });

  it('asks a quote for them, because acceptance raises an invoice', () => {
    /*
     * The route this product actually walked into: a quote-first business with
     * no invoice details sent a quote, the client accepted, and
     * `ProposalAcceptanceService.raiseInvoice` wrote a bill with no company
     * name, no tax id and nowhere to send the money.
     */
    expect(serviceRequirements({ is_scheduled: false, sale_mode: 'proposal' })).toContain('invoice');
  });

  it('asks a free service for nothing but hours', () => {
    /*
     * The one shape that owes no money paperwork at all. A free service is a
     * real service — hours, reminders, no-shows — that simply never bills, and
     * `theGatesDoNotContradict` pins that `moneyMoves` is false for it.
     */
    expect(serviceRequirements({ is_scheduled: true, price: 0, collection: null })).toEqual(['hours']);
  });

  it('asks nothing at all of a free service with no appointment', () => {
    /*
     * The shape the publish gate now refuses outright as `nothing_to_sell`:
     * no time held, no money taken, so there is nothing for a client to book.
     * It owes nothing because it IS nothing — which is why the refusal lives
     * at the gate rather than here.
     */
    expect(serviceRequirements({ is_scheduled: false, price: 0, collection: null })).toEqual([]);
  });
});

describe('an unpriced service is not a free one', () => {
  it('counts a quote as money moving', () => {
    expect(serviceCollectsMoney({ sale_mode: 'proposal', price: null })).toBe(true);
  });

  it('does not count a service priced at zero', () => {
    expect(serviceCollectsMoney({ price: 0, collection: null })).toBe(false);
  });

  it('does not count one that has not been priced yet', () => {
    /*
     * Deliberate, and the narrower of the two readings. A draft with no price
     * is a question still open — the interview collects no prices, so every
     * onboarding draft is in this state — and demanding invoice details of it
     * would ask the whole platform's new accounts for paperwork on the strength
     * of a decision nobody has made. The gates ask again at publish, when the
     * price is an answer.
     */
    expect(serviceCollectsMoney({ price: null, collection: 'online' })).toBe(false);
  });
});
