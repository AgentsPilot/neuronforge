/**
 * The booking dialog has to exist on the page a client actually visits.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * It was mounted for `isPreview` alone, and no published route passes that flag
 * — `/site/[subdomain]` and `/site/[subdomain]/[slug]` are published pages, not
 * previews. So on every live site the dialog was never rendered, and each
 * "book" control quietly degraded to a link to the catalogue at
 * `/site/{subdomain}/book`. Nothing looked broken: the button was there, it just
 * never opened the dialog the page was built around.
 *
 * Then `BookingModal` hardcoded `isPreview={true}` on the flow inside it. That
 * flag is not cosmetic — `ProcessFlowSection` reads it as "there is a logged-in
 * owner here" and sends `subdomain: ''` and no `userCode`, letting the route
 * fall back to the authenticated user, and it fakes the intake save. Correct
 * while the dialog lived only in the builder's preview; wrong from the moment
 * the smart link was rewritten onto it, where a client has no session to fall
 * back to and `booking/create` answered 401.
 *
 * Source-level, like `templates/__tests__/bookingPath.test.ts`: the defect is a
 * prop that is never passed, which renders as a button that does nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  resolveBookingAction,
  canBook,
  matchServiceByName,
  flowForService,
  hasJourneyFacts,
} from '../bookingAction';

const BLOCKS = join(__dirname, '..');
const APP = join(__dirname, '..', '..', '..', '..', 'app');

const INDEX = readFileSync(join(BLOCKS, 'index.tsx'), 'utf8');
const MODAL = readFileSync(join(BLOCKS, 'BookingModal.tsx'), 'utf8');

describe('where the dialog is mounted', () => {
  it('is not gated on preview alone', () => {
    expect(INDEX).toContain('canOpenBookingDialog');
    expect(INDEX).toMatch(/const canOpenBookingDialog = isPreview \|\| !!subdomain;/);
    // The old gate. A published page has a subdomain and no preview flag.
    expect(INDEX).not.toMatch(/\{isPreview && \(\s*<BookingModal/);
  });

  it('hands blocks the opener only where the dialog exists', () => {
    expect(INDEX).toContain('onOpenBooking={canOpenBookingDialog ? handleOpenBooking : undefined}');
  });
});

describe('who the dialog books as', () => {
  it('does not declare itself a preview on every surface', () => {
    expect(MODAL).not.toContain('isPreview={true}');
    expect(MODAL).toContain('isPreview={isPreview}');
    // Public is the ordinary case; the two preview routes say so explicitly.
    expect(MODAL).toMatch(/isPreview = false/);
  });
});

describe('the booking section itself', () => {
  /*
   * `booking_widget` is the section a generated landing page actually converts
   * on, and it was the one block never handed the opener. Its button did
   * `window.location.href = '/book?…'` — an app-absolute path with no business
   * in it, which resolves only on a real subdomain host and otherwise leaves
   * the site for the platform's own `/book`.
   */
  const WIDGET = readFileSync(join(BLOCKS, 'BookingWidgetBlock.tsx'), 'utf8');

  it('accepts the opener', () => {
    expect(WIDGET).toMatch(/BookingWidgetBlock\(\{[^}]*onOpenBooking[^}]*\}/);
  });

  it('prefers the dialog over navigating away', () => {
    // The dialog branch must come first, and return before the URL is built.
    const openAt = WIDGET.indexOf('if (onOpenBooking) {');
    const navigateAt = WIDGET.indexOf("window.location.href = `/book?");
    expect(openAt).toBeGreaterThan(-1);
    expect(navigateAt).toBeGreaterThan(openAt);
  });
});

