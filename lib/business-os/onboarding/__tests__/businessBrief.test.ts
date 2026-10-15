/**
 * The contract the interview collects against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The onboarding chat captured everything needed to CONFIGURE the platform and
 * nothing needed to WRITE about the business. Measured on a real account:
 * `goals`, `tools` and `pain_points` all came back `[]`, and the description
 * stayed the one sentence the owner typed — so every prompt downstream had
 * nothing to work from.
 *
 * The answer is not "ask more questions". It is to declare what we are trying
 * to end up holding, so the model can see what is missing and ask for that and
 * nothing else. This file pins that contract, because three things read it: the
 * question picker, the answer reader, and the pre-build summary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  BRIEF_FIELDS,
  withoutDashPunctuation,
  EMPTY_BRIEF,
  MAX_FOLLOW_UPS,
  briefContract,
  briefHasAnything,
  briefSoFar,
  isEnough,
  mergeIntoBrief,
  fieldsStillToAsk,
  missingFields,
  type BusinessBrief,
} from '../businessBrief';

describe('the contract itself', () => {
  it('names every field the brief holds', () => {
    // A field in the type but not in FIELDS is one nothing will ever ask for.
    const declared = BRIEF_FIELDS.map(field => field.key).sort();
    expect(declared).toEqual([
      'audience',
      'credentials',
      /* How the work actually runs. The largest hole in the interview: the
         services question asked for name, duration and price, so the only
         prose the platform held about what a business DOES was the sentence
         typed at the start. See `servicesAreDraftsWithWords.guard`. */
      'delivery',
      'differentiators',
      'objections',
      'outcome',
    ]);
  });

  it('gives the model a meaning and a reason for each', () => {
    /*
     * The reason is not decoration: it is how the model judges whether the
     * owner's description already covers a field, instead of asking regardless.
     */
    for (const field of BRIEF_FIELDS) {
      expect(field.meaning.length).toBeGreaterThan(20);
      expect(field.earnsItsQuestion.length).toBeGreaterThan(20);
      expect(field.example).toMatch(/\?$/);
    }
  });

  it('renders a contract that names every field', () => {
    const contract = briefContract();
    for (const field of BRIEF_FIELDS) {
      expect(contract).toContain(field.key);
      expect(contract).toContain(field.meaning);
    }
  });

  it('allows one question per field, and no more', () => {
    /*
     * It was four against five fields, so the last in the order was never
     * reached — not declined, never asked: the loop exits on the count before
     * the model is consulted again. Measured, that field was always
     * `objections`, the one that feeds the whole FAQ.
     *
     * Tied to the list rather than written as a number, so adding a field
     * cannot silently starve the one below it.
     */
    expect(MAX_FOLLOW_UPS).toBe(BRIEF_FIELDS.length);
  });
});

describe('what is still missing', () => {
  it('is everything, to begin with', () => {
    expect(missingFields(EMPTY_BRIEF).map(f => f.key)).toHaveLength(BRIEF_FIELDS.length);
  });

  it('shrinks as answers arrive', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, { audience: ['competitive gymnasts, ages 8-16'] });
    expect(missingFields(brief).map(f => f.key)).not.toContain('audience');
  });
});

describe('enough to write from', () => {
  it('needs who it is for and what they get', () => {
    // The floor. A page can be written without the other three — thinner, but
    // honest — and holding the owner hostage for them costs more than it returns.
    expect(isEnough(EMPTY_BRIEF)).toBe(false);
    expect(isEnough(mergeIntoBrief(EMPTY_BRIEF, { audience: ['parents'] }))).toBe(false);

    const both = mergeIntoBrief(EMPTY_BRIEF, {
      audience: ['parents'],
      outcome: ['a child who can do a backflip'],
    });
    expect(isEnough(both)).toBe(true);
  });

  it('does not demand credentials, which a new business may not have', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, {
      audience: ['parents'],
      outcome: ['confidence'],
    });
    expect(isEnough(brief)).toBe(true);
    expect(brief.credentials).toEqual([]);
  });
});

