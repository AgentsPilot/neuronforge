/**
 * What a client is asked to do, and in what order.
 *
 * The booking flow used to decide its own payment step from one fact: does the
 * service cost money. That reads "this is worth 250" as "collect 250 by card
 * right now", which is wrong for most of the businesses on the platform — a
 * clinic that invoices, a consultant paid by transfer, a studio that takes cash
 * in the room all charge for their work and none of them want a card form in
 * front of the client at booking.
 *
 * Two separate questions decide it, and both have to be yes:
 *
 *   1. Does this business collect online at all? Answered in onboarding, and
 *      stored as `collection_method`.
 *   2. Can it actually take a card right now? Answered by Stripe, and false
 *      until the account is connected and charges are enabled.
 *
 * The second is why this is not simply a link-building concern. A link created
 * the day a business signs up carries a payment step it cannot honour until
 * Stripe is connected — so a client following that link would reach a payment
 * screen with nothing behind it. The step is dropped at render time whenever
 * the processor is not ready, and comes back on its own once it is.
 */

import type { CollectionMethod } from '@/lib/business-os/setup/setupGraph';

/** The steps a public booking journey can contain, in the order they run. */
export type BookingFlowStep = 'scheduling' | 'client_info' | 'payment' | 'confirmation';

/**
 * Either vocabulary: a business's collection method, or a service's own.
 *
 * Loose because the widgets receive services straight from public JSON.
 */
export type ServiceCollectionLike = CollectionMethod | 'online' | 'invoice' | null | undefined;

/**
 * Whether the business takes card payments at the moment of booking.
 *
 * `mixed` counts: the processor is offered, and a client who wants to pay by
 * card at booking can. `invoice`, `in_person` and `none` do not — they collect
 * afterwards, or not at all.
 *
 * A null method is an account from before the question was asked. It gets the
 * old behaviour — the step appears for a priced service — because removing a
 * payment step somebody is relying on is worse than showing one they could
 * have turned off.
 */
export function collectsOnline(method: ServiceCollectionLike): boolean {
  if (method === null || method === undefined) return true;
  // Two vocabularies reach this, and only one used to be understood.
  //
  // A BUSINESS says `card_online | invoice | in_person | mixed | none`; a
  // SERVICE says `online | invoice`. Collection moved onto services, so the
  // value arriving here is now usually 'online' — which matched none of the
  // business words and was read as "does not collect online". Every service
  // priced and set to collect by card silently lost its payment step, on the
  // public booking page and everywhere else that draws the journey.
  //
  // The cast at the call site is what hid it: `collection as CollectionMethod`
  // told the compiler a service word was a business word. The parameter now
  // admits both, so the cast is gone and the compiler can see the union.
  return method === 'card_online' || method === 'mixed' || method === 'online';
}

/**
 * Removed: the journey a booking link carries.
 *
 * A link cannot carry one journey for a business that sells a card-paid
 * session and an invoiced programme — one word had to describe both, and
 * whichever it picked was wrong for half the catalogue. The booking page
 * rebuilds its steps from the service the client selects, so the journey
 * belongs to the service and the link carries none.
 */

/** The steps a public booking widget walks a client through, in order. */
export type BookingStep = 'service' | 'datetime' | 'details' | 'payment' | 'intake' | 'confirmation';

/**
 * The journey for one service, on every surface.
 *
 * Both booking widgets used to carry their own copy of this, and the copies
 * drifted: the smart-link one learned that an invoiced service shows no card
 * form and a product needs no date, while the website's went on deciding from
 * `price > 0` alone. A client could walk two different journeys for the same
 * service depending on which link they were sent.
 *
 * Everything here comes from the service itself, plus two facts about the
 * business that can make a step impossible rather than unwanted.
 */
export function journeySteps(
  service: { is_scheduled?: boolean | null; collection?: ServiceCollectionLike; price?: number | null },
  options: { processorReady?: boolean; intakeEnabled?: boolean } = {}
): BookingStep[] {
  const steps: BookingStep[] = ['service'];

  // A product is not booked against a time, so there is no date to pick.
  if (service.is_scheduled !== false) steps.push('datetime');

  steps.push('details');

  // Only a service collected online has a payment step, and only where a card
  // can actually be charged. An invoiced service is billed afterwards, which is
  // not something the client does here.
  if (shouldTakePayment({
    price: service.price,
    collection: service.collection ?? null,
    processorReady: options.processorReady !== false,
  })) {
    steps.push('payment');
  }

  // After the money: a form asked before the client has committed is a reason
  // to leave.
  if (options.intakeEnabled) steps.push('intake');

  steps.push('confirmation');
  return steps;
}

/**
 * Whether this booking should ask for payment.
 *
 * Every condition has to hold: something to charge, a business that charges
 * that way, and a processor that can take it.
 */
export function shouldTakePayment(input: {
  price: number | null | undefined;
  collection: ServiceCollectionLike;
  /** Stripe connected with charges enabled. */
  processorReady: boolean;
}): boolean {
  return (input.price || 0) > 0
    && collectsOnline(input.collection)
    && input.processorReady;
}
