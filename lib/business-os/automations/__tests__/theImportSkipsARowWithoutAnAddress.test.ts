/**
 * The spreadsheet import files people, not words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * A row whose email column held a NAME was imported. The guard it passed was
 * `person.email != ""`, which asks only whether the cell holds something — and
 * a sheet kept by hand is full of cells holding "David", "call him", "-" and
 * "n/a". Each became a CRM contact whose email address is a word.
 *
 * Nothing downstream recovers from that. The client cannot be written to. The
 * dedupe in step6 looks the contact up BY EMAIL, so on the next run it matches
 * nothing and files the same person again, and again, once per import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS THE REAL EVALUATOR AGAINST THE REAL PLAN
 *
 * The condition lives in a committed JSON file and is executed by
 * `ConditionalEvaluator`. A test that re-implements the regex would pass while
 * the plan carried a different one, and a test that asserted the JSON string
 * would pass while the operator meant something else. So this reads the
 * shipped plan, pulls the condition out of it, and asks the engine the same
 * question the runner will ask.
 */

import fs from 'fs';
import path from 'path';
import { ConditionalEvaluator } from '@/lib/pilot/ConditionalEvaluator';

const PLAN = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'agents', 'importLeadsFromSheet.steps.json'),
    'utf8'
  )
);

/** The committed skip, exactly as the runner will execute it. */
function theSkip(): Record<string, unknown> {
  const steps = Array.isArray(PLAN) ? PLAN : PLAN.steps;
  const scatter = steps.find((s: { id: string }) => s.id === 'step4');
  const first = scatter.scatter.steps[0];
  expect(first.id).toBe('step5');
  return first.condition;
}

const evaluator = new ConditionalEvaluator();

/**
 * The two things the evaluator asks of its context, and nothing else.
 *
 * `resolveVariable` is how `person.email` becomes the cell's contents, and
 * `isConditionalCoercionEnabled` is the flag that decides whether values are
 * coerced before comparison — read from the real context at runtime, stated
 * here as the default so the test is asking the same question the runner does.
 */
const contextHolding = (email: unknown) => ({
  /*
   * The reference arrives WITH its braces — `{{person.email}}` — because the
   * evaluator hands the field through verbatim and the context is what
   * resolves it. Matching on the bare path returned undefined for everything,
   * and undefined never matches: every "this must be skipped" case passed
   * while proving nothing. Asserted rather than assumed, so the day that
   * changes this fails loudly instead of going quietly green.
   */
  resolveVariable: (ref: string) => {
    expect(ref).toBe('{{person.email}}');
    return email;
  },
  isConditionalCoercionEnabled: () => false,
});

/** Does this cell get past the skip and reach the CRM? */
const imports = (email: unknown): boolean =>
  evaluator.evaluate(theSkip() as never, contextHolding(email) as never) as boolean;

describe('the row the import was given', () => {
  it('files a real address', () => {
    for (const address of [
      'tal@example.com',
      'tal.omer@sub.example.co.il',
      'tal+leads@example.com',
      "o'brien@example.ie",
      'TAL@EXAMPLE.COM',
    ]) {
      expect(imports(address)).toBe(true);
    }
  });

  it('skips a name where the address should be', () => {
    /* The reported row, and its neighbours on a hand-kept sheet. */
    for (const notAnAddress of [
      'David',
      'David Cohen',
      'call him',
      'n/a',
      '-',
      '???',
      '050-1234567',
    ]) {
      expect(imports(notAnAddress)).toBe(false);
    }
  });

  it('skips the almost-addresses', () => {
    /* Each of these would be written to the CRM and never deliver. */
    for (const broken of [
      'tal@',
      '@example.com',
      'tal@example',
      'tal example.com',
      'tal@@example.com',
      'tal@example.',
      'tal@example.c',
    ]) {
      expect(imports(broken)).toBe(false);
    }
  });

  it('still skips what it always skipped', () => {
    /* The blank rows, totals lines and margin notes this check was written
       for in the first place. Widening it must not narrow it. */
    for (const empty of ['', '   ', null, undefined]) {
      expect(imports(empty)).toBe(false);
    }
  });

  it('does not lose a lead to a stray space', () => {
    /*
     * A trailing space is a typing accident, not a reason to drop somebody.
     * The cost of refusing a real customer is a lost lead; the cost of letting
     * a near-miss through is one contact the owner can see and correct. The
     * check leans that way on purpose.
     */
    expect(imports(' tal@example.com')).toBe(true);
    expect(imports('tal@example.com ')).toBe(true);
  });

  it('skips a cell holding two addresses', () => {
    /*
     * Filing it would create a contact whose address is neither of them, and
     * the owner would never know which two people they had lost.
     */
    expect(imports('tal@example.com, dana@example.com')).toBe(false);
    expect(imports('tal@example.com; dana@example.com')).toBe(false);
  });

  it('is a shape test, not an RFC parser', () => {
    /*
     * Pinned deliberately. The temptation on reading this file is to "fix" the
     * pattern into full RFC 5322, which rejects addresses that deliver
     * perfectly well — and every one it rejects is a real customer silently
     * dropped from an import the owner believes worked.
     */
    const condition = theSkip() as { operator: string; value: string };
    expect(condition.operator).toBe('matches');
    expect(condition.value.length).toBeLessThan(80);
  });
});
