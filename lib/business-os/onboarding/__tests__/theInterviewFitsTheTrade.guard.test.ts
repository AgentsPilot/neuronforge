/**
 * Six dutiful questions are worse than three sharp ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on one hair salon interview
 *
 * Reported as "the questions are always the same for all type of businesses,
 * some of them are hard to answer so I had to make it up as user". The making
 * it up is the part that matters: an invented answer becomes a claim on their
 * own website that they never made.
 *
 * Of the six questions asked, two returned their own premise:
 *
 *     "What do kids end up with after a visit to your salon
 *      that they didn't have before?"        > better hait style
 *     "Can you describe the process of what happens when someone
 *      books a hair appointment, from start to finish?"
 *                                            > they book time and come
 *
 * Neither is a bad question. For a haircut the outcome IS the haircut and the
 * process IS the appointment, so both are unanswerable in the only way that
 * matters: there is nothing there the trade did not already imply. The same
 * two questions are essential for a coach, a consultant, a course or a
 * programme, where the buyer genuinely cannot picture the work.
 *
 * The prompt had always permitted `{"field": null}` and the model never used
 * it: with six fields and a budget of six, declining is not the path of least
 * resistance. So the retirement is now DECLARED, once, up front, and runs
 * through the same list that stops a field being asked twice.
 *
 * The other half of the same report was the dash. It had been removed from the
 * model's output and left in every hardcoded question and answer button, which
 * is where the owner was actually reading it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { BRIEF_FIELDS, fieldsStillToAsk, EMPTY_BRIEF } from '../businessBrief';

const manager = fs.readFileSync(
  path.join(process.cwd(), 'lib/services/OnboardingConversationManager.ts'),
  'utf8'
);

describe('a field the trade already answers is retired, not declined each turn', () => {
  it('the picker returns a skip list', () => {
    expect(manager).toMatch(/skip: BriefField\['key'\]\[\];/);
    expect(manager).toMatch(/"skip": \["<fields whose answer this trade makes obvious>"\]/);
  });

  it('the rule names the test, with the measured examples', () => {
    /*
     * "Predict the answer; if your prediction is the question restated, the
     * question is worthless." A model obeys a stated test more reliably than
     * it infers one from permission to decline.
     */
    /*
     * Matched on the RULE, not its wording. The prompt was deliberately
     * shortened from 73 lines to 49 once its measured evidence moved into a
     * comment block, and nine guards failed on phrases that had only been
     * reworded. A guard that pins prose blocks every future edit and catches
     * nothing a looser pattern would miss: what matters is that the rule is
     * still stated to the model.
     */
    expect(manager).toMatch(/skip any field whose answer this TRADE makes obvious/i);
    expect(manager).toMatch(/if the prediction is the question restated/i);
    expect(manager).toMatch(/Three sharp questions beat six dutiful ones/);
  });

  it('says an invented answer is worse than a missing one', () => {
    // This is the actual harm: it ends up published under their name.
    expect(manager).toMatch(/becomes a claim on their website/);
  });

  it('keeps the delivery question about the work, and skippable', () => {
    // It asked about BOOKING, which is the one thing the site already knows.
    expect(manager).toMatch(/ask about the WORK, never (about )?booking or paying/);
    expect(manager).toMatch(/single visit with nothing to describe/);
  });

  it('accepts only field names it recognises, and never the current one', () => {
    /*
     * A model returning "pricing" or echoing the field it just asked would
     * otherwise retire something real or skip the question in flight.
     *
     * Asserted as three separate conditions rather than one line: a third was
     * added after the picker retired `delivery` on a real account and the
     * How-It-Works section was then written from the booking flow.
     */
    expect(manager).toMatch(/BRIEF_FIELDS\.some\(f => f\.key === key\)/);
    expect(manager).toMatch(/key !== field\.key/);
    expect(manager).toMatch(/!protectedFields\.includes\(key as BriefField\['key'\]\)/);
  });

  it('retires through the list that already excludes a field', () => {
    // One mechanism, not two: `fieldsStillToAsk` is the only reader.
    expect(manager).toMatch(/askedBriefFields = \[first\.field, \.\.\.first\.skip\]/);
    /*
     * Deduplicated now, so this no longer pins a bare array literal: the
     * model re-declares a dead field every turn it is still dead, and the
     * list grew `audience` four times over on one measured run. What the
     * guard still has to hold is that BOTH the asked field and the skipped
     * ones go into the one list `fieldsStillToAsk` reads.
     */
    expect(manager).toMatch(/askedBriefFields = Array\.from\(\s*new Set\(\[\.\.\.alreadyAsked, next\.field, \.\.\.next\.skip\]\)/);
  });

  it('logs what it retired, so a bad skip is findable', () => {
    expect(manager).toMatch(/'Retiring brief fields this trade makes obvious'/);
  });
});

