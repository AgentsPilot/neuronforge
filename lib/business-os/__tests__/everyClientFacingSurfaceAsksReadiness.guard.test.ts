/**
 * Every surface that makes a promise to a client asks whether it can be kept.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPORT: a client booked a service and was sent an invoice, from a
 * business with no invoice company name, no tax id, no address and no payment
 * instructions.
 *
 * The machinery to prevent that already existed and was correct — `journeyGaps`
 * and `isBlockingGap` here, `BOOKABLE` in `SchedulingRepository`. The website
 * publish gate had been asking for some time. The failure was that the surfaces
 * which mattered never called it:
 *
 *   public booking create   no readiness check, AND accepted a DRAFT service
 *                           because it tested `is_active` and ignored `status`
 *   service publish         no readiness check
 *   landing page publish    no readiness check
 *   smart link              checked at activation, but an all-draft catalogue
 *                           read as "ready" and the link went live
 *
 * Each of the first three was independently enough to produce the failure.
 *
 * WHY A SOURCE GUARD. The invariant is "this check is CALLED here", which is
 * exactly what no runtime test asserts: a route that forgets it passes every
 * test about what it does do. That is how four surfaces drifted from one rule.
 *
 * WHAT IS DELIBERATELY NOT GATED. Contacts, drafts and viewing the online
 * presence stay open. The owner must keep working while configuration is
 * incomplete; enforcement belongs at the moment a dependent capability is
 * USED — taking a booking, or publishing something client-facing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

/** The surfaces where something becomes client-facing. */
const GATED = [
  ['public booking create', 'app/api/website/booking/create/route.ts'],
  ['service publish', 'app/api/scheduling/services/[id]/publish/route.ts'],
  ['landing page publish', 'app/api/website/landing-pages/route.ts'],
  ['owner booking create', 'app/api/scheduling/bookings/route.ts'],
  ['smart link create', 'app/api/smart-links/route.ts'],
  ['smart link update', 'app/api/smart-links/[id]/route.ts'],
] as const;

describe('the readiness check is asked', () => {
  it.each(GATED)('%s calls it', (_name, file) => {
    const source = read(file);

    expect(source).toMatch(/journeyGaps|journeyGapsForSmartLink/);
    expect(source).toContain('isBlockingGap');
  });

  it.each(GATED)('%s fails open rather than losing the work', (_name, file) => {
    /*
     * `journeyGaps` reaches the database three times. An outage there must not
     * stop a business taking a booking or publishing work it has already done,
     * so every caller refuses only on a gap it positively found.
     */
    const source = read(file);
    expect(source).toMatch(/try \{|catch/);
  });
});

describe('the website gate this pattern came from', () => {
  it('still asks, and is still the shape the others copy', () => {
    const service = read('lib/services/WebsitePublishService.ts');

    expect(service).toMatch(/journeyGaps\(userId, services\)\)\.filter\(isBlockingGap\)/);
  });
});

describe('a booking cannot be taken on an unpublished service', () => {
  it('the public create route tests BOTH flags, not just one', () => {
    /*
     * `BOOKABLE` is `{ is_active: true, status: 'active' }` and its comment
     * says it exists "so the next surface cannot pick one and forget the
     * other". This route forgot `status`, so a service reverted to draft by an
     * edit stayed publicly bookable while absent from every list.
     */
    const create = read('app/api/website/booking/create/route.ts');

    expect(create).toMatch(/!service\.is_active \|\| service\.status !== 'active'/);
  });
});

describe('an empty catalogue is not a ready one', () => {
  it('a booking link with nothing published reports a gap', () => {
    const readiness = read('lib/business-os/journeyReadiness.ts');

    expect(readiness).toMatch(/if \(services\.length === 0\) \{/);
    expect(readiness).toMatch(/kind: 'catalogue'/);
  });

  it('and that gap blocks', () => {
    const readiness = read('lib/business-os/journeyReadiness.ts');
    expect(readiness).toMatch(/gap\.kind === 'catalogue'/);
  });

  it('and says what to do about it', () => {
    // "Not ready" would send an owner into settings for a gap that is not in
    // settings: the services exist, they are simply not published.
    const readiness = read('lib/business-os/journeyReadiness.ts');
    expect(readiness).toMatch(/none of your services are published yet/);
  });
});

describe('the card processor still does NOT block', () => {
  it('because an unpaid card service falls back to an invoice', () => {
    /*
     * The one gap that is advisory. Blocking on it would take a working route
     * to the business off the air for a step the client would never have seen.
     */
    const readiness = read('lib/business-os/journeyReadiness.ts');
    const fn = readiness.slice(
      readiness.indexOf('export function isBlockingGap'),
      readiness.indexOf('/** A service asks the client to pick a time. */')
    );

    expect(fn).not.toMatch(/'processor'/);
  });
});

describe('a quote needs invoice details too', () => {
  /*
   * The kind that escaped. A quoted service carries `price: null` and
   * `collection: null` by design — the amount and the method are named in the
   * quote — and those are precisely the two things the invoicing filter tested.
   * So it matched neither and needed nothing, while `ProposalAcceptanceService`
   * raises an invoice the moment the client accepts. Usually the largest one
   * the business sends.
   */
  it('is counted as invoiced on its sale_mode alone', () => {
    const readiness = read('lib/business-os/journeyReadiness.ts');

    expect(readiness).toMatch(/service\.sale_mode === 'proposal'/);
    // No price test for a quote: there is no price yet, and waiting for one
    // would exempt it for ever.
    expect(readiness).toMatch(/sale_mode\?: 'direct' \| 'proposal' \| null/);
  });

  it('and every caller passes sale_mode, or the check cannot see it', () => {
    for (const file of [
      'app/api/scheduling/services/[id]/publish/route.ts',
      'app/api/website/booking/create/route.ts',
      'app/api/scheduling/bookings/route.ts',
    ]) {
      expect(read(file)).toMatch(/sale_mode/);
    }
  });
});

describe('a FREE service is never gated on invoicing', () => {
  it('because it collects nothing, so there is no invoice to send', () => {
    /*
     * The filter still requires `price > 0` for the non-quote branch. A free
     * service has no collection either — the editor stores null the moment the
     * price is zero — so there is nothing for an invoicing gate to protect.
     * Hours and timezone still apply if it books a time, which is right: a
     * client picking a slot needs real hours whether or not money moves.
     */
    const readiness = read('lib/business-os/journeyReadiness.ts');
    const filter = readiness.slice(
      readiness.indexOf('const invoiced = services.filter('),
      readiness.indexOf('if (invoiced.length > 0)')
    );

    expect(filter).toMatch(/\(service\.price \|\| 0\) > 0/);
  });
});

describe('what stays open, deliberately', () => {
  it.each([
    ['contacts', 'app/api/crm/contacts/route.ts'],
  ])('%s is not gated on readiness', (_name, file) => {
    /*
     * The owner must be able to keep working — adding people, writing drafts —
     * while the configuration is incomplete. Gating this would be the opposite
     * of the intent: it blocks the business, not the broken promise.
     */
    expect(read(file)).not.toContain('isBlockingGap');
  });
});
