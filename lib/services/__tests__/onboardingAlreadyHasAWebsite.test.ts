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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHIP WAS SPLIT, AND THESE TESTS CHANGED WITH IT
 *
 * It used to read "I already have a website: read the enquiries it emails me",
 * and the parser granted the mailbox channel off that single tick. Two facts in
 * one answer: an owner whose enquiries come by phone could not tick it, so we
 * lost the first fact in order to guess at the second.
 *
 * The chip now says only "I already have a website". Whether those enquiries
 * reach a mailbox is `extractLeadArrival`, asked as a follow-up and only of
 * these owners — covered at the bottom of this file.
 *
 * So `needs_inbox_channel` is FALSE here on every path. That is the point, not
 * a regression: nothing this parser sees can answer it.
 */

import { OnboardingConversationManager } from '@/lib/services/OnboardingConversationManager';

/** The three chips, exactly as `getResponseTemplates` writes them. */
const CHIPS = {
  en: {
    build: 'Build me a professional website',
    own: 'I already have a website',
    channels: 'Connect Facebook, Instagram or Google: see where clients come from',
  },
  he: {
    build: 'שאבנה לך אתר מקצועי',
    own: 'כבר יש לי אתר',
    channels: 'לחבר פייסבוק, אינסטגרם או גוגל: לראות מאיפה מגיעים הלקוחות',
  },
  es: {
    build: 'Que te construya un sitio web profesional',
    own: 'Ya tengo un sitio web',
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
    /* The line this file exists for. */
    expect(result.needs_website).toBe(false);
    expect(result.acquisition_channels).not.toContain('website');
  });

  it('grants no mailbox channel from the chip alone', () => {
    /*
     * The chip says they HAVE a site. It no longer claims the site emails
     * them, and the channel this would grant reads a mailbox — so granting it
     * here is precisely how the agent came to be offered to owners whose leads
     * never reach one. `extractLeadArrival` answers it instead.
     */
    const result = read(language, chip.own);

    expect(result.needs_inbox_channel).toBe(false);
    expect(result.acquisition_channels).not.toContain('inbox_enquiries');
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
  });

  it('keeps the channels chip independent of either', () => {
    const result = read(language, chip.own, chip.channels);

    expect(result.needs_channel_insights).toBe(true);
    expect(result.has_website).toBe(true);
    expect(result.needs_website).toBe(false);
  });

  it('concludes nothing from the channels chip alone', () => {
    const result = read(language, chip.channels);

    expect(result.needs_website).toBe(false);
    expect(result.needs_inbox_channel).toBeFalsy();
    expect(result.has_website).toBeNull();
  });
});

/**
 * The follow-up: do the enquiries from that site reach a mailbox?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASKED BECAUSE IT CANNOT BE INFERRED, AND NULL BECAUSE A GUESS COSTS MORE
 *
 * Having a website does not mean its enquiries arrive by email — plenty of
 * businesses take every one by phone. So this is the question the old bundled
 * chip was quietly answering on the owner's behalf.
 *
 * Its answer picks an OFFER on the dashboard and nothing else: true offers the
 * agent that reads enquiry email, false offers the form smart link to share
 * with clients, and null offers neither until we know. That is why an
 * unparseable reply must return null rather than a direction — a guessed
 * `false` hides an agent from someone it suits, and a guessed `true` offers an
 * agent that reads a mailbox their leads never reach.
 */
const ARRIVAL = {
  en: { yes: 'Yes, enquiries land in my email', no: 'No, they reach me another way' },
  he: { yes: 'כן, הפניות מגיעות למייל שלי', no: 'לא, הן מגיעות אליי בדרך אחרת' },
  es: { yes: 'Sí, las consultas llegan a mi correo', no: 'No, me llegan de otra forma' },
} as const;

function readArrival(language: Language, message: string): boolean | null {
  const manager = new OnboardingConversationManager() as unknown as {
    extractLeadArrival(message: string, language: Language): boolean | null;
  };
  return manager.extractLeadArrival(message, language);
}

describe.each(Object.keys(ARRIVAL) as Language[])('the lead-arrival answer in %s', language => {
  it('reads the yes chip as yes', () => {
    expect(readArrival(language, ARRIVAL[language].yes)).toBe(true);
  });

  it('reads the no chip as no', () => {
    /*
     * Every "no" chip here opens with a negator, and the negation test runs
     * FIRST for that reason: the Hebrew and Spanish affirmatives would
     * otherwise have to avoid words that appear inside their own refusals.
     */
    expect(readArrival(language, ARRIVAL[language].no)).toBe(false);
  });

  it('returns null rather than guessing at something it cannot read', () => {
    expect(readArrival(language, 'אוקיי בסדר גמור ???')).toBeNull();
  });
});

describe('the lead-arrival answer, on free text', () => {
  it('reads a plain mention of email as yes', () => {
    /* Typed instead of tapped. The owner said the thing; honour it. */
    expect(readArrival('en', 'they come to my email yes')).toBe(true);
  });

  it('lets a negator beat a mention of email', () => {
    /*
     * "not to my email" contains `email`, so affirmative-first would read a
     * refusal as consent. Same asymmetry `isConfirmation` documents, and the
     * same resolution: any negator present means no.
     */
    expect(readArrival('en', 'no, not to my email')).toBe(false);
  });
});
