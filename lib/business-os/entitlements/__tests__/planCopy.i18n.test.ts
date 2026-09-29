/**
 * The words behind the plan section's keys — in all three languages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The view names sentences rather than writing them, so that the plan section
 * can be read in Hebrew and Spanish. Two things that used to be asserted in the
 * view's own tests moved here with the copy:
 *
 *   1. Every key the view can name EXISTS, in en, es and he. A missing one is
 *      not a blank line — `t()` answers with the key itself, so a customer would
 *      read `plan.changes.on_end` on the settings page.
 *
 *   2. The sentences still say the load-bearing things, and still avoid the
 *      forbidden ones. A plan is described by what it INCLUDES; the moment a
 *      translation says "your plan does not include…" the section is doing the
 *      one thing it was built not to do — and a translator cannot know that.
 *      Checking all three languages is stricter than the English-only check this
 *      replaced.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** Every key the view, the badge or the section can name. */
const KEYS = [
  'plan.section_title',
  'plan.loading',
  'plan.includes',
  'plan.price.free_no_end',
  'plan.price.free',
  'plan.price.per_month',
  'plan.ends.while_paid',
  'plan.problem.unavailable',
  'plan.problem.no_record',
  'plan.ends_on',
  'plan.ends_on_or_actions',
  'plan.move_before_then',
  'plan.changes.no_end_date',
  'plan.changes.on_end',
  'plan.badge.no_end',
  'plan.badge.ends',
  'plan.category.crm',
  'plan.category.website_intake',
  'plan.category.payments',
  'plan.category.ai_chat',
  'plan.category.marketing',
  'plan.category.insights',
  'plan.category.support',
  'plan.category.platform',
  'plan.category.addon',
];

const LANGUAGES = 3;

/*
 * Read as TEXT rather than imported.
 *
 * `LanguageContext` is a client module with React in it; importing it here would
 * drag a provider into a unit test to read a dictionary. Counting the entries is
 * enough to prove each key is present once per language.
 */
const source = readFileSync(
  join(process.cwd(), 'lib/business-os/LanguageContext.tsx'),
  'utf8'
);

/** The copy for one key, in the order the file declares its languages. */
function copyFor(key: string): string[] {
  const pattern = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`, 'g');
  return [...source.matchAll(pattern)].map((match) => match[2]);
}

describe('the plan section speaks all three languages', () => {
  it('has every key the view can name, once per language', () => {
    const missing = KEYS.filter((key) => copyFor(key).length !== LANGUAGES).map(
      (key) => `${key} (${copyFor(key).length}/${LANGUAGES})`
    );

    /*
     * A key with two of three is the dangerous case: it reads correctly until
     * somebody switches to the language nobody filled in, and then reads as a
     * developer identifier.
     */
    expect(missing).toEqual([]);
  });

  it('keeps the date placeholder in every language that needs one', () => {
    for (const key of ['plan.ends_on', 'plan.ends_on_or_actions']) {
      for (const text of copyFor(key)) {
        // Without it the component substitutes nothing and the sentence names no
        // day — which is the entire point of those two.
        expect(text).toContain('{date}');
      }
    }
    for (const text of copyFor('plan.price.per_month')) {
      expect(text).toContain('{amount}');
    }
  });

  it('still says the load-bearing things', () => {
    // English is the one language this test can read for meaning. The promises
    // these two sentences carry are why they exist: a champion is told that the
    // product is normally paid, and that nothing is charged without a choice.
    const [openEnded] = copyFor('plan.changes.no_end_date');
    expect(openEnded).toMatch(/no end date/i);
    expect(openEnded).toMatch(/paid monthly plan/i);
    expect(openEnded).toMatch(/tell you first/i);

    const [onEnd] = copyFor('plan.changes.on_end');
    expect(onEnd).toMatch(/paid monthly plan/i);
    expect(onEnd).toMatch(/nothing is charged/i);

    const [noRecord] = copyFor('plan.problem.no_record');
    expect(noRecord).toMatch(/plan record/i);
    expect(noRecord).toMatch(/keeps working/i);
  });

  it('never describes a plan by what it withholds — in ANY language', () => {
    /*
     * The same pattern `customerPlanView.noExclusions.test.ts` applies, now over
     * the copy itself. "We do not have a plan record" is about OUR data, not the
     * customer's entitlements, and deliberately does not match.
     */
    const exclusionPhrasing = new RegExp(
      [
        String.raw`your plan (does not|doesn't|will not|won't) (include|cover|have)`,
        String.raw`your plan excludes`,
        String.raw`\byou (do not|don't) (have|get)\b`,
        String.raw`\byou lack\b`,
        String.raw`not (included|available) (in|on) your`,
        String.raw`missing from your (plan|account)`,
      ].join('|'),
      'i'
    );

    const offenders = KEYS.flatMap((key) =>
      copyFor(key)
        .filter((text) => exclusionPhrasing.test(text))
        .map((text) => `${key}: ${text}`)
    );

    expect(offenders).toEqual([]);
  });
});
