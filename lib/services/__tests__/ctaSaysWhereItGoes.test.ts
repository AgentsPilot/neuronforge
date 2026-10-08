/**
 * Every generated button goes where its words say it goes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS EXISTS FOR
 *
 * A generated site's closing call to action read "Get in touch" and scrolled to
 * the Services section. Not a dead anchor — `#services` is a real section and
 * the browser went exactly where it was told. The promise on the button was
 * simply not the promise in its href.
 *
 * It survived everything. `repairBlockLinks` only asks whether a destination
 * EXISTS, and this one did. Every test that rendered a page found the button
 * present and correct-looking. The one question nobody asked was whether the
 * two halves agreed, because the two halves had different authors: the model
 * wrote the label, `buildBlocks` wrote the link on the next line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS GOES THROUGH `buildBlocks` RATHER THAN THE INTENT TABLE
 *
 * `ctaIntent.test.ts` proves the table. It cannot prove that the generator uses
 * it — and the generator not using it is precisely what the bug was. So this
 * asserts over the blocks that actually come out, in every language and on both
 * shapes of business, which is the only place the pairing is observable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// uuid@13 is ESM-only and ts-jest does not transform it; the service imports it.
jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000001' }));

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

import { WebsiteGenerationService } from '@/lib/services/WebsiteGenerationService';
import { pageAnchors } from '@/lib/website-builder/sectionAnchors';

/** Labels a model would plausibly write, including the one that caused this. */
const LABELS = {
  en: { bookCta: 'Book a session', contactCta: 'Get in touch', learnMoreCta: 'See how it works' },
  he: { bookCta: 'קבעו פגישה', contactCta: 'צרו קשר', learnMoreCta: 'קראו עוד' },
  es: { bookCta: 'Reservar ahora', contactCta: 'Contáctanos', learnMoreCta: 'Conoce más' },
};

/** What the model returns, minus everything these assertions do not read. */
function content(buttons?: Record<string, string>) {
  return {
    title: 'A business',
    metaDescription: 'What it does',
    keywords: [],
    hero: { headline: 'A headline', subheadline: 'A subheadline' },
    about: { paragraphs: ['One paragraph.'] },
    serviceDescriptions: {},
    processSteps: [],
    testimonials: [],
    faq: [],
    ...(buttons ? { buttons } : {}),
  };
}

const SERVICES = [
  { id: 's1', service_name: 'Consultation', price: 300, currency: 'ILS', is_scheduled: true },
  { id: 's2', service_name: 'Follow-up', price: 150, currency: 'ILS', is_scheduled: true },
];

/* eslint-disable @typescript-eslint/no-explicit-any -- buildBlocks is private; see the header. */
function build(opts: {
  services?: any[];
  language?: string;
  buttons?: Record<string, string>;
} = {}): any[] {
  const service = new WebsiteGenerationService() as any;
  return service.buildBlocks(
    'page-1',
    content(opts.buttons),
    opts.services ?? SERVICES,
    opts.language ?? 'en',
    'A Business',
    false,
  );
}

interface Pair {
  blockType: string;
  text: string;
  link: string;
}

/** Every (words, destination) pair on the page, in both shapes one is stored in. */
function pairs(blocks: any[]): Pair[] {
  const found: Pair[] = [];

  for (const block of blocks) {
    const c = block.content ?? {};
    if (typeof c.cta_text === 'string' && typeof c.cta_link === 'string') {
      found.push({ blockType: block.block_type, text: c.cta_text, link: c.cta_link });
    }
    if (c.cta_button && typeof c.cta_button.text === 'string' && typeof c.cta_button.link === 'string') {
      found.push({ blockType: block.block_type, text: c.cta_button.text, link: c.cta_button.link });
    }
  }

  return found;
}

const pairOn = (blocks: any[], blockType: string) =>
  pairs(blocks).find(pair => pair.blockType === blockType)!;

/*
 * The words that prove a button is about talking to a person rather than
 * buying. Written out here rather than imported, deliberately: a test that
 * shares the production classifier agrees with it by construction and would
 * pass against a classifier that had been broken in the same direction.
 */
const SAYS_CONTACT = /contact|get in touch|צור קשר|צרו קשר|יצירת קשר|contáct|contacta/i;
const SAYS_BOOK = /book|session|reserv|קבע|פגיש/i;