describe('the published pages answer what the dialog asks them', () => {
  /*
   * `paymentsEnabled` left undefined is read as "yes" on purpose, so a page
   * that cannot answer does not remove a step the business could honour. These
   * pages CAN answer — the public API resolves it with the same helper the
   * booking routes use — and a card step with no processor behind it is exactly
   * what the smart link already learned to avoid.
   */
  it.each([
    ['site/[subdomain]/page.tsx'],
    ['site/[subdomain]/[slug]/page.tsx'],
  ])('%s passes the processor answer through', file => {
    const source = readFileSync(join(APP, file), 'utf8');
    expect(source).toContain('paymentsEnabled={data.processorReady === true}');
  });

  it('the public website API resolves it', () => {
    const route = readFileSync(join(APP, 'api/website/public/[subdomain]/route.ts'), 'utf8');
    expect(route).toContain('resolvePaymentCollectionCapability');
    expect(route).toContain('processorReady: paymentCapability.canCollect');
  });
});

describe('resolveBookingAction', () => {
  const open = () => {};

  it('opens the dialog whenever one is mounted, preview or not', () => {
    expect(resolveBookingAction({ onOpenBooking: open, bookingUrl: '/x', fallbackHref: '#' }).kind).toBe('open');
    expect(
      resolveBookingAction({ isPreview: true, onOpenBooking: open, bookingUrl: '/x', fallbackHref: '#' }).kind
    ).toBe('open');
  });

  it('still links where no dialog was handed down', () => {
    const action = resolveBookingAction({ bookingUrl: '/site/acme/book', fallbackHref: '#services' });
    expect(action).toEqual({ kind: 'link', href: '/site/acme/book' });
  });

  it('falls back to the page anchor when the page cannot book at all', () => {
    expect(resolveBookingAction({ fallbackHref: '#services' })).toEqual({ kind: 'link', href: '#services' });
  });

  it('canBook follows the same rule', () => {
    expect(canBook({ onOpenBooking: open })).toBe(true);
    expect(canBook({ bookingUrl: '/x' })).toBe(true);
    expect(canBook({})).toBe(false);
  });
});

/**
 * A card that knows WHICH service it is and not its id.
 *
 * Stored block content carries names and no ids — every page in the database is
 * written that way, and the ids are filled in by whichever route serves the
 * page. Rendered without that, clicking a named service opened the dialog on
 * its catalogue and asked the client to choose the service they had just
 * chosen. The name is resolved against the catalogue the dialog fetches anyway.
 */
describe('matchServiceByName', () => {
  const CATALOGUE = [
    { id: 'a', name: 'Training 45 min' },
    { id: 'b', name: 'Training 60 min' },
    { id: 'c', name: 'ייעוץ אישי' },
  ];

  it('finds the one service a card named', () => {
    expect(matchServiceByName(CATALOGUE, 'Training 60 min')?.id).toBe('b');
  });

  it('ignores case and surrounding space, which are not part of a name', () => {
    expect(matchServiceByName(CATALOGUE, '  training 60 MIN ')?.id).toBe('b');
  });

  it('matches a Hebrew name on its own script', () => {
    expect(matchServiceByName(CATALOGUE, 'ייעוץ אישי')?.id).toBe('c');
    // Deliberately no transliteration: a Latin query is not this service.
    expect(matchServiceByName(CATALOGUE, 'ieutz ishi')).toBeNull();
  });

  it('refuses a near match — one word apart is a different price', () => {
    expect(matchServiceByName(CATALOGUE, 'Training')).toBeNull();
    expect(matchServiceByName(CATALOGUE, 'Training 45')).toBeNull();
  });

  it('refuses an ambiguous one rather than guessing', () => {
    const twins = [{ id: 'a', name: 'Intro' }, { id: 'b', name: 'intro ' }];
    expect(matchServiceByName(twins, 'Intro')).toBeNull();
  });

  it('answers null for nothing to match', () => {
    expect(matchServiceByName(CATALOGUE, '')).toBeNull();
    expect(matchServiceByName(CATALOGUE, null)).toBeNull();
    expect(matchServiceByName([], 'Training 60 min')).toBeNull();
  });
});

/**
 * The journey belongs to the service, not to the page.
 *
 * A page's stored `client_flow` is one answer for a catalogue that may hold a
 * course nobody books into an hour, an invoiced service that takes no card, and
 * a quoted one that ends at the request. It was applied to whichever service a
 * client chose INSIDE the dialog, so an unscheduled course asked them to pick a
 * time — the page's other services have one.
 */
