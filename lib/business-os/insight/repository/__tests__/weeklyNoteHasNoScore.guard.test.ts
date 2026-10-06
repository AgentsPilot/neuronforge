/**
 * The weekly note says what moved, never what it scored.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPORTED BY THE OWNER, 2026-10-05: "this summary is vague, hard to
 * understand". The stored note read, in Hebrew:
 *
 *   "Your business is in good shape at 85/100, but there are some red flags!
 *    The good news is sales and revenue stay strong, especially with a score of
 *    80/100 in sales and 92/100 in cash flow..."
 *
 * Three numbers, none of which name a thing that happened, and two of which the
 * model invented — the prompt gave it ONE score and it rendered the measured
 * rates as scores too, because being handed `85 out of 100` taught it that
 * `/100` was the house style.
 *
 * It also used "cash flow", which the same prompt bans as a CONCEPT in any
 * language, and opened by telling the owner their business was doing well,
 * which the same prompt forbids outright. A rule cannot win against the shape
 * of its own input.
 *
 * So the score left the prompt. What remains is the rates and their movement,
 * and a summary can only be made of those because there is nothing else there
 * to make one from. `health_score` is still stored for whatever reads the
 * column; it is simply never narrated.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const repo = readFileSync(join(__dirname, '..', 'InsightRepository.ts'), 'utf8');

/** The weekly prompt: from its opening line to the JSON shape it asks for. */
const prompt = repo.slice(
  repo.indexOf('You are writing a short weekly note'),
  repo.indexOf('"highlights": [')
);

/** The three deterministic fallbacks, used when the model is off or fails. */
const fallbackStart = repo.indexOf('private generateHealthNarrativeFallback');
const fallback = repo.slice(fallbackStart);

// `calculateCategoryScores` sits ABOVE the fallback in the file, so slicing
// between them the other way round yields an empty string — which makes every
// `not.toMatch` below pass vacuously. Checked rather than assumed.
if (fallbackStart < 0) throw new Error('fallback not found; this guard would pass on nothing');

describe('the weekly prompt', () => {
  it('never hands the model a score', () => {
    /*
     * The input that taught it the house style. With no `X out of 100` in the
     * prompt there is nothing for it to pattern-match the rates against.
     */
    expect(prompt).not.toMatch(/SCORE: \$\{healthScore\}/);
    expect(prompt).not.toMatch(/\$\{healthScore\} out of 100/);
  });

  it('forbids a number out of 100 outright, with no exception left', () => {
    /*
     * The old rule read "the ONLY number out of 100 you may use is the SCORE
     * above" — an exception the model took as permission. There is no score
     * now, so there is no exception.
     */
    expect(prompt).toMatch(/NEVER write a number out of 100/);
    expect(prompt).not.toMatch(/ONLY number out of 100 you may use/);
  });

  it('requires every figure to carry its movement', () => {
    // "92%, up 4 points from 88%" is checkable. "92" is not.
    expect(prompt).toMatch(/Every number you write must be one of the rates above/);
  });

  it('asks the title to name what moved, not a mark', () => {
    const title = prompt.slice(prompt.indexOf('"title"'));

    expect(title).toMatch(/Never a score and never a number out of 100/);
    expect(title).not.toMatch(/64\/100/);
  });

  it('still bans the business-school vocabulary in every language', () => {
    /*
     * The other half of what made that note unreadable: "cash flow" arrived in
     * Hebrew as תזרים מזומנים. The ban is on the concept, not the English.
     */
    expect(prompt).toMatch(/banned as CONCEPTS, in whatever language/i);
    expect(prompt).toMatch(/"cash flow"\s*->/);
  });

  it('still refuses to grade the business overall', () => {
    // "Your business is in good shape" was the opening line of the note.
    expect(prompt).toMatch(/Never tell them their business is doing well or badly overall/);
  });
});

describe('the deterministic fallback', () => {
  it('is a real slice of the file, not an empty string', () => {
    // Three of these assertions are `not.toMatch`, and an empty haystack
    // satisfies all of them. This is what stops the suite going green on a
    // renamed method.
    expect(fallback.length).toBeGreaterThan(500);
  });

  it('prints no score in any of the three languages', () => {
    /*
     * The fallback is what an owner reads when the narrator is switched off or
     * the call fails, and it carried the same sentence the prompt now forbids:
     * "בריאות העסק שלך: 85/100".
     */
    expect(fallback).not.toMatch(/\$\{healthScore\}/);
    expect(fallback).not.toMatch(/\/100/);
    expect(fallback).not.toMatch(/out of 100|מתוך 100|sobre 100/);
  });

  it('reports movement instead, in all three', () => {
    // Hebrew, Spanish and English each name how many measures moved.
    expect(fallback).toMatch(/moved\.improved/);
    expect(fallback).toMatch(/מהדברים שנמדדו השתפרו/);
    expect(fallback).toMatch(/medidas mejoraron/);
    expect(fallback).toMatch(/measures improved/);
  });

  it('says plainly when nothing could be compared', () => {
    /*
     * `movementOf` returns null below two comparable categories, matching
     * `movingUp`. A summary built on one measure is a sentence about one
     * number wearing the clothes of an overview.
     */
    expect(fallback).toMatch(/moved === null/);
    expect(repo).toMatch(/if \(health\.movingUp === null\) return null;/);
  });

  it('does not rescue a missing LLM title with a score either', () => {
    expect(repo).not.toMatch(/parsed\.title \|\| `Business Health: \$\{healthScore\}/);
  });
});

describe('what is deliberately kept', () => {
  it('still stores the score in its column', () => {
    /*
     * Removing the figure from the PROSE is the fix. The column is read
     * elsewhere and `score_change` drives the trend arrow, neither of which
     * puts an uncheckable number in front of the owner as a sentence.
     */
    expect(repo).toMatch(/health_score:/);
    expect(repo).toMatch(/score_change: scoreChange/);
  });

  it('still tells the model what could NOT be measured', () => {
    // A model given six rates and no mention of the seventh assumes the
    // seventh is fine.
    expect(prompt).toMatch(/WHAT COULD NOT BE MEASURED/);
  });
});
