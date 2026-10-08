/**
 * A button's words and a button's destination, decided as one thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FAILURE THIS CLOSES
 *
 * A generated "Get in touch" scrolled to the Services section. Not a broken
 * anchor and not a dead link — `#services` is a real section and the browser
 * went exactly where it was told. The promise on the button was simply not the
 * promise in its href.
 *
 * It happened because a CTA had TWO AUTHORS. The model was asked for the
 * label — `cta.buttonText`, "2-4 words" — while `buildBlocks` hardcoded the
 * destination beside it, from facts the model never saw. Nothing made them
 * agree, and nothing could: the two halves were written in different places,
 * by different parties, out of different inputs.
 *
 * The header had already been fixed this way once, in isolation, with the
 * principle written out above it: *one field, two authors, and the visible
 * half was wrong.* The hero and the closing call to action were not, because
 * the principle lived in a comment rather than in a function.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE: A BUTTON IS AN INTENT
 *
 * The code picks the INTENT — it alone knows which sections this page installs
 * and whether the business has anything to sell. The model supplies the WORDS
 * for each intent. Then one function hands back the pair, so a caller cannot
 * take the text without taking the destination that goes with it.
 *
 * That keeps what each side is good for. The copy stays written for this
 * business in its own language, and the destination stays a fact about the
 * page rather than a guess about a sentence.
 *
 * Destinations resolve through `anchorForBlockType`, never as fresh literals:
 * the renderer stamps its ids from the same table, so the two cannot drift —
 * which is the whole reason that table was lifted out of the renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/website-builder/ctaIntent
 */

import { anchorForBlockType } from './sectionAnchors';

/**
 * What a generated button is FOR.
 *
 * Three, because a generated page has three things to ask of a visitor: buy,
 * talk, or read on. A fourth intent means a fourth kind of ask, not a fourth
 * place to scroll to.
 */
export type CtaIntent = 'book' | 'contact' | 'learnMore';

/**
 * A model label is unusable past this many characters.
 *
 * The rule the generator already applied, moved here so one place decides it:
 * a button has less room than a heading, and a model that writes a sentence
 * into a button breaks the layout of a page nobody proofreads before it is
 * published.
 */
const MAX_LABEL = 24;

export interface CtaPageFacts {
  /**
   * Does this page install a standalone booking section?
   *
   * Almost always false: a homepage stopped installing one, because each
   * service carries its own button resolving that service's own journey. When
   * it is false a `book` intent lands on the services list, which is where a
   * booking can actually start. Kept as a parameter rather than assumed,
   * because `planSections` still lets a caller ask for the widget.
   */
  hasBookingSection: boolean;
}

/**
 * Where an intent goes on this page.
 *
 * `book` is the only one that depends on anything: with no booking section,
 * the services list is where booking begins. `contact` and `learnMore` name
 * sections the generator installs unconditionally.
 */
export function ctaDestination(intent: CtaIntent, facts: CtaPageFacts): string {
  switch (intent) {
    case 'book':
      return facts.hasBookingSection
        ? `#${anchorForBlockType('booking_widget')}`
        : `#${anchorForBlockType('services')}`;
    case 'contact':
      return `#${anchorForBlockType('contact_form')}`;
    case 'learnMore':
      return `#${anchorForBlockType('about')}`;
  }
}

export interface CtaCopy extends CtaPageFacts {
  /** The model's label for THIS intent. Absent, blank or too long falls back. */
  written?: string | null;
  /** The phrasebook's label for this intent, in the page's language. */
  fallback: string;
}

/**
 * The button: its words and where it goes, which is one decision.
 *
 * Returned together on purpose. A caller that wanted only the text would be
 * free to pair it with a destination of its own, and that is precisely the bug
 * this module exists to make unwriteable.
 */
export function ctaFor(intent: CtaIntent, copy: CtaCopy): { text: string; link: string } {
  const label = copy.written?.trim();

  return {
    text: label && label.length <= MAX_LABEL ? label : copy.fallback,
    link: ctaDestination(intent, { hasBookingSection: copy.hasBookingSection }),
  };
}