describe('retiring a field shortens the interview', () => {
  it('a retired field leaves the pool', () => {
    // The hair salon: outcome and delivery gone, four fields left.
    const left = fieldsStillToAsk(EMPTY_BRIEF, ['outcome', 'delivery']).map(f => f.key);

    expect(left).not.toContain('outcome');
    expect(left).not.toContain('delivery');
    expect(left).toHaveLength(BRIEF_FIELDS.length - 2);
  });

  it('does not spend the question budget', () => {
    /*
     * The cap counts `followUpsAsked`, incremented only when a question is
     * actually put to somebody. Counting retirements against it would mean a
     * trade that skips two fields gets two fewer real questions as well.
     */
    expect(manager).toMatch(/const asked = updatedState\.collectedData\.followUpsAsked \?\? 0;/);
    expect(manager).not.toMatch(/const asked = .*askedBriefFields\.length/);
  });

  it('ends the step rather than looping once everything is retired', () => {
    expect(fieldsStillToAsk(EMPTY_BRIEF, BRIEF_FIELDS.map(f => f.key))).toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE DASH, IN THE HALF I MISSED FIRST TIME.
 *
 * `withoutDashPunctuation` scrubs what the MODEL writes. Every fixed question
 * and every answer button was hardcoded, untouched, and full of them:
 *
 *     "Great. Now — how do you sell?"
 *     "I collect the money myself — invoice, transfer or cash"
 *
 * which is precisely where the owner was reading them.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the fixed questions carry no dash either', () => {
  /** Every `*_prompt:` value, in all three languages. */
  const prompts = [...manager.matchAll(/^\s+[a-z_]+_prompt: (['"])((?:[^\\]|\\.)*?)\1,?\s*$/gm)].map(
    match => match[2]
  );

  it('found them', () => {
    // Nine service variants alone, plus the rest of the interview.
    expect(prompts.length).toBeGreaterThan(20);
  });

  it('none of them uses a dash between clauses', () => {
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/\s[—–]\s/);
      expect(prompt).not.toMatch(/\s-\s/);
    }
  });
});

/**
 * A question expecting a sentence asks one thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THIS TEST EXISTS TO HOLD
 *
 * A question with CHIPS beneath it may legitimately offer a choice, because the
 * chips are the choice: "do they pay online, or do you collect the money
 * yourself?" is an either/or whose three answers are enumerated directly below
 * it, and reading it as a fault would be reading the interface as a fault.
 *
 * A question expecting PROSE has no such list, so a second half is simply
 * dropped. `business_story_prompt` ended "and what brought you here today?" and
 * nobody ever answered it.
 *
 * Hence a declared list rather than a sweep over every prompt. Adding an open
 * question means adding it here, which is the point: the author has to decide
 * which kind they are writing.
 *
 * This is a LINT ON OUR OWN COPY, not a grammar checker. It cannot judge
 * Hebrew or Spanish; it recognises the one shape we have actually written and
 * got wrong, in each language.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('an open question asks one thing', () => {
  /** Prompts with no chips beneath them, so the owner answers in prose. */
  const OPEN_PROMPTS = ['business_story_prompt', 'business_story_again_prompt'] as const;

  const valueOf = (key: string) =>
    [...manager.matchAll(new RegExp(`^\\s+${key}: (['"])((?:[^\\\\]|\\\\.)*?)\\1,?\\s*$`, 'gm'))].map(
      match => match[2]
    );

  it('finds every language of each', () => {
    for (const key of OPEN_PROMPTS) {
      expect([key, valueOf(key).length]).toEqual([key, 3]);
    }
  });

  it('joins no two asks, in any language', () => {
    /*
     * Each of these was checked against the copy it replaced, and two of them
     * failed that check before being corrected. Worth recording, because both
     * failures are invisible from reading the regex:
     *
     *   HEBREW had a trailing `\b`. JavaScript word boundaries are ASCII, so
     *   one never fires after a Hebrew letter and the pattern matched nothing
     *   at all. A guard that cannot catch its own measured bug is decoration.
     *
     *   SPANISH required a comma. The sentence it exists to catch has none:
     *   "¿Qué haces y qué te trajo aquí hoy?" joins with a bare "y". So the
     *   separator is optional there, which is also why the Spanish alternatives
     *   are the interrogatives alone, with no auxiliary to lean on.
     */
    const conjoined = [
      /,\s*(and|or)\s+(what|who|how|which|when|where|why)\b/i,
      /,\s*(ו)?(מה|מי|איך|איזה|מתי|איפה|למה)/,
      /[,\s]\s*(y|o)\s+(qué|quién|cómo|cuándo|dónde|cuál)/i,
    ];

    for (const key of OPEN_PROMPTS) {
      for (const prompt of valueOf(key)) {
        for (const shape of conjoined) {
          expect([key, prompt]).not.toMatchObject([key, expect.stringMatching(shape)]);
        }
      }
    }
  });

  it('leaves a chipped question free to offer its choice', () => {
    /*
     * The counter-example, asserted so the rule above cannot quietly be widened
     * into a sweep. The money question IS an either/or and must stay one.
     */
    const money = valueOf('payment_collection_prompt');

    expect(money.length).toBe(3);
    expect(money.some(prompt => /,\s*or\b/i.test(prompt))).toBe(true);
  });
});

describe('an answer button and the matcher that reads it stay identical', () => {
  /*
   * The labels are matched EXACTLY, and the reason is written at
   * `readCollectionMethod`: a keyword search finds "card" in a sentence that
   * exists to say there will be no card, so an invoicing business would be
   * classified as taking cards and sent into a Stripe identity check.
   *
   * Which makes editing one copy of a label and not the other a silent,
   * expensive bug. These assert both copies moved together.
   */
  const bothCopies = [
    'The client pays online by card: needs a payment gateway',
    'I collect the money myself: invoice, transfer or cash',
    'El cliente paga online con tarjeta: hace falta pasarela',
    'Cobro yo mismo: factura, transferencia o efectivo',
    'הלקוח משלם אונליין בכרטיס: צריך חיבור סליקה',
    'אני גובה את הכסף בעצמי: חשבונית, העברה, ביט או מזומן',
  ];

  it('each money label appears as both the offer and the matcher', () => {
    for (const label of bothCopies) {
      expect(manager.split(label).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('no dash survives in either copy', () => {
    for (const label of bothCopies) {
      expect(manager).toContain(label);
      expect(manager).not.toContain(label.replace(': ', ' — '));
    }
  });

  it('the appointments answer is matched in the casing it is offered in', () => {
    // The matcher lowercases the message, so it holds a lowercased label.
    expect(manager).toContain('I sell without appointments: no calendar needed');
    expect(manager).toContain('i sell without appointments: no calendar needed');
  });
});
