/**
 * A template must not break the conversion path.
 *
 * When a shape takes over a section it takes over its BUTTON too, and the
 * button is how someone books. The first three shapes written rendered a plain
 * anchor and dropped `onOpenBooking` entirely, so the editor's in-page booking
 * dialog became unreachable from the hero, the header and the closing block —
 * the three sections most likely to convert. Nothing looked wrong; the button
 * was there and did nothing.
 *
 * This asserts the props exist in the source rather than rendering, because the
 * failure is a missing prop, not a wrong pixel — and a prop that is never
 * destructured cannot be caught by looking at output that has no booking
 * context in the first place.
 */

import { readFileSync } from 'fs';
import { bookingIsDead } from '@/components/website/blocks/bookingAction';
import { join } from 'path';

const SHAPES = join(__dirname, '..', 'shapes');

/** Every shape whose section can start a booking. */
const CONVERTING = ['Hero', 'CTA', 'Header'];

describe('shapes that carry a booking control', () => {
  it.each(CONVERTING)('%s accepts the booking context', name => {
    const source = readFileSync(join(SHAPES, `${name}.tsx`), 'utf8');
    expect(source).toContain('isPreview');
    expect(source).toContain('onOpenBooking');
    expect(source).toContain('bookingUrl');
  });

  it.each(CONVERTING)('%s resolves the action rather than hardcoding a link', name => {
    const source = readFileSync(join(SHAPES, `${name}.tsx`), 'utf8');
    expect(source).toContain('resolveBookingAction');
    // The dialog case has to render a real button; an anchor cannot open it.
    expect(source).toContain("booking.kind === 'open'");
  });
});

/**
 * …and it must not offer a booking for something that is gone.
 *
 * `resolveBookingAction` opens the dialog for the BUSINESS — every active
 * service. That is right for a homepage's closing call to action and wrong for
 * a landing page whose one service has been deleted: the CTA kept working and
 * offered the client a completely different set of things to buy, on a page
 * written to sell one course.
 *
 * Source-level for the same reason as above: the defect is a condition that
 * was never written, and a render test needs a booking context that a page in
 * this state does not have.
 */
describe('a section whose service is gone', () => {
  /*
   * The predicate itself, because it is the whole rule and it is pure.
   */
  describe('bookingIsDead', () => {
    it('is true only when a named service is marked unavailable', () => {
      expect(bookingIsDead({ serviceId: 'abc', serviceUnavailable: true })).toBe(true);
    });

    it('is false for a homepage control, which names no service', () => {
      // The important half: these must keep opening booking for the business.
      expect(bookingIsDead({ serviceUnavailable: true })).toBe(false);
      expect(bookingIsDead({})).toBe(false);
      expect(bookingIsDead(null)).toBe(false);
      expect(bookingIsDead(undefined)).toBe(false);
    });

    it('is false while the service is still there', () => {
      expect(bookingIsDead({ serviceId: 'abc' })).toBe(false);
      expect(bookingIsDead({ serviceId: 'abc', serviceUnavailable: false })).toBe(false);
    });
  });

  /*
   * EVERY converting section, not just the pricing block that happens to carry
   * the service id. A landing page is about one thing; when it goes, a CTA or
   * hero still calling `resolveBookingAction` opens the business's booking and
   * offers a client a completely different set of services.
   */
  it.each(CONVERTING)('%s asks whether its booking is dead', name => {
    const source = readFileSync(join(SHAPES, `${name}.tsx`), 'utf8');
    expect(source).toContain('bookingIsDead');
  });

  it.each(CONVERTING)('%s disables the control rather than removing it', name => {
    const source = readFileSync(join(SHAPES, `${name}.tsx`), 'utf8');
    // A real disabled BUTTON: an anchor has no disabled state, so it would stay
    // reachable by keyboard.
    expect(source).toContain('disabled className="apc-btn');
  });

  it('keeps the CTA copy, so the owner can reattach a service', () => {
    const cta = readFileSync(join(SHAPES, 'CTA.tsx'), 'utf8');
    expect(cta).toContain('{c.title && <h2>{c.title}</h2>}');
    expect(cta).toContain('{c.description &&');
  });

  it('defines the predicate once, beside the resolver', () => {
    const shared = readFileSync(
      join(SHAPES, '..', '..', 'blocks', 'bookingAction.ts'),
      'utf8'
    );
    expect(shared).toContain('export function bookingIsDead');
    for (const name of CONVERTING) {
      const source = readFileSync(join(SHAPES, `${name}.tsx`), 'utf8');
      expect(source).not.toContain('function bookingIsDead');
    }
  });
});
