import { journeySteps } from '@/lib/business-os/clientJourney';
import type { FlowStep, SelectedServiceData } from './types';

/**
 * The two facts a journey is built from, plus the two that shape its middle.
 *
 * Any object carrying them will do — a services card, a catalogue row, a
 * pricing plan — because all three describe the same `scheduling_services` row.
 */
export interface ServiceJourneyFacts {
  is_scheduled?: boolean | null;
  collection?: 'online' | 'invoice' | null;
  price?: number | null;
  /** `null` is how the database spells "direct", so both are accepted. */
  sale_mode?: 'direct' | 'proposal' | null;
}

/** `journeySteps` names its steps differently from the dialog's flow keys. */
const STEP_TO_FLOW: Record<string, FlowStep | undefined> = {
  // Choosing what to buy is the dialog's own 'services' screen, not a flow step.
  service: undefined,
  datetime: 'scheduling',
  details: 'client_info',
  request: 'request',
  payment: 'payment',
  intake: 'intake',
  confirmation: 'confirmation',
};

/**
 * Does this service say anything about its own journey?
 *
 * A card or row written before services carried these says nothing, and the
 * page's stored flow remains the best available answer for it.
 */
export function hasJourneyFacts(service: ServiceJourneyFacts | null | undefined): boolean {
  return (
    service?.is_scheduled !== undefined ||
    service?.collection !== undefined ||
    service?.sale_mode !== undefined
  );
}

/**
 * The steps THIS service is bought through.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The journey belongs to the SERVICE, not to the page. A course is not booked
 * into an hour, an invoiced service takes no card, and a quoted one ends at the
 * request — and a page's stored `client_flow` is one answer for a catalogue
 * that may hold all four.
 *
 * This was computed in one place only — from the service a card handed to the
 * dialog — so a client who reached the catalogue and chose there walked the
 * PAGE's flow instead: an unscheduled course asked them to pick a time that
 * does not exist. Shared here so the dialog can recompute it the moment the
 * client actually chooses.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param processorReady Whether a card can actually be charged. Undefined means
 *   the caller does not know, and is read as ready: removing a payment step a
 *   business can honour is worse than leaving one it cannot.
 */
export function flowForService(
  service: ServiceJourneyFacts,
  options: { processorReady?: boolean } = {}
): FlowStep[] {
  return journeySteps(
    {
      is_scheduled: service.is_scheduled,
      collection: service.collection,
      price: service.price,
      sale_mode: service.sale_mode,
    },
    { processorReady: options.processorReady !== false }
  )
    .map(step => STEP_TO_FLOW[step])
    .filter((step): step is FlowStep => Boolean(step));
}

/**
 * How a "book" button should behave on this page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The services list already answered this — open the modal in preview, follow
 * `bookingUrl` on the published site, and offer nothing when neither exists.
 * The header and hero did not: they were plain anchors pointing at `#booking`,
 * a section the page stopped installing, so every "book" button at the top of a
 * generated site scrolled to nothing.
 *
 * Repointing them at `#services` fixed the dead scroll and left a worse
 * problem — a button that says "book a session" and merely moves the page down
 * a bit. These buttons should start a booking, so they share the services
 * list's rule rather than a second one written next to it.
 *
 * No service is passed: a header CTA is not about any particular one, so the
 * modal opens at its catalogue step and the client picks first. Which is also
 * the only honest thing a page-level button can do now that each service has
 * its own journey.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type BookingAction =
  | { kind: 'open'; onClick: () => void }
  | { kind: 'link'; href: string };

export function resolveBookingAction(input: {
  /**
   * Retained because every caller passes it and it documents which surface this
   * is. It no longer DECIDES anything here — see `onOpenBooking` below.
   */
  isPreview?: boolean;
  /**
   * The dialog, when this page has one mounted.
   *
   * The condition used to be `isPreview && onOpenBooking`, which meant a
   * published page — which never passes `isPreview` — could not open the dialog
   * even with the handler in its hand. The handler's PRESENCE is the capability
   * now: `WebsiteBlocks` passes it only where the dialog is actually rendered,
   * so a page that cannot open one still falls through to the link below.
   */
  onOpenBooking?: (service: SelectedServiceData | null) => void;
  bookingUrl?: string;
  /** Where to go when this page cannot take a booking at all. */
  fallbackHref: string;
}): BookingAction {
  if (input.onOpenBooking) {
    const open = input.onOpenBooking;
    return { kind: 'open', onClick: () => open(null) };
  }
  if (input.bookingUrl) {
    return { kind: 'link', href: input.bookingUrl };
  }
  return { kind: 'link', href: input.fallbackHref };
}

/** Whether this page can actually start a booking. Decides the button's words. */
export function canBook(input: {
  isPreview?: boolean;
  onOpenBooking?: unknown;
  bookingUrl?: string;
}): boolean {
  return Boolean(input.onOpenBooking || input.bookingUrl);
}

/**
 * The service a card named, found in the catalogue that knows its id.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Stored block content carries service NAMES and no ids — the ids are filled in
 * by whichever route serves the page, from the live list. A card rendered
 * without that injection therefore knows exactly which service it is and cannot
 * say so in the one field the booking API accepts, and the dialog it opened
 * asked the client to choose the service they had just chosen.
 *
 * EXACT AND UNIQUE. A near match is a different service — "Training 45 min" and
 * "Training 60 min" differ by one word and cost different money — so anything
 * other than one exact hit returns null and the client picks from the
 * catalogue, which is the honest outcome rather than a guessed booking.
 *
 * Case and surrounding space are not part of a name; everything else is. No
 * transliteration or cross-script matching: a Hebrew catalogue holds
 * Hebrew-named services, and a Latin-script query genuinely does not match one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function matchServiceByName<T extends { name?: string | null }>(
  services: readonly T[],
  name: string | null | undefined
): T | null {
  const wanted = (name ?? '').trim().toLowerCase();
  if (!wanted) return null;

  const matches = services.filter(service => (service.name ?? '').trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Is this section's booking control dead?
 *
 * True only on a landing page whose one service has been deleted or switched
 * off: the routes stamp `serviceUnavailable` on every block that can start a
 * booking, because a landing page is about a single thing and every button on
 * it leads there. `resolveBookingAction` would otherwise open booking for the
 * BUSINESS — offering a client a completely different set of services on a page
 * written to sell one that no longer exists.
 *
 * A homepage's hero, header and CTA never carry the flag; their control is
 * about the business and has no service to lose.
 *
 * Here rather than in each shape because all four sections ask the same
 * question of the same two fields, and three copies of a predicate is three
 * places for it to drift.
 */
export function bookingIsDead(content: unknown): boolean {
  const c = content as { serviceId?: string; serviceUnavailable?: boolean } | null;
  return !!c?.serviceId && c.serviceUnavailable === true;
}
