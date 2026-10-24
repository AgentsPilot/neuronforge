/**
 * The gates, checked against each other rather than one at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * There are now eight places that can refuse something — two save paths, two
 * publish paths, a public booking route, a redirect, a smart link and the
 * shape that decides which tabs exist — and they are correct individually and
 * wrong together surprisingly easily. One pair already was: a live card
 * service on an account with no processor is a SUPPORTED state that the
 * platform describes in words ("you invoice ₪300 until Stripe is connected"),
 * and the save gate refused every edit to it, including the edit that would
 * fix it. Three separate true statements combined into a frozen row.
 *
 * Each test below is one PAIR that must agree. They are grouped by the claim
 * being protected, not by the file being read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { shapeFromServices } from '@/lib/business-os/businessShape';
import { moneyMoves, collectsOnline } from '@/lib/business-os/setup/setupGraph';
import { isBlockingGap } from '@/lib/business-os/journeyReadiness';

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Pages are never gated; booking surfaces are. */
describe('a page is not a booking surface', () => {
  it('publishing a website does not refuse on a journey gap', () => {
    const source = read('lib/services/WebsitePublishService.ts');

    // Not vacuous: it still ASKS, so the owner can be told and the editor can
    // probe readiness. What it must not do is turn the answer into a refusal.
    expect(source).toContain('journeyGaps(userId, servicesForJourney)');
    expect(source).not.toMatch(/if \(blocking\.length > 0\) \{\s*return \{\s*data: null/);
  });

  it('publishing a landing page refuses only for a service nobody can reach', () => {
    const source = read('app/api/website/landing-pages/route.ts');

    // The one refusal, and the reason it is the only one.
    expect(source).toContain("code: 'catalogue'");
    expect(source).not.toContain("code: 'not_ready'");
  });

  it('the public site withholds the card rather than the page', () => {
    const source = read('app/api/website/public/[subdomain]/route.ts');

    expect(source).toContain('filter(isBlockingGap)');
    // And drops the section when nothing survives, rather than rendering a
    // heading over nothing.
    expect(source).toMatch(/block_type === 'services' && liveServices\.length === 0/);
  });
});

/**
 * A live service keeps trading. Every gate added for a NEW promise has to
 * leave the running business alone, or an owner is punished for editing.
 */
describe('a gate on a new promise must not freeze an old one', () => {
  it('a missing processor never blocks the journey', () => {
    /*
     * The keystone. `processor` being non-blocking is what lets an already
     * published card service go on taking bookings and being invoiced — every
     * public surface filters on `isBlockingGap`. If this flipped, the publish
     * and save gates below would become a platform-wide outage rather than a
     * nudge.
     */
    expect(isBlockingGap({ kind: 'processor', services: [] })).toBe(false);
    expect(isBlockingGap({ kind: 'hours', services: [] })).toBe(true);
    expect(isBlockingGap({ kind: 'invoicing', services: [] })).toBe(true);
    expect(isBlockingGap({ kind: 'catalogue', services: [] })).toBe(true);
  });

  it('saving compares with the stored row, so an existing card service stays editable', () => {
    const source = read('app/api/scheduling/services/[id]/route.ts');

    /*
     * `saveRowEdit` rebuilds the whole payload from the row's current values,
     * so `validated.collection === 'online'` is true when the owner edits the
     * NAME of a service that was already on card. Testing the incoming value
     * alone refused that — and because saving also writes `status: 'draft'`,
     * the publish gate then refused to put it back on sale.
     */
    expect(source).toContain('alreadyOnCard');
    expect(source).toMatch(/findById\(serviceId, user\.id\)/);
  });

  it('publishing is gated for card, because going live is a new promise', () => {
    // Deliberately NOT softened the way saving was: the invoicing gate already
    // refuses to publish a service whose invoice details are missing, and card
    // answers to the same rule.
    expect(read('app/api/scheduling/services/[id]/publish/route.ts'))
      .toContain("code: 'processor_required'");
  });
});

/**
 * What a service IS has to mean the same thing to the readiness gate and to
 * the shape. These two modules disagreed about a quote, which asked a business
 * for invoice details through one and hid the tab holding them through the
 * other.
 */
describe('readiness and the shape agree about what a service is', () => {
  const published = (extra: Record<string, unknown>) =>
    shapeFromServices([{ status: 'active', is_scheduled: true, ...extra }], {
      online_presence_mode: 'website_only',
      collection_method: 'none',
    });

  it('a quote moves money, and does not demand a processor', () => {
    /*
     * `ProposalAcceptanceService` writes a `payment_invoices` row on
     * acceptance, so money moves — settled by hand rather than by a card,
     * which is what `collectsOnline` is the separate predicate for.
     *
     * `journeyReadiness` counts `sale_mode: 'proposal'` as invoiced for the
     * publish gate. If this module stops agreeing, a quote-only business is
     * asked for invoice details it has no tab to enter.
     */
    const quote = published({ price: null, collection: null, sale_mode: 'proposal' });
    expect(moneyMoves(quote)).toBe(true);
    expect(collectsOnline(quote)).toBe(false);
  });

  it('a free service books but moves no money', () => {
    // The distinction the whole zero-services change rests on: free is a real
    // service — hours, reminders, no-shows — that simply never bills.
    const free = published({ price: 0, collection: null });
    expect(moneyMoves(free)).toBe(false);
  });

  it('a card service demands a processor and an invoiced one does not', () => {
    expect(collectsOnline(published({ price: 200, collection: 'online' }))).toBe(true);
    expect(collectsOnline(published({ price: 200, collection: 'invoice' }))).toBe(false);
  });

  it('a draft decides nothing at all', () => {
    /*
     * Every gate keys off the PUBLISHED catalogue. A draft that moved the
     * shape would open tabs and nav for a service nobody can book, and would
     * contradict `listBookable`, which every public surface reads.
     */
    const profile = { online_presence_mode: 'website_only', collection_method: 'none' };
    const draft = shapeFromServices(
      [{ status: 'draft', is_scheduled: true, price: 200, collection: 'online' }],
      profile
    );

    // Identical to having no catalogue at all, which is the claim.
    expect(draft).toEqual(shapeFromServices([], profile));
    expect(moneyMoves(draft)).toBe(false);
    expect(collectsOnline(draft)).toBe(false);
  });
});
