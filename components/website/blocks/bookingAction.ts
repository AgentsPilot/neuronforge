import type { SelectedServiceData } from './types';

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
  isPreview?: boolean;
  onOpenBooking?: (service: SelectedServiceData | null) => void;
  bookingUrl?: string;
  /** Where to go when this page cannot take a booking at all. */
  fallbackHref: string;
}): BookingAction {
  if (input.isPreview && input.onOpenBooking) {
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
  return Boolean((input.isPreview && input.onOpenBooking) || input.bookingUrl);
}
