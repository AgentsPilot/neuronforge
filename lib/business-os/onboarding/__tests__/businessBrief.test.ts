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
      /* The question mark may now be followed by the trailing illustration:
         `…what is better for the client? (e.g. less stress)`. See
         `carries one short illustration` below for why that bracket exists. */
      expect(field.example).toMatch(/\?(?:\s*\(e\.g\.[^)]*\))?$/);
    }
  });

  it('renders a contract that names every field', () => {
    const contract = briefContract();
    for (const field of BRIEF_FIELDS) {
      expect(contract).toContain(field.key);
      expect(contract).toContain(field.meaning);
    }
  });

  it('costs fewer questions than there are fields, and says so out loud', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THIS TEST USED TO READ `toBe(BRIEF_FIELDS.length)`, one question per
     * field, and the reason is worth keeping: at four against five fields the
     * last in the order was never reached, not declined but never asked,
     * because the loop exits on the count before the model is consulted. That
     * field was `objections`, which feeds the whole FAQ.
     *
     * Six was then measured on a live run and six is too many. All six were
     * asked and two returned nothing usable; the owner's verdict was that
     * there are too many questions.
     *
     * So the budget is deliberately SMALLER than the number of pillars, which
     * means something goes unasked on every run. What stops that being the
     * FAQ is no longer arithmetic: the picker is handed the number of questions
     * left and told that the two section-feeding pillars come first. Both parts
     * are asserted below, because a budget smaller than the field count is only
     * safe while they exist.
     * ─────────────────────────────────────────────────────────────────────────
     */
    expect(MAX_FOLLOW_UPS).toBeLessThan(BRIEF_FIELDS.length);
    /* Enough to reach both section-feeders and still learn something else. */
    expect(MAX_FOLLOW_UPS).toBeGreaterThanOrEqual(
      BRIEF_FIELDS.filter(field => field.feedsASection).length + 2
    );
  });

  it('carries one short illustration, in the shape the interface styles', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * EVERY QUESTION SHOWS WHAT KIND OF ANSWER IS WANTED, and the shape is not
     * cosmetic: the chat bubble renders a TRAILING `(e.g. …)` smaller and
     * muted, and it finds it by looking at the end of the string. Woven into
     * the sentence it is styled as part of the question.
     *
     * Measured across two live runs, both failure directions:
     *
     *   NONE — five of six questions were abstract, and "what is better for
     *   the client?" returned "they happy with the results".
     *
     *   TOO BIG, OR INSIDE THE SENTENCE — "Who do you help most often, such as
     *   new homeowners or people facing water damage?" returned "water
     *   damage", and "…what is better for the client? For example, reduced
     *   stress." returned "reduce stress and budget control". Both answers are
     *   the illustration handed straight back.
     *
     * So: present, trailing, bracketed, one, and short. Four words is the cap
     * because the fifth makes it an answer.
     * ─────────────────────────────────────────────────────────────────────────
     */
    for (const field of BRIEF_FIELDS) {
      const match = /\((e\.g\.[^)]*)\)$/.exec(field.example);

      expect([field.key, Boolean(match)]).toEqual([field.key, true]);

      const words = match![1].replace(/^e\.g\.\s*/, '').trim().split(/\s+/);
      expect([field.key, words.length]).toEqual([field.key, expect.any(Number)]);
      expect(words.length).toBeLessThanOrEqual(4);
      /* An "or" makes it a menu, and a menu is answered by picking from it. */
      expect([field.key, match![1]]).not.toMatchObject([
        field.key,
        expect.stringMatching(/\bor\b|,/),
      ]);
    }
  });

  it('tells the model the shape, rather than leaving it to copy the samples', () => {
    /* The samples set the register; the rule is what holds when the model
       rephrases per trade. Both halves, since the interface depends on the
       bracket being last. */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const manager = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
      'utf8'
    );

    expect(manager).toMatch(/\(e\.g\. <two to four words>\)/);
    expect(manager).toMatch(/must be the LAST thing in the string/);
  });

  it('tells the picker its budget, and what to spend it on first', () => {
    /*
     * The two halves that make a budget smaller than the field count safe. A
     * source guard, because both live in the prompt: the number is interpolated
     * into the user message and the priority is a rule in the system message.
     */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const manager = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
      'utf8'
    );

    expect(manager).toMatch(/Questions left, including this one: \$\{questionsLeft\}/);
    expect(manager).toMatch(/Objections and delivery write whole sections/);
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
    for (const field of BRIEF_FIELDS) expect(field.example).toMatch(/\?(?:\s*\(e\.g\.[^)]*\))?$/);
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

