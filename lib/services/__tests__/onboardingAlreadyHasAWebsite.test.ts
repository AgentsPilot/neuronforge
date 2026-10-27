/**
 * "I already have a website" must not be read as "build me a website".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `extractClientAcquisition` is a keyword scan, and every honest wording of the
 * new chip contains the exact words the website test matches: `website`, `אתר`,
 * `sitio`. Read in the wrong order, a business saying it already HAS a site is
 * recorded as asking us to BUILD one — and a keyword parser reports nothing
 * when it misreads. The consequence is silent and expensive: a website nobody
 * asked for, and no mailbox channel for the enquiries their own form is already
 * sending them.
 *
 * The parser is reached directly through a cast. `private` is a compile-time
 * marker with no runtime effect, and the alternative — driving
 * `processUserMessage` — would pull in the provider, the settings resolver and
 * the whole turn machinery to exercise six `includes` calls. This is the unit
 * with the risk in it, so this is the unit under test.
 *
 * Nothing here calls a model. The configuration half of onboarding is
 * deliberately deterministic, and this step is part of it.
 */

import { OnboardingConversationManager } from '@/lib/services/OnboardingConversationManager';

/** The three chips, exactly as `getResponseTemplates` writes them. */
const CHIPS = {
  en: {
    build: 'Build me a professional website',
    own: 'I already have a website: read the enquiries it emails me',
    channels: 'Connect Facebook, Instagram or Google: see where clients come from',
  },
  he: {
    build: 'שאבנה לך אתר מקצועי',
    own: 'כבר יש לי אתר: לקרוא ממנו את הפניות שמגיעות למייל',
    channels: 'לחבר פייסבוק, אינסטגרם או גוגל: לראות מאיפה מגיעים הלקוחות',
  },
  es: {
    build: 'Que te construya un sitio web profesional',
    own: 'Ya tengo un sitio: leer las consultas que llegan a mi correo',
    channels: 'Conectar Facebook, Instagram o Google: ver de dónde vienen tus clientes',
  },
} as const;

type Language = keyof typeof CHIPS;

interface Extraction {
  acquisition_channels: string[];
  has_website: boolean | null;
  needs_website: boolean;
  needs_channel_insights: boolean;
  needs_inbox_channel: boolean;
}

/** What the parser concludes from one multi-select answer. */
function read(language: Language, ...picked: string[]): Extraction {
  const manager = new OnboardingConversationManager() as unknown as {
    extractClientAcquisition(message: string): Extraction;
  };

  /* Joined with a comma, which is how the frontend sends ticked chips — and
     the separator the parser's clause-cut relies on. */
  return manager.extractClientAcquisition(picked.join(', '));
}

describe.each(Object.keys(CHIPS) as Language[])('the website chips in %s', language => {
  const chip = CHIPS[language];

  it('reads "I already have one" as having one, and NOT as wanting one built', () => {
    const result = read(language, chip.own);

    expect(result.has_website).toBe(true);
    expect(result.needs_inbox_channel).toBe(true);
    /* The line this file exists for. */
    expect(result.needs_website).toBe(false);
    expect(result.acquisition_channels).toContain('inbox_enquiries');
    expect(result.acquisition_channels).not.toContain('website');
  });

  it('still reads an explicit "build me one" as wanting one built', () => {
    const result = read(language, chip.build);

    expect(result.needs_website).toBe(true);
    expect(result.needs_inbox_channel).toBeFalsy();
    /* Declining our website says nothing about owning one — `null`, not false.
       That distinction is the whole reason the chip was added. */
    expect(result.has_website).toBeNull();
  });

  it('honours both at once: "I have a site, build me a better one"', () => {
    const result = read(language, chip.own, chip.build);

    expect(result.needs_website).toBe(true);
    expect(result.has_website).toBe(true);
    expect(result.needs_inbox_channel).toBe(true);
  });

  it('keeps the channels chip independent of either', () => {
    const result = read(language, chip.own, chip.channels);

    expect(result.needs_channel_insights).toBe(true);
    expect(result.needs_inbox_channel).toBe(true);
    expect(result.needs_website).toBe(false);
  });

  it('concludes nothing from the channels chip alone', () => {
    const result = read(language, chip.channels);

    expect(result.needs_website).toBe(false);
    expect(result.needs_inbox_channel).toBeFalsy();
    expect(result.has_website).toBeNull();
  });
});
