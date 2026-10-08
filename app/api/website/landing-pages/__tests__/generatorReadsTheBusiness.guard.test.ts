/**
 * The landing-page generator writes from the service AND from the business.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS BEING THROWN AWAY
 *
 * The route selected five fields from the business profile on every generation:
 *
 *     company_name, vertical, sub_vertical, target_audience,
 *     unique_value_proposition
 *
 * Three reached the model. `unique_value_proposition` did not — it was even
 * declared in the prompt builder's parameter type and then never read — and
 * neither did `sub_vertical`. So the one sentence a business has written about
 * what makes it different was fetched, typed, and dropped, while the page it
 * was meant to shape had its differentiators invented from the service
 * description alone.
 *
 * That is the whole difference between marketing copy about a service and
 * marketing copy from THIS business about that service.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The output is a model call: non-deterministic, costly, and wrong to assert
 * sentences about. What CAN be pinned is the input — that every field the route
 * pays to read reaches the prompt, which is exactly the invariant that broke.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const FILE = 'app/api/website/landing-pages/generate/route.ts';

/** Any route in this area, with its comments stripped. */
const codeOf = (file: string) =>
  fs
    .readFileSync(path.join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = codeOf(FILE);

/** Everything between the prompt's opening and its closing backtick. */
const prompt = code.slice(code.indexOf('return `TASK:'), code.indexOf('STEP 2: CONTENT GENERATION INSTRUCTIONS') + 4000);

describe('every profile field the route reads reaches the prompt', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(source).toContain('THE TWO THE PROFILE ALREADY ANSWERED');
    expect(code).not.toContain('THE TWO THE PROFILE ALREADY ANSWERED');
  });

  const SELECTED = ['company_name', 'vertical', 'sub_vertical', 'target_audience', 'unique_value_proposition'];

  it('still reads all five', () => {
    const select = code.slice(code.indexOf(".select('company_name"), code.indexOf(".select('company_name") + 120);
    for (const field of SELECTED) expect(select).toContain(field);
  });

  it.each(SELECTED)('%s is bound to a prompt variable', field => {
    // Read and then dropped is the fault this guards. Each field is pulled off
    // the profile into a local, and each local appears in the prompt below.
    expect(code).toMatch(new RegExp(`profile\\?\\.${field}`));
  });

  it('puts the business\'s own differentiator in front of the model', () => {
    expect(prompt).toContain('WHAT SETS THIS BUSINESS APART');
    expect(prompt).toContain('${uniqueValue');
  });

  it('and its specialism, which narrows the industry', () => {
    expect(prompt).toContain('SPECIALISM');
    expect(prompt).toContain('${specialism');
  });

  it('adds nothing when the profile is empty', () => {
    // Conditional, so a business that has filled none of this in does not get a
    // prompt full of empty headings telling the model those things are unknown.
    expect(prompt).toMatch(/\$\{uniqueValue \? `WHAT SETS THIS BUSINESS APART/);
    expect(prompt).toMatch(/\$\{specialism \? `SPECIALISM/);
  });
});

describe('the prompt carries no domain of its own', () => {
  /*
   * It used to sort every offering into four buckets with keyword lists —
   * קורס / הכשרה / course / workshop, אימון / coaching, טיפול / therapy — and
   * teach the model with two Hebrew examples from one clinic, about ADHD and
   * anxiety. A business selling pregnancy support, DJ sets or tutoring matched
   * none of it and landed in "anything else", while every page in the platform
   * was shaped by one vertical's vocabulary.
   *
   * The data it needs is already in the prompt: the industry, the specialism
   * and the description itself.
   */
  const DOMAIN_WORDS = ['קורס', 'טיפול', 'אימון', 'ייעוץ', 'הכשרה', 'anxiety', 'ADHD'];

  it.each(DOMAIN_WORDS)('does not hardcode %s', word => {
    expect(prompt).not.toContain(word);
  });

  it('classifies from the data rather than a keyword list', () => {
    expect(prompt).not.toContain('keywords:');
    expect(prompt).toContain('the INDUSTRY and the SPECIALISM');
  });

  it('asks for the offering type in the model’s own words', () => {
    // A fixed enum is the same hardcoding one line further down.
    expect(code).not.toContain('"course|service|coaching|treatment"');
    expect(code).toContain('your own word, not from a list');
  });

  it('gives section titles a fallback rather than a per-type table', () => {
    expect(prompt).not.toMatch(/For courses: "\$\{language === 'hebrew'/);
    expect(prompt).toContain('${l.whyChoose}');
    expect(prompt).toContain('${l.readyToStart}');
  });
});

describe('the content is written in the business’s language', () => {
  it('prefers the configured language over the script of the service name', () => {
    /*
     * "Couple training" and "Gym Public Training Course" are real rows on a
     * Hebrew account. Detected from the name, both produce an English page for
     * Hebrew clients, and the only lever is to rename the service.
     */
    expect(code).toContain('configuredLanguage(preferences?.preferred_language)');
    expect(code).toContain('configuredLanguage(profile?.language)');
    expect(code).toMatch(/\?\? detectLanguage\(/);
  });

  it('keeps detection for an account that has set neither', () => {
    expect(code).toContain('function detectLanguage');
  });

  it('records which answer won', () => {
    // So a page in the wrong language is diagnosable without guessing.
    expect(code).toContain('languageSource');
  });
});

describe('the layout is decided by the service row, not by the model', () => {
  /*
   * `BOOKABLE_TYPES.includes(offering_type)` chose whether a landing page gets
   * a booking section — from a word a model picked while describing the
   * offering. The platform already holds that answer in
   * `scheduling_services.is_scheduled`, and the list could only recognise the
   * nouns somebody had thought of, so a "programme" or a "retainer" lost its
   * booking widget for being phrased unfamiliarly.
   *
   * It became urgent the moment the prompt above stopped offering a fixed
   * vocabulary: a free-form answer matches a fixed list almost never.
   */
  const CREATE = 'app/api/website/landing-pages/route.ts';
  const PREVIEW = 'app/api/website/landing-pages/preview/route.ts';

  it.each([CREATE, PREVIEW])('%s asks the service whether it books', file => {
    const route = codeOf(file);
    expect(route).toContain('serviceTakesBookings(user.id, validated.serviceId)');
    expect(route).toContain("from('scheduling_services')");
    expect(route).toContain('is_scheduled');
  });

  it.each([CREATE, PREVIEW])('%s no longer keeps a list of bookable nouns', file => {
    const route = codeOf(file);
    expect(route).not.toContain('BOOKABLE_TYPES');
    expect(route).not.toMatch(/needsBooking = [^\n]*offeringType/);
  });

  it.each([CREATE, PREVIEW])('%s still carries the offering type for wording', file => {
    // It shapes the copy; it no longer decides the blocks.
    expect(codeOf(file)).toContain('offering_type');
  });
});

describe('the service description is still the brief', () => {
  it('is quoted in full, and the model is told to analyse it', () => {
    // The wizard now tells the owner this is what their page is written from;
    // that promise is kept here.
    expect(prompt).toContain('FULL DESCRIPTION');
    expect(prompt).toContain('${data.serviceDescription');
    expect(prompt).toContain('analyze this carefully');
  });

  it('and the instructions prefer the stated audience over a guessed one', () => {
    expect(code).toContain('use TARGET AUDIENCE above where the business has stated');
  });

  it('and tell it not to invent a differentiator it was given', () => {
    expect(code).toContain('a differentiator you');
    expect(code).toContain('invent instead is one they never claimed');
  });
});
