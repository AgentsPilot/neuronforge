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
    expect(manager).toMatch(/SKIP ANY FIELD WHOSE ANSWER IS ALREADY OBVIOUS FROM THE TRADE/);
    expect(manager).toMatch(/If your prediction is the question restated/);
    expect(manager).toMatch(/Three sharp questions beat six dutiful ones/);
  });

  it('says an invented answer is worse than a missing one', () => {
    // This is the actual harm: it ends up published under their name.
    expect(manager).toMatch(/becomes a claim on their website that they did not make/);
  });

  it('keeps the delivery question about the work, and skippable', () => {
    // It asked about BOOKING, which is the one thing the site already knows.
    expect(manager).toMatch(/ask about the WORK, never about booking or paying/);
    expect(manager).toMatch(/is a single visit with nothing to describe, skip it/);
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
    expect(manager).toMatch(/askedBriefFields = \[\.\.\.alreadyAsked, next\.field, \.\.\.next\.skip\]/);
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
