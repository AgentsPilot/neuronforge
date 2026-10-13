/**
 * The line beside a price is a line, whatever the model sends.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A service description is the owner's notes about what they sell. On the
 * reporting account `קורס קשב` runs to 1,296 characters: diagnosis rates, the
 * neurology of the condition, what it is like to parent a child who has it. It
 * is the BASIS for the page, not copy to print.
 *
 * The preview and save routes each shortened it before rendering. The wizard
 * does not use either -- it renders its own preview straight from what the
 * generator returns -- so that copy kept the full description and printed all
 * 1,296 characters down a column one word wide, beside a price.
 *
 * Capping it in the generator covers every consumer at once, the two that
 * already guarded included.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { leadSentence } from '../leadSentence';

/** The live row, opening sentence and all. */
const REAL_DESCRIPTION =
  'כמדריכי הורים ומטפלים המלווים הורים ומשפחות, אנו פוגשים מידי יום אנשים עם הפרעת קשב וריכוז, חלקם מאובחנים וחלקם לא. ' +
  'לא אחת אנשי טיפול ומדריכי הורים מרגישים שהמטרות שהציבו לא מתקדמות ולא מיושמות, שהכלים שיש להם אינם מתאימים להורים ולילדים שעימם הם עובדים. ' +
  'במחקרים מדווח על עלייה של 30% באנשים המאובחנים עם הפרעת קשב וריכוז.';

const MAX_PLAN_LINE = 140;

/** The generator's rule, restated: the model's line, then the lead, then nothing. */
const planLine = (written: string | null, description: string | null) =>
  leadSentence(written, MAX_PLAN_LINE) ?? leadSentence(description, MAX_PLAN_LINE) ?? '';

describe('the description is a basis, not the card', () => {
  it('the real description is far too long to print', () => {
    // The live row is 1,296 characters; this excerpt is the opening third and
    // is already more than twice what fits beside a price.
    expect(REAL_DESCRIPTION.length).toBeGreaterThan(MAX_PLAN_LINE * 2);
  });

  it('a model that echoes the whole description does not get it printed', () => {
    // The exact failure in the screenshot: the model returned the brief back.
    const line = planLine(REAL_DESCRIPTION, REAL_DESCRIPTION);
    expect(line.length).toBeLessThanOrEqual(MAX_PLAN_LINE);
    expect(line).not.toBe(REAL_DESCRIPTION);
  });

  it('a short line the model wrote is kept as it is', () => {
    const written = 'קורס מעשי לאנשי טיפול והדרכת הורים, עם כלים ליישום מיידי.';
    expect(planLine(written, REAL_DESCRIPTION)).toBe(written);
  });

  it('falls back to the opening sentence when the model wrote nothing', () => {
    const line = planLine(null, REAL_DESCRIPTION);
    expect(line).toBe('כמדריכי הורים ומטפלים המלווים הורים ומשפחות, אנו פוגשים מידי יום אנשים עם הפרעת קשב וריכוז, חלקם מאובחנים וחלקם לא.');
    expect(line.length).toBeLessThanOrEqual(MAX_PLAN_LINE);
  });

  it('prefers an empty card to a wall of text', () => {
    // A description whose FIRST sentence is already a paragraph has no usable
    // line in it. Blank beside a price reads as a clean card; a wall reads as a
    // rendering fault.
    const noLead = 'א'.repeat(300) + '.';
    expect(planLine(null, noLead)).toBe('');
  });

  it('never returns more than the cap, for any combination', () => {
    const cases: Array<[string | null, string | null]> = [
      [REAL_DESCRIPTION, REAL_DESCRIPTION],
      [null, REAL_DESCRIPTION],
      [REAL_DESCRIPTION, null],
      [null, null],
      ['', ''],
      ['קצר.', REAL_DESCRIPTION],
    ];
    for (const [written, description] of cases) {
      expect(planLine(written, description).length).toBeLessThanOrEqual(MAX_PLAN_LINE);
    }
  });
});

describe('the generator applies it, and asks the model for it', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/website/landing-pages/generate/route.ts'),
    'utf8'
  );

  it('caps the plan line before returning the model\'s content', () => {
    expect(route).toContain('capPlanLine(parsed, validated.serviceDescription)');
  });

  it('tells the model to summarise rather than copy', () => {
    expect(route).toMatch(/SUMMARISE the description -- never copy it/);
    expect(route).toMatch(/UNDER 140 characters/);
  });

  it('and the cap is the same number the prompt asks for', () => {
    // Two numbers that must agree: the instruction and the enforcement.
    expect(route).toContain('const MAX_PLAN_LINE = 140');
  });
});