describe('the reported bug', () => {
  /*
   * The exact shape that was shipping: two services, and a model that wrote a
   * contact-flavoured label. The closing CTA took the label and kept `#services`.
   */
  it('never pairs a contact button with the services section', () => {
    const blocks = build({ buttons: LABELS.en });

    for (const pair of pairs(blocks)) {
      if (SAYS_CONTACT.test(pair.text)) {
        expect(pair.link).toBe('#contact');
      }
    }
  });

  it('puts the booking words on the closing CTA and the contact words on the footer', () => {
    const blocks = build({ buttons: LABELS.en });

    expect(pairOn(blocks, 'cta')).toMatchObject({ text: 'Book a session', link: '#services' });
    expect(pairOn(blocks, 'footer')).toMatchObject({ text: 'Get in touch', link: '#contact' });
  });

  it('sends the hero on into the page rather than to a purchase', () => {
    const blocks = build({ buttons: LABELS.en });

    expect(pairOn(blocks, 'hero')).toMatchObject({ text: 'See how it works', link: '#about' });
  });
});

describe('a business with nothing to sell', () => {
  /*
   * No services, so every ask is a contact ask — and the booking label the
   * model wrote must not be placed on anything.
   */
  it('asks to be contacted, everywhere, and goes to the form', () => {
    const blocks = build({ services: [], buttons: LABELS.en });

    expect(pairOn(blocks, 'header')).toMatchObject({ text: 'Get in touch', link: '#contact' });
    expect(pairOn(blocks, 'cta')).toMatchObject({ text: 'Get in touch', link: '#contact' });
    expect(pairOn(blocks, 'footer')).toMatchObject({ text: 'Get in touch', link: '#contact' });
  });

  it('places no booking words anywhere', () => {
    const blocks = build({ services: [], buttons: LABELS.en });

    expect(pairs(blocks).filter(pair => SAYS_BOOK.test(pair.text))).toEqual([]);
  });
});

describe('in every language, on both shapes of business', () => {
  const LANGUAGES = ['en', 'he', 'es'] as const;

  it.each(LANGUAGES)('%s: no button contradicts its destination', language => {
    for (const services of [SERVICES, []]) {
      const blocks = build({ services, language, buttons: LABELS[language] });

      for (const pair of pairs(blocks)) {
        if (SAYS_CONTACT.test(pair.text)) expect(pair.link).toBe('#contact');
      }
    }
  });

  /*
   * An English-only version of this would be a false green: the labels are the
   * model's, and Hebrew is the language most of these sites are written in.
   */
  it('keeps a Hebrew contact label off the services section', () => {
    const blocks = build({ language: 'he', buttons: LABELS.he });

    expect(pairOn(blocks, 'footer')).toMatchObject({ text: 'צרו קשר', link: '#contact' });
    expect(pairOn(blocks, 'cta')).toMatchObject({ text: 'קבעו פגישה', link: '#services' });
  });
});

describe('every destination names a section this page has', () => {
  /*
   * The check `repairBlockLinks` performs at render, asserted at the source so
   * a wrong anchor is a failing test rather than a button that silently does
   * nothing. It is NOT the same check as the one above: this asks whether the
   * section exists, that one asks whether it is the right section.
   */
  it.each([['with services', SERVICES], ['without services', []]] as const)('%s', (_name, services) => {
    const blocks = build({ services: services as any[], buttons: LABELS.en });
    const anchors = pageAnchors(blocks);

    for (const pair of pairs(blocks)) {
      expect(pair.link.startsWith('#')).toBe(true);
      expect(anchors.has(pair.link.slice(1))).toBe(true);
    }
  });
});

describe('when the model writes no labels at all', () => {
  /*
   * The fallback-content path, and every generation made before the intent
   * fields existed. The phrasebook speaks and the destinations are unchanged.
   */
  it('still pairs every button with the right section', () => {
    const blocks = build({ buttons: undefined });

    for (const pair of pairs(blocks)) {
      expect(pair.text.length).toBeGreaterThan(0);
      if (SAYS_CONTACT.test(pair.text)) expect(pair.link).toBe('#contact');
    }
  });

  /* The header was already correct before this change and must stay identical. */
  it('leaves the header exactly as it was', () => {
    expect(pairOn(build(), 'header')).toMatchObject({ text: 'Book Now', link: '#services' });
    expect(pairOn(build({ services: [] }), 'header'))
      .toMatchObject({ text: 'Get in Touch', link: '#contact' });
  });

  it('ignores a label left over from a generation before intents', () => {
    // `heroCta` is what the model used to be asked for. Nothing reads it now.
    const blocks = build({ buttons: { heroCta: 'Book Your Session' } });

    expect(pairOn(blocks, 'hero')).toMatchObject({ text: 'Learn More', link: '#about' });
  });
});

describe('a label too long to be a button', () => {
  it('falls back to the phrasebook without moving the button', () => {
    const blocks = build({
      buttons: {
        ...LABELS.en,
        learnMoreCta: 'Read the whole story of how this business came to be',
      },
    });

    expect(pairOn(blocks, 'hero')).toMatchObject({ text: 'Learn More', link: '#about' });
  });
});