describe('merging an answer', () => {
  it('keeps what was already there', () => {
    const first = mergeIntoBrief(EMPTY_BRIEF, { audience: ['beginners'] });
    const second = mergeIntoBrief(first, { outcome: ['a first routine'] });

    expect(second.audience).toEqual(['beginners']);
    expect(second.outcome).toEqual(['a first routine']);
  });

  it('adds to a field rather than replacing it', () => {
    // A later answer elaborating on an earlier one should extend it.
    const first = mergeIntoBrief(EMPTY_BRIEF, { audience: ['beginners'] });
    const second = mergeIntoBrief(first, { audience: ['competitive gymnasts'] });

    expect(second.audience).toEqual(['beginners', 'competitive gymnasts']);
  });

  it('says the same thing once', () => {
    const first = mergeIntoBrief(EMPTY_BRIEF, { audience: ['Beginners'] });
    const second = mergeIntoBrief(first, { audience: ['beginners'] });

    expect(second.audience).toEqual(['Beginners']);
  });

  it('ignores blank values rather than storing them', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, { audience: ['  ', ''] });
    expect(brief.audience).toEqual([]);
  });

  it('records the voice, and does not lose it to a later answer', () => {
    /*
     * The generated About copy switches between "our mission", "I bring" and
     * "We work" in one paragraph because nothing recorded which this business
     * is. One answer establishing it must survive the rest.
     */
    const first = mergeIntoBrief(EMPTY_BRIEF, { voice: 'individual' });
    const second = mergeIntoBrief(first, { audience: ['parents'] });

    expect(second.voice).toBe('individual');
  });

  it('lets a later answer correct the voice', () => {
    const first = mergeIntoBrief(EMPTY_BRIEF, { voice: 'individual' });
    const second = mergeIntoBrief(first, { voice: 'team' });

    expect(second.voice).toBe('team');
  });
});

describe('what the model is shown of the brief so far', () => {
  it('says so plainly when there is nothing', () => {
    expect(briefSoFar(EMPTY_BRIEF)).toBe('(nothing yet)');
  });

  it('lists only the fields that have something', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, { audience: ['parents'] });
    const shown = briefSoFar(brief);

    expect(shown).toContain('audience: parents');
    expect(shown).not.toContain('credentials');
  });

  it('knows whether anything was collected at all', () => {
    // The pre-build summary shows the brief only when it has something.
    expect(briefHasAnything(EMPTY_BRIEF)).toBe(false);
    expect(briefHasAnything(mergeIntoBrief(EMPTY_BRIEF, { voice: 'team' }))).toBe(true);
    expect(briefHasAnything(mergeIntoBrief(EMPTY_BRIEF, { outcome: ['x'] }))).toBe(true);
  });
});