/**
 * Every question asks exactly one thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MEASURED FAILURE
 *
 * `audience` asked "Think of someone you worked with recently: who were they,
 * and what did they come to you for?" and was answered, by the owner of this
 * platform, with an age range and a referral source. Neither half of the
 * question. His verdict: "if I answered wrong everyone will do the same."
 *
 * An owner answers the half they can answer. The other half is not refused, it
 * is simply never noticed, so the field is recorded as answered and the
 * question is spent. Two of the six were written this way, and the model that
 * phrases the real question follows these examples closely, so the fault was
 * inherited rather than invented.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('every question asks exactly one thing', () => {
  it('never joins two interrogatives with a comma', () => {
    /*
     * The exact shape of both offenders. `delivery` is deliberately NOT caught:
     * its second clause follows a COLON and narrows the ask rather than adding
     * a subject to it.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * ONE NAMED EXCEPTION, and it is a risk being carried deliberately.
     *
     * `audience` is the reviewed recommendation "Who do you help most often,
     * and what usually brings them to you?", which does join two halves. They
     * are halves of one topic — who, and why they come — rather than the two
     * unrelated asks this guard was written for, and the alternative wordings
     * all presumed a past client, which a business that has not opened cannot
     * answer.
     *
     * The failure this guard records happened on THIS field, so the exception
     * is the one place to watch: an answer that covers who but not why, or why
     * but not who, means split the question and ask the trigger as a follow-up.
     * Every other field is still held to the rule.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const JOINS_TWO_HALVES_OF_ONE_TOPIC = ['audience'];

    for (const field of BRIEF_FIELDS) {
      if (JOINS_TWO_HALVES_OF_ONE_TOPIC.includes(field.key)) continue;

      expect([field.key, field.example]).not.toMatchObject([
        field.key,
        expect.stringMatching(/,\s*(and|or)\s+(what|who|whom|when|where|why|how|which)\b/i),
      ]);
    }
  });

  it('never joins them without a comma either', () => {
    /*
     * For a rewrite that drops the comma and keeps the second ask.
     *
     * The AUXILIARY is what makes this safe: without it, `audience`'s own
     * replacement — "the last person who came to you" — would false-fire on a
     * relative pronoun. Do NOT simplify this to counting wh-words; that was
     * tried and it flags a question that is perfectly fine.
     */
    for (const field of BRIEF_FIELDS) {
      expect([field.key, field.example]).not.toMatchObject([
        field.key,
        expect.stringMatching(
          /\b(and|or)\s+(what|who|whom|when|where|why|how|which)\s+(do|did|are|is|was|were|have|has|would|will)\b/i
        ),
      ]);
    }
  });

  it('asks once, so it carries one question mark', () => {
    /* Stronger than the `/\?$/` assertions elsewhere in this file, which allow
       "Who were they? And what did they want?" */
    for (const field of BRIEF_FIELDS) {
      expect([field.key, (field.example.match(/\?/g) ?? []).length]).toEqual([field.key, 1]);
    }
  });

  it('tells the model the rule, rather than leaving it to copy the samples', () => {
    /*
     * The samples are never shown to an owner — they set the register for the
     * picker, which writes the real question. This file already states the
     * principle for the memory rule: a model obeys a rule more reliably than
     * it imitates a sample. The same applies here, so the rule is in the
     * prompt as well as in the examples above.
     */
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const manager = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
      'utf8'
    );

    /*
     * The RULE, not its wording. The prompt was shortened from 73 lines to 49
     * when its measured evidence moved into a comment block, and five guards
     * here failed on phrases that had only been reworded. A guard that pins
     * prose blocks every future edit while catching nothing extra.
     */
    expect(manager).toMatch(/- ONE ask\b/);
    expect(manager).toMatch(/Never join two with "and" or a comma/);
    expect(manager).toMatch(/Never join two with "and" or a comma/);
  });
});

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

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THREE GUARDS WERE REVERSED HERE, AND THIS RECORDS WHAT THEY USED TO SAY.
   *
   * They required the opposite of what the examples now do:
   *
   *   differentiators  had to match /clients? (told|tell|said|say)/
   *   objections       had to match /asked|ask|said|say|told|tell/
   *   audience         had to match /recently|last|think of/
   *
   * All three enforced the same design: attribute every judgement to a client,
   * and anchor every question in one remembered person. The reasoning is in the
   * contract's header and it was not wrong about adjectives.
   *
   * It was wrong about two other things, and that is why these are inverted
   * rather than deleted: owners do not know why they were chosen, so a question
   * demanding a client's words gets how they were FOUND or gets a quote the
   * owner made up, and a business that has not opened yet cannot answer any
   * question pinned to a past client at all.
   *
   * So the rule became: never require a client to have spoken, never require a
   * client to have existed. Deleting the guards would have left nothing saying
   * so, and the next person would have "fixed" the examples back.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('never requires the owner to quote a client, which is how a quote gets invented', () => {
    /*
     * `meaning` is where a real quote is still preferred: both fields tell the
     * recorder to keep an answer as the owner's own view unless they report a
     * client saying it. The QUESTION must not demand one.
     */
    for (const key of ['differentiators', 'objections']) {
      const field = BRIEF_FIELDS.find(f => f.key === key)!;

      expect([key, field.example]).not.toMatchObject([
        key,
        expect.stringMatching(/\b(client|clients|customer|customers|they|somebody|someone)\s+(told|said)\b/i),
      ]);
    }
  });

  it('never presumes the business already has clients', () => {
    /*
     * The whole set is asked of businesses that have not opened yet. "Your last
     * client", "the last person who came to you" and "recently" all make the
     * question unanswerable for them, and an unanswerable question is answered
     * with an invention.
     */
    for (const field of BRIEF_FIELDS) {
      expect([field.key, field.example]).not.toMatchObject([
        field.key,
        expect.stringMatching(/\b(your|the)\s+last\s+(client|customer|person)\b|\blast person who\b|\brecently\b/i),
      ]);
    }
  });

  it('keeps the owner off the subject of themselves', () => {
    /*
     * The adjective defence, which is what survives from the reversed guards.
     * Asking an owner what a CLIENT values is a question about somebody else;
     * asking what makes them special is a self-portrait, and the answer is
     * "professional".
     */
    for (const field of BRIEF_FIELDS) {
      expect([field.key, field.example]).not.toMatchObject([
        field.key,
        expect.stringMatching(/what makes (you|your business)|why (you|should|would)|unique|special|the best/i),
      ]);
    }
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
    expect(prompt).toMatch(/NEVER offer options/);
  });

  it('forbids asking the owner to characterise themselves', () => {
    expect(prompt).toMatch(/never ask them to characterise themselves/i);
  });

  it('asks for recall over reasoning', () => {
    /*
     * Same rule, rephrased when the examples stopped being pinned to "the last
     * client". That phrasing presumed a past client, which a business that has
     * not opened yet does not have — so the rule now names the property it was
     * always about: answerable from what the owner already knows, rather than
     * something they have to work out.
     */
    expect(prompt).toMatch(/Ask for what they ALREADY KNOW, not what they must work out or invent/);
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
