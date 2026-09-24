/**
 * No detector may invent a number and show it to an owner as their own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A CODE REVIEW
 *
 * This class of bug has been "fixed" three separate times and come back twice,
 * because each fix only covered the files somebody happened to be reading:
 *
 *   `const avgBookingValue = 75`      removed from the utilisation detector and
 *                                     the projector — and left in two other
 *                                     detectors as `payment_amount || '75'`
 *   `percentChange: 100`              removed from sixteen detectors, and still
 *                                     present in a seventeenth
 *   `* 0.3 // 30% could rebook`       an invented rebooking rate
 *   `* 0.2 // 20% conversion`         duplicated across two detectors
 *   `avgRecurringValue = 150`         invented per-card revenue
 *   `critical * 100 + high * 50`      its own comment called it "rough"
 *
 * Each one reached a real dashboard, formatted in the business's real currency,
 * reading as a measurement. The owner has no way to tell those from the figures
 * that are real, which is the actual damage: it makes every number suspect.
 *
 * So the rule is enforced here rather than remembered. A figure shown to an
 * owner comes from a column or from a resolver on `BaseDetector`
 * (`resolveAverageDealValue` / `resolveLeadConversionRate` /
 * `resolveVisitorToLeadRate`), which return null when the business has no
 * history — and null means the sentence stops, not that a default appears.
 *
 * IF THIS TEST FAILS, do not add your constant to an exemption list. Either
 * measure it or leave the figure out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const CATALOG = join(__dirname, '..', 'catalog');
const PROJECTOR = join(__dirname, '..', '..', 'projection', 'ImpactProjector.ts');

/** Every detector, plus the projector, which writes the same kind of sentence. */
function sources(): Array<{ file: string; text: string }> {
  const files = readdirSync(CATALOG)
    .filter(f => f.endsWith('Detector.ts'))
    .map(f => ({ file: `catalog/${f}`, text: readFileSync(join(CATALOG, f), 'utf8') }));

  return [...files, { file: 'projection/ImpactProjector.ts', text: readFileSync(PROJECTOR, 'utf8') }];
}

/**
 * Strip comments before matching.
 *
 * Every one of these fixes leaves a comment explaining the constant it removed,
 * and those comments quote the constant. Without this the guard fails on its
 * own history.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** file:line for every match, so a failure names the place. */
function findAll(pattern: RegExp): string[] {
  const hits: string[] = [];

  for (const { file, text } of sources()) {
    code(text).split('\n').forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
      pattern.lastIndex = 0;
    });
  }

  return hits;
}

describe('no invented figures reach an owner', () => {
  it('has no fallback price standing in for a missing amount', () => {
    /*
     * `payment_amount || '75'`. Zero is allowed and is not a guess — it is the
     * identity for a sum, and a booking with no price contributes nothing.
     */
    expect(findAll(/\|\|\s*'0*[1-9][0-9]*'/)).toEqual([]);
  });

  it('has no hardcoded average deal, booking or recurring value', () => {
    expect(
      findAll(/\b(avg|average)[A-Za-z]*(Value|Price|Deal|Revenue|Booking)\s*=\s*-?[0-9]/i)
    ).toEqual([]);
  });

  it('has no bare percentage multiplier applied to money or counts', () => {
    /*
     * `* 0.3 // 30% could rebook` and `* 0.2 // 20% conversion`. A rate must
     * come from `resolveLeadConversionRate` or an equivalent measurement; a
     * decimal literal in a detector is somebody's guess.
     */
    expect(findAll(/\*\s*0\.[0-9]+(?!\s*\))/)).toEqual([]);
  });

  it('reports no percentage change it did not measure', () => {
    // `percentChange: 100` against a baseline of nothing.
    expect(findAll(/percentChange:\s*-?[1-9][0-9]*/)).toEqual([]);
  });

  it('does not price a finding per severity band', () => {
    // `criticalCount * 100 + highCount * 50`.
    expect(findAll(/(critical|high|medium|low)[A-Za-z]*\s*\*\s*[0-9]{2,}/i)).toEqual([]);
  });
});
