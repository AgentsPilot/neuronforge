/**
 * A button pointing at the contact form goes to the contact form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * A generated closing call to action read "פרטים נוספים" — more details — and
 * opened the booking dialog at its catalogue step. Not a broken link: the
 * block's stored `cta_link` was never consulted at all. `resolveBookingAction`
 * took over every page-level button that named no service, because the rule it
 * was written for was "a scroll is always the weaker answer".
 *
 * That rule is right for `#services`, `#pricing` and `#about`. Those are lists,
 * and a button that says "book a session" and merely moves the page down a bit
 * is the failure the function exists to prevent.
 *
 * It is wrong for `#contact`, which is not a list but a FORM — the page's
 * second conversion endpoint, and the only ask available to a visitor who is
 * not ready to pay. Hijacking it made that ask unperformable: every route to
 * the enquiry form on a generated page led to a checkout instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES IT SAFE
 *
 * `repairBlockLinks` runs in the renderer over the blocks it is about to draw,
 * and strips or repairs any fragment whose section is missing or switched off.
 * So a `#contact` arriving here is a contact form that is really on the page —
 * which is the property that lets this honour the link instead of second
 * guessing it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveBookingAction } from '@/components/website/blocks/bookingAction';
import { anchorForBlockType } from '@/lib/website-builder/sectionAnchors';
import { ctaDestination } from '@/lib/website-builder/ctaIntent';

/** The dialog handler a page mounts when it can open booking in place. */
const open = () => undefined;

describe('the contact form outranks the booking dialog', () => {
  it('follows #contact even with the dialog in hand', () => {
    const action = resolveBookingAction({
      onOpenBooking: open,
      bookingUrl: '/site/acme/book',
      fallbackHref: '#contact',
    });

    expect(action).toEqual({ kind: 'link', href: '#contact' });
  });

  it('follows #contact even on a published site with a booking URL', () => {
    const action = resolveBookingAction({
      bookingUrl: '/site/acme/book',
      fallbackHref: '#contact',
    });

    expect(action).toEqual({ kind: 'link', href: '#contact' });
  });

  it('still opens the dialog for every destination that is only a list', () => {
    /*
     * The behaviour this must NOT regress. Each of these is a section to read,
     * so a conversion button sent there would merely scroll.
     */
    for (const href of ['#services', '#pricing', '#about', '#gallery', '#faq']) {
      expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: href }).kind).toBe('open');
    }
  });

  it('still opens the dialog for a fragment that names nothing', () => {
    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: '#' }).kind).toBe('open');
  });

  it('matches the anchor the renderer actually stamps, not a literal', () => {
    /*
     * The two halves of one contract: the renderer stamps the section's id
     * from `anchorForBlockType`, and this resolves the same way. A literal
     * '#contact' in either half is how a rename silently breaks the button.
     */
    const stamped = `#${anchorForBlockType('contact_form')}`;

    expect(stamped).toBe('#contact');
    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: stamped }).kind).toBe('link');
  });

  it('honours what the generator writes for a contact intent', () => {
    /*
     * End to end across the two modules: the intent the generator chooses for
     * the closing block produces a destination, and that destination has to
     * survive the resolver. These were written apart and disagreed.
     */
    const link = ctaDestination('contact', { hasBookingSection: false });

    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: link })).toEqual({
      kind: 'link',
      href: link,
    });
  });

  it('keeps sending a book intent to the dialog', () => {
    /* The other half of the same contract, so this is not a blanket surrender. */
    const link = ctaDestination('book', { hasBookingSection: false });

    expect(link).toBe('#services');
    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: link }).kind).toBe('open');
  });

  it('ignores case and stray whitespace, as a stored value may carry both', () => {
    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: ' #Contact ' }).kind).toBe(
      'link'
    );
  });

  it('does not match a fragment that merely starts with contact', () => {
    /* `#contact-us` is a different section, and may not exist at all. */
    expect(resolveBookingAction({ onOpenBooking: open, fallbackHref: '#contact-us' }).kind).toBe(
      'open'
    );
  });
});

describe('the generator asks the closing block to be contacted', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', '..', '..', 'lib', 'services', 'WebsiteGenerationService.ts'),
    'utf8'
  );

  it('resolves the closing call to action from the contact intent', () => {
    /*
     * Source-level because `buildBlocks` is private and takes eleven
     * arguments. What matters is the one expression: with no standalone
     * booking section — which `planSections` hardcodes — the closing block
     * asks to be contacted rather than repeating the header's ask.
     */
    expect(source).toContain("const closingCta = cta(plan.booking ? 'book' : 'contact');");
  });

  it('leaves the header making the primary ask', () => {
    expect(source).toContain('const headerCta = cta(primaryIntent);');
  });
});
