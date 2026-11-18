/**
 * The two questions asked of an owner who keeps their own website.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE TWO, AND WHY IN THIS ORDER
 *
 * The agent behind these answers reads a mailbox for the mail a contact form
 * sends. So two things have to be true before it can be offered: somebody fills
 * in a form on that site, and the result lands somewhere we can read.
 *
 * Only the second was ever asked. A site with no form at all generates no form
 * mail, so its owner had no honest answer to the only question put to them, and
 * a yes would have offered them an agent that reads a form that does not exist.
 * `lead_form` now comes first and `lead_arrival` follows only on a yes; a no at
 * either point is what makes the dashboard offer the smart links instead — our
 * own contact form link, which captures a lead with no site involved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHIPS ARE READ FROM THE TEMPLATES, NEVER COPIED HERE
 *
 * A test holding its own copy of the copy tests the copy it holds. The channels
 * chip was reworded on 2026-11-10, its keyword scan was not, and for six days a
 * tick on the only option about where clients come from recorded nothing at all
 * while this suite stayed green. Both of these questions have just been
 * reworded — `lead_arrival` now asks for the work ("help me capture my leads")
 * rather than for the fact — which is exactly when that class of bug lands.
 *
 * Both parsers are reached through a cast, as `onboardingAlreadyHasAWebsite`
 * does: driving `processUserMessage` would pull in the provider and the whole
 * turn machinery to exercise a handful of string tests. Nothing here calls a
 * model; this half of onboarding is deterministic by design.
 */

import { OnboardingConversationManager } from '@/lib/services/OnboardingConversationManager';

type Language = 'en' | 'he' | 'es';

const LANGUAGES: Language[] = ['en', 'he', 'es'];

function manager() {
  return new OnboardingConversationManager() as unknown as {
    readSiteHasForm(message: string, language: Language): boolean | null;
    extractLeadArrival(message: string, language: Language): boolean | null;
    getResponseTemplates(language: Language): Record<string, any>;
  };
}

/** The chips each question offers, exactly as the chat writes them. */
function chips(language: Language, key: 'lead_form_options' | 'lead_arrival_options') {
  const [yes, no] = manager().getResponseTemplates(language)[key] as string[];
  return { yes, no };
}

const readForm = (language: Language, message: string) =>
  manager().readSiteHasForm(message, language);

const readArrival = (language: Language, message: string) =>
  manager().extractLeadArrival(message, language);

describe.each(LANGUAGES)('Q4b-1, does anybody fill in a form, in %s', language => {
  const chip = () => chips(language, 'lead_form_options');

  it('reads the form chip as yes', () => {
    expect(readForm(language, chip().yes)).toBe(true);
  });

  it('reads the call-or-email chip as no', () => {
    expect(readForm(language, chip().no)).toBe(false);
  });

  it('reads BOTH of the chips it offers as an answer', () => {
    /* The assertion that catches a rewording: a chip nobody can read is a
       question that records nothing, and it fails silently. */
    const { yes, no } = chip();

    expect(readForm(language, yes)).not.toBeNull();
    expect(readForm(language, no)).not.toBeNull();
  });
});

describe.each(LANGUAGES)('Q4b-2, do those enquiries reach a mailbox, in %s', language => {
  const chip = () => chips(language, 'lead_arrival_options');

  it('reads the help-me-capture chip as yes', () => {
    /*
     * The chip no longer contains the word "email" in any language — it asks
     * for the work now — so the keyword list behind this reader cannot be what
     * carries it. The chip text is matched first for exactly that reason.
     */
    expect(readArrival(language, chip().yes)).toBe(true);
  });

  it('reads the another-way chip as no', () => {
    expect(readArrival(language, chip().no)).toBe(false);
  });

  it('reads BOTH of the chips it offers as an answer', () => {
    const { yes, no } = chip();

    expect(readArrival(language, yes)).not.toBeNull();
    expect(readArrival(language, no)).not.toBeNull();
  });
});

describe('the form question, on free text', () => {
  it('reads a plain mention of a form as yes', () => {
    expect(readForm('en', 'they use the contact form')).toBe(true);
    expect(readForm('he', 'ממלאים טופס')).toBe(true);
  });

  it('reads the ways a business takes work without a form as no', () => {
    for (const message of ['they call me', 'mostly whatsapp', 'they email me directly']) {
      expect(readForm('en', message)).toBe(false);
    }
  });

  it('does not let "instead" or "change" read as a refusal', () => {
    /*
     * Deliberately NOT the shared `NEGATORS` list, which carries 'change' and
     * 'instead' for the preview's "I want to change something". Against this
     * question, "they fill in a form instead of calling" is a yes, and reading
     * it as a no would hide the agent from the owner it suits.
     */
    expect(readForm('en', 'they fill in a form instead of calling')).toBe(true);
  });

  it('returns null rather than guessing at something it cannot read', () => {
    for (const message of ['hmm', '🙂', 'אוקיי בסדר גמור ???', '']) {
      expect(readForm('en', message)).toBeNull();
    }
  });
});
