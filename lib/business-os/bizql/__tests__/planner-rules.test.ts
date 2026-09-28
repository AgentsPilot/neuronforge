/**
 * The rule list the model is actually sent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TEST ON PROSE
 *
 * The rules live in four strings that get concatenated, and each one reads
 * correctly on its own. The defect existed only in the join, which is why review
 * never caught it: the model was being sent
 *
 *   1 2 3 4 5 6 7 8 9 10 11 20 20 12 13 14 15 16 17
 *
 * Two rules both numbered 20, five numbers absent, and the sequence running
 * backwards in the middle. The read-only assembly, which drops the action rules,
 * was 1..11, 20, 20, 14, 15.
 *
 * Numbers are now derived from position, so a duplicate or a gap is
 * unrepresentable. This file exists for the thing that IS still representable: a
 * new block added to one assembly and forgotten in the other, or a rule that
 * refers to another one by a number that has since moved.
 *
 * It asserts structure, never wording. A rule's argument is for people to
 * review; its position in a list is arithmetic, and arithmetic is what got
 * silently wrong.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PLANNER_SYSTEM_PROMPT, plannerSystemPrompt } from '../planner/planTool';

/** Every rule number in the order the model reads them. */
const numbersIn = (prompt: string): number[] =>
  [...prompt.matchAll(/\n(\d+)\. /g)].map((m) => Number(m[1]));

const ASSEMBLIES: Array<[string, string]> = [
  ['with actions', plannerSystemPrompt({ actions: true })],
  ['without actions', plannerSystemPrompt({ actions: false })],
];

describe.each(ASSEMBLIES)('the %s assembly', (_name, prompt) => {
  const numbers = numbersIn(prompt);

  it('numbers its rules 1..n with no gap and no repeat', () => {
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('sends more than a handful of rules', () => {
    // A guard against the list silently collapsing — an empty array joins to a
    // prompt that still looks plausible and teaches the model nothing.
    expect(numbers.length).toBeGreaterThan(10);
  });

  it('keeps the preamble ahead of rule 1', () => {
    expect(prompt.indexOf('RULES\n1. ')).toBeGreaterThan(0);
    expect(prompt.startsWith('You convert a small-business owner')).toBe(true);
  });

  it('refers to other rules by name, never by number', () => {
    /*
     * "See rule 11" meant the fan-out shape, which was rule 13; rule 11 is
     * derived fields. A number in prose is a reference nothing checks and
     * renumbering invalidates, so there must not be one.
     */
    expect(prompt).not.toMatch(/\bsee rule \d+/i);
    expect(prompt).not.toMatch(/\brules? \d+ (?:above|below)\b/i);
  });
});

describe('the two assemblies', () => {
  const withActions = plannerSystemPrompt({ actions: true });
  const withoutActions = plannerSystemPrompt({ actions: false });

  it('agree on the rules they share, in the same order', () => {
    // The read-only assembly drops the action rules and keeps the rest. If a
    // core rule is added to one list and not the other, the shared prefix stops
    // matching — which is the failure this catches.
    const core = withoutActions.slice(0, withoutActions.indexOf('\n12. '));
    expect(withActions.startsWith(core)).toBe(true);
  });

  it('is shorter without actions, because that is the whole point of splitting', () => {
    expect(withoutActions.length).toBeLessThan(withActions.length);
  });

  it('is what PLANNER_SYSTEM_PROMPT exports', () => {
    // `plannerVersion()` hashes this into the plan-cache key, and the eval
    // harness sends it. The two must not drift.
    expect(PLANNER_SYSTEM_PROMPT).toBe(withActions);
  });
});
