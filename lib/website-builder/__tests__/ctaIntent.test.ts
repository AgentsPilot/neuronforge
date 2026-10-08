/**
 * A button's words and its destination come out of one decision.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The table itself is tiny; what it is worth testing for is the two rules that
 * are easy to lose in a later edit — that a destination is never spelled as a
 * fresh literal, and that rejecting a model's label never moves the button.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ctaDestination, ctaFor } from '../ctaIntent';
import { anchorForBlockType } from '../sectionAnchors';

const NO_BOOKING = { hasBookingSection: false };
const WITH_BOOKING = { hasBookingSection: true };

describe('where each intent leads', () => {
  it('sends a contact button to the contact form', () => {
    expect(ctaDestination('contact', NO_BOOKING)).toBe('#contact');
  });

  it('sends a read-on button to the about section', () => {
    expect(ctaDestination('learnMore', NO_BOOKING)).toBe('#about');
  });

  /*
   * The services list is where a booking starts on a page with no booking
   * widget — each service card carries its own button. This is the one intent
   * whose destination depends on the page.
   */
  it('sends a booking button to the services, when the page installs no widget', () => {
    expect(ctaDestination('book', NO_BOOKING)).toBe('#services');
  });

  it('sends it to the widget when the page does install one', () => {
    expect(ctaDestination('book', WITH_BOOKING)).toBe('#booking');
  });

  /*
   * Not an incidental check. The renderer stamps its section ids from this same
   * table, and the reason the table was lifted out of the renderer is that a
   * generator spelling `#contact` by hand cannot be told when the renderer
   * renames it. A literal here would quietly reintroduce that.
   */
  it('reads every destination from the shared anchor table', () => {
    expect(ctaDestination('contact', NO_BOOKING)).toBe(`#${anchorForBlockType('contact_form')}`);
    expect(ctaDestination('learnMore', NO_BOOKING)).toBe(`#${anchorForBlockType('about')}`);
    expect(ctaDestination('book', NO_BOOKING)).toBe(`#${anchorForBlockType('services')}`);
    expect(ctaDestination('book', WITH_BOOKING)).toBe(`#${anchorForBlockType('booking_widget')}`);
  });
});

describe('the words that go with it', () => {
  it('uses what the model wrote for this intent', () => {
    expect(ctaFor('contact', { ...NO_BOOKING, written: 'Talk to us', fallback: 'Get in Touch' }))
      .toEqual({ text: 'Talk to us', link: '#contact' });
  });

  it('falls back to the phrasebook when the model wrote nothing', () => {
    expect(ctaFor('contact', { ...NO_BOOKING, fallback: 'Get in Touch' }).text).toBe('Get in Touch');
    expect(ctaFor('contact', { ...NO_BOOKING, written: '   ', fallback: 'Get in Touch' }).text)
      .toBe('Get in Touch');
  });

  it('rejects a label too long to be a button', () => {
    const essay = 'Reach out today and one of our advisors will be in touch shortly';

    expect(ctaFor('contact', { ...NO_BOOKING, written: essay, fallback: 'Get in Touch' }).text)
      .toBe('Get in Touch');
  });

  /*
   * The point of the whole module. Whichever label wins, the destination is the
   * intent's — so falling back to the phrasebook cannot move the button, and a
   * caller cannot take the text without the link that belongs to it.
   */
  it('keeps the destination whether the label was taken or rejected', () => {
    const taken = ctaFor('learnMore', { ...NO_BOOKING, written: 'See how it works', fallback: 'Learn More' });
    const rejected = ctaFor('learnMore', { ...NO_BOOKING, written: 'x'.repeat(80), fallback: 'Learn More' });

    expect(taken.link).toBe('#about');
    expect(rejected.link).toBe('#about');
  });

  it('writes a label in the language it was handed', () => {
    // The model writes these, so the test's job is only to prove nothing
    // latinises or re-cases them on the way through.
    expect(ctaFor('contact', { ...NO_BOOKING, written: 'צרו קשר', fallback: 'צרו קשר' }).text)
      .toBe('צרו קשר');
    expect(ctaFor('book', { ...NO_BOOKING, written: 'Reservar', fallback: 'Reservar' }).text)
      .toBe('Reservar');
  });
});