describe('flowForService', () => {
  it('drops the date for something bought rather than booked', () => {
    const flow = flowForService({ is_scheduled: false, collection: 'invoice', price: 300 });
    expect(flow).not.toContain('scheduling');
    expect(flow).toContain('client_info');
  });

  it('keeps the date for a service booked into a time', () => {
    expect(flowForService({ is_scheduled: true, collection: 'invoice', price: 300 })).toContain('scheduling');
  });

  it('asks for a card only where one can be charged', () => {
    const online = { is_scheduled: true, collection: 'online' as const, price: 300 };
    expect(flowForService(online, { processorReady: true })).toContain('payment');
    expect(flowForService(online, { processorReady: false })).not.toContain('payment');
    // Undefined means the caller cannot answer, and the step stays.
    expect(flowForService(online)).toContain('payment');
  });

  it('never asks an invoiced client for a card', () => {
    expect(flowForService({ is_scheduled: true, collection: 'invoice', price: 300 })).not.toContain('payment');
  });

  it('ends a quoted service at the request, with nothing to pay', () => {
    const flow = flowForService({ is_scheduled: true, collection: 'online', price: 300, sale_mode: 'proposal' });
    expect(flow).toContain('request');
    expect(flow).not.toContain('payment');
    expect(flow).not.toContain('confirmation');
  });
});

describe('hasJourneyFacts', () => {
  it('is true when the service says anything about its own journey', () => {
    expect(hasJourneyFacts({ is_scheduled: false })).toBe(true);
    expect(hasJourneyFacts({ collection: 'invoice' })).toBe(true);
    expect(hasJourneyFacts({ sale_mode: 'proposal' })).toBe(true);
  });

  it('is false for a row that predates them, so the page answers instead', () => {
    expect(hasJourneyFacts({ price: 300 })).toBe(false);
    expect(hasJourneyFacts({})).toBe(false);
    expect(hasJourneyFacts(null)).toBe(false);
  });
});

describe('choosing inside the dialog rewrites the journey', () => {
  const MODAL = readFileSync(join(BLOCKS, 'BookingModal.tsx'), 'utf8');
  const FLOW = readFileSync(join(BLOCKS, 'ProcessFlowSection.tsx'), 'utf8');

  it('the dialog resolves the flow from whatever is chosen now', () => {
    expect(MODAL).toMatch(/journeyService[^=]*=\s*chosenService \?\? initialService/);
    expect(MODAL).toContain('flowForService(journeyService, { processorReady })');
  });

  it('the flow tells it what was chosen', () => {
    expect(MODAL).toContain('onServiceChange={setChosenService}');
    expect(FLOW).toContain('onServiceChange?.(service);');
  });

  it('and does not send the client back when the journey changes under them', () => {
    expect(MODAL).toContain('if (isOpen && !chosenService)');
  });

  it('the next step comes from the chosen service, not the page', () => {
    expect(FLOW).toContain('const ownFlow = hasJourneyFacts(service) ? flowForService(service) : null;');
    expect(FLOW).toContain('const goesToDate = ownFlow ? flowHasScheduling(ownFlow) : hasScheduling;');
  });

  it('the catalogue carries the facts that decide it', () => {
    // The endpoint has always published these; this mapping used to drop them.
    expect(FLOW).toMatch(/is_scheduled: s\.is_scheduled,\s*\n\s*collection: s\.collection,\s*\n\s*sale_mode: s\.sale_mode/);
  });
});

describe('the flow waits for an id before it calls a service chosen', () => {
  const FLOW = readFileSync(join(BLOCKS, 'ProcessFlowSection.tsx'), 'utf8');

  it('treats a named-but-unidentified card as not yet chosen', () => {
    expect(FLOW).toContain('const hasInitialService = !!initialService?.id;');
    expect(FLOW).toContain('pendingServiceName');
  });

  it('resolves it through the same handler a click uses', () => {
    expect(FLOW).toMatch(/matchServiceByName\(services, pendingServiceName\)/);
    expect(FLOW).toMatch(/if \(match\) handleSelectService\(match\)/);
  });
});