describe('the shape never loses a field', () => {
  it('EMPTY_BRIEF carries every key the type declares', () => {
    const keys = Object.keys(EMPTY_BRIEF).sort();
    expect(keys).toEqual([
      'audience',
      'credentials',
      'delivery',
      'differentiators',
      'objections',
      'outcome',
      'voice',
    ]);
  });

  it('a merge of nothing changes nothing', () => {
    const brief: BusinessBrief = mergeIntoBrief(EMPTY_BRIEF, {});
    expect(brief).toEqual(EMPTY_BRIEF);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE QUESTIONS ARE NOT WRITTEN HERE.
 *
 * `example` exists to set the register inside the prompt — the model writes its
 * own question, in the owner's language, referring to what they actually said.
 * Measured across three runs of the same gap: "Who comes to you…", "Who are the
 * clients you usually work with…", "Who are your sessions designed for…".
 *
 * The danger is an example LEAKING to a user. One did: a fallback in the
 * response path reached for `BRIEF_FIELDS[].example`, which would have put an
 * English question in front of a Hebrew owner mid-interview — the exact failure
 * `business_story` already guards against, where an extraction answered a
 * Hebrew conversation in English and that became a whole website's source text.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('no example is ever shown to an owner', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const manager = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
    'utf8'
  );

  /**
   * What the step actually REPLIES with.
   *
   * `case 'business_deepening'` appears twice — once in the state machine that
   * decides what to ask, once in the responder that says it — so this takes the
   * last one and reads to the end of that branch. Anchoring on the first gave
   * an empty slice and a test that asserted nothing.
   */
  const replyStart = manager.lastIndexOf("case 'business_deepening':");
  const replyBranch = manager.slice(
    replyStart,
    manager.indexOf("case 'language_selection':", replyStart)
  );

  it('the reply is the model\'s question or a translated prompt', () => {
    expect(replyBranch).toMatch(/state\.collectedData\.pendingBriefQuestion/);
    expect(replyBranch).toMatch(/responses\.business_story_prompt/);
  });

  it('never falls back to an English example', () => {
    // The whole point: these strings are prompt material, not copy.
    const code = replyBranch.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/BRIEF_FIELDS/);
  });

  it('every example still ends in a question mark, for the register it sets', () => {
    for (const field of BRIEF_FIELDS) expect(field.example).toMatch(/\?$/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A QUESTION ASKED IS A QUESTION SPENT.
 *
 * Reported from a real interview:
 *
 *   "Who usually comes to you for gymnastic training — are they beginners,
 *    experienced athletes, or those looking to try something new?"
 *   > all kind
 *   "Who do you usually train — are they beginners, advanced athletes, or
 *    people with specific fitness goals?"
 *
 * The answer reader records only what the words support, "all kind" supported
 * nothing, the field stayed empty, and the picker chose it again. A few vague
 * answers would spend the whole interview on one field — and asking someone
 * what they just told you reads as not listening.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the same field is never put to the owner twice', () => {
  it('drops a field that was asked, even though it is still empty', () => {
    // The reported case exactly: asked, answered vaguely, recorded nothing.
    const still = fieldsStillToAsk(EMPTY_BRIEF, ['audience']);

    expect(still.map(f => f.key)).not.toContain('audience');
    expect(missingFields(EMPTY_BRIEF).map(f => f.key)).toContain('audience');
  });

  it('drops a field that was answered, whether or not it was asked', () => {
    const brief = mergeIntoBrief(EMPTY_BRIEF, { outcome: ['confidence'] });
    expect(fieldsStillToAsk(brief).map(f => f.key)).not.toContain('outcome');
  });

  it('runs out, rather than looping, once everything has been put to them', () => {
    /*
     * The guarantee that matters: with the cap equal to the field count, an
     * interview of entirely vague answers still terminates.
     */
    const everyField = BRIEF_FIELDS.map(f => f.key);
    expect(fieldsStillToAsk(EMPTY_BRIEF, everyField)).toEqual([]);
  });

  it('keeps the contract order among what is left', () => {
    const still = fieldsStillToAsk(EMPTY_BRIEF, ['audience', 'differentiators']);
    expect(still.map(f => f.key)).toEqual(['outcome', 'credentials', 'objections', 'delivery']);
  });

  it('asks everything when nothing has been asked', () => {
    expect(fieldsStillToAsk(EMPTY_BRIEF)).toHaveLength(BRIEF_FIELDS.length);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A QUESTION THAT ASKS FOR AN OPINION GETS AN ADJECTIVE.
 *
 * The first version of this list had one defect in five different costumes:
 * every question asked the owner to generalise about themselves, and one
 * handed them a menu. Measured, from a real interview:
 *
 *   "Who usually comes to you for gymnastic training, are they beginners,
 *    experienced athletes, or those looking to try something new?"
 *   > all kind
 *
 * These examples are not shown to anyone, but they set the register the model
 * imitates, so a menu here becomes a menu in front of every owner. Pinned
 * because the bad phrasings are the FLUENT ones: "what makes you different?"
 * reads like a good interview question and returns "professional".
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the questions ask for a memory, not an opinion', () => {
  it('never offers options to choose from', () => {
    // "are they A, B, or C" is what produced "all kind".
    for (const field of BRIEF_FIELDS) {
      expect(field.example).not.toMatch(/\b(are they|is it|do you mostly)\b[^?]*,[^?]*\bor\b/i);
    }
  });

  it('never asks the owner to characterise themselves', () => {
    /*
     * The adjectives a business applies to itself are worthless as copy
     * material, and asking produces nothing else.
     */
    for (const field of BRIEF_FIELDS) {
      expect(field.example).not.toMatch(/what makes you|why (you|should|would)|differently from|unique|special/i);
    }
  });

  it('presupposes nothing about how long the work lasts', () => {
    /*
     * "after working with you for a few months" is nonsense to a photographer
     * or a plumber, and a nonsense question gets a nonsense answer.
     */
    for (const field of BRIEF_FIELDS) {
      expect(field.example).not.toMatch(/few months|each session|every week|per month|ongoing/i);
    }
  });

  it('attributes any judgement to the client, where it asks for one at all', () => {
    // The one field that cannot be answered from pure recall.
    const differentiators = BRIEF_FIELDS.find(field => field.key === 'differentiators')!;
    expect(differentiators.example).toMatch(/clients? (told|tell|said|say)/i);
  });

  it('asks the objection as something somebody actually said', () => {
    const objections = BRIEF_FIELDS.find(field => field.key === 'objections')!;
    expect(objections.example).toMatch(/asked|said/i);
  });

  it('asks for one specific client rather than a demographic', () => {
    const audience = BRIEF_FIELDS.find(field => field.key === 'audience')!;
    expect(audience.example).toMatch(/recently|last|think of/i);
  });

  it('carries no em dash, which the register would propagate to the owner', () => {
    for (const field of BRIEF_FIELDS) expect(field.example).not.toMatch(/\u2014/);
  });
});

describe('the picker is told the rules, not left to infer them', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const prompt = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
    'utf8'
  );

  it('forbids a menu explicitly', () => {
    // A model obeys a rule more reliably than it imitates a sample.
    expect(prompt).toMatch(/NEVER offer options to choose from/);
  });

  it('forbids asking the owner to characterise themselves', () => {
    expect(prompt).toMatch(/NEVER ask the owner to characterise themselves/);
  });

  it('asks for recall over reasoning', () => {
    expect(prompt).toMatch(/Ask for something the owner can REMEMBER/);
  });

  it('forbids presupposing the shape of the work', () => {
    expect(prompt).toMatch(/Assume nothing about the shape of the work/);
  });

  it('forbids every dash in a question an owner will read', () => {
    /*
     * Was /No em dashes/, and the model complied by using a spaced hyphen
     * instead. The rule now names all three, and `withoutDashPunctuation`
     * removes them regardless of whether the rule was obeyed.
     */
    expect(prompt).toMatch(/No dashes of any kind between clauses, em, en or hyphen/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE DASH, REMOVED WHERE THE OWNER READS IT.
 *
 * Reported as "remove the sign - from the questions and answers in the chat".
 * Both the question put to the owner and the description composed from their
 * answers are model-written and shown verbatim, and the prompt rule against the
 * em dash had simply moved the model to a spaced hyphen.
 *
 * So it is done in code. The hazard is over-reach: a hyphen inside a word is
 * not punctuation, and "a 20-minute call" is exactly the kind of concrete
 * detail this interview exists to collect.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('removing the dash', () => {
  it('turns a dash between clauses into the comma it stood for', () => {
    expect(withoutDashPunctuation('Who comes to you — beginners or athletes?'))
      .toBe('Who comes to you, beginners or athletes?');
    expect(withoutDashPunctuation('I train athletes - mostly gymnasts.'))
      .toBe('I train athletes, mostly gymnasts.');
    expect(withoutDashPunctuation('Sessions run weekly – usually on Tuesdays.'))
      .toBe('Sessions run weekly, usually on Tuesdays.');
  });

  it('keeps a hyphen inside a word, which is not punctuation', () => {
    // The concrete details are the whole point of the interview.
    expect(withoutDashPunctuation('We start with a 20-minute call.'))
      .toBe('We start with a 20-minute call.');
    expect(withoutDashPunctuation('I work full-time in e-commerce.'))
      .toBe('I work full-time in e-commerce.');
  });

  it('does not leave a comma stacked on other punctuation', () => {
    expect(withoutDashPunctuation('What do they get —?')).toBe('What do they get?');
    expect(withoutDashPunctuation('Tell me more -')).toBe('Tell me more');
    expect(withoutDashPunctuation('First, — then what?')).toBe('First, then what?');
  });

  it('works on a Hebrew sentence, where the dash is used the same way', () => {
    expect(withoutDashPunctuation('מי מגיע אליך — מתחילים או מתקדמים?'))
      .toBe('מי מגיע אליך, מתחילים או מתקדמים?');
  });

  it('leaves a clean sentence exactly as it was', () => {
    const clean = 'What is the last thing someone asked you before they decided to go ahead?';
    expect(withoutDashPunctuation(clean)).toBe(clean);
  });

  it('is applied to the question and to the description, not just prompted for', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const manager = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
      'utf8'
    );

    expect(manager).toMatch(/question: withoutDashPunctuation\(picked\.question\.trim\(\)\)/);
    expect(manager).toMatch(/return withoutDashPunctuation\(written\.trim\(\)\)/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * WHY THREE FIELDS CAME BACK EMPTY ON A REAL ACCOUNT.
 *
 * Four questions were asked and two of the fields they were asked for stayed
 * empty, with `delivery` never asked at all:
 *
 *   asked differentiators: "what made them choose you over another trainer?"
 *   > many years of experience              -> filed under CREDENTIALS only
 *
 *   asked objections: "the last thing a parent asked before deciding?"
 *   > that I make sure the kids showing progress  -> filed under OUTCOME only
 *
 *   delivery: appeared three times in `askedBriefFields` and never as a
 *   question. The picker retired it as obvious for a tutor.
 *
 * Three separate faults, each invisible on its own: the reader substituted
 * instead of adding, `delivery` was missing from the reader's own return list,
 * and a field that fills a whole section could be retired.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a field that fills a whole section is never retired', () => {
  it('is declared on the contract, not listed at the call site', () => {
    const protectedFields = BRIEF_FIELDS.filter(f => f.feedsASection).map(f => f.key).sort();
    expect(protectedFields).toEqual(['delivery', 'objections']);
  });

  it('names exactly the two that ARE a section', () => {
    /*
     * `objections` is the FAQ; `delivery` is How-It-Works. Retired, those
     * sections are not thinner — they are written from the booking flow, which
     * is identical for every business on the platform.
     */
    const byKey = Object.fromEntries(BRIEF_FIELDS.map(f => [f.key, f]));
    expect(byKey.objections.feedsASection).toBe(true);
    expect(byKey.delivery.feedsASection).toBe(true);
    expect(byKey.audience.feedsASection).toBeUndefined();
    expect(byKey.outcome.feedsASection).toBeUndefined();
    expect(byKey.credentials.feedsASection).toBeUndefined();
    expect(byKey.differentiators.feedsASection).toBeUndefined();
  });

  it('the picker drops them from a skip list and says so', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const manager = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
      'utf8'
    );

    expect(manager).toMatch(/const protectedFields = BRIEF_FIELDS\.filter\(f => f\.feedsASection\)/);
    expect(manager).toMatch(/'Declined to retire a field that fills a whole section'/);
  });
});

describe('the field that was asked always receives the answer', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const manager = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
    'utf8'
  );

  it('falls back to their own words under the asked field', () => {
    /*
     * In code, not in the prompt: the prompt already said "put what they said
     * there" and the model reclassified anyway. A field that was asked is a
     * field that will not be asked again, so losing the answer is permanent.
     */
    expect(manager).toMatch(/if \(!recorded\[field\]\.length\) \{/);
    expect(manager).toMatch(/recorded\[field\] = \[answer\.trim\(\)\];/);
  });

  it('says it is an addition, never a substitution', () => {
    expect(manager).toMatch(/That is an\n      \/\/ addition, never a substitution|addition, never a substitution/);
  });

  it('lets the reader return delivery at all', () => {
    // It was a field of the contract and absent from the reader's return list,
    // so an answer about how the work runs had nowhere to go.
    expect(manager).toMatch(/objections, delivery \(arrays of strings\), and voice/);
  });
});
