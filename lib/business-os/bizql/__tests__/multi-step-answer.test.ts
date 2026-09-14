/**
 * A plan that reads two things has to say how they relate.
 *
 * The renderer falls back to labelling the primary step when there is no answer
 * sentence. For one read that is a fine answer — "invoices: 3" answers "how
 * many invoices". Across two it silently drops the question:
 *
 *   "כמה אחוז זה מההכנסות"  ->  compute refunds, compute revenue, no sentence
 *   rendered as:            ->  "סכום שחויב: 931.33 $"
 *
 * Both numbers were computed correctly. The user was shown one of them, under a
 * label for something they had not asked about, with no percentage anywhere —
 * a confident non-answer, which is worse than an error.
 *
 * `{sN.percent_of.sM}` already existed; nothing was forcing the planner to use
 * it, or to write any sentence at all.
 */

import { isSoftProblem, validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const compute = (id: string, entity: string): unknown => ({
  id,
  op: 'compute',
  entity,
  agg: { fn: 'sum', field: 'amount' },
});

const planOf = (steps: unknown[], text?: string): Plan =>
  ({ steps, ...(text ? { answer: { text } } : {}) }) as Plan;

const complaint = (plan: Plan) =>
  validatePlan(plan, 'x').find((p) => p.includes('answer.text is required'));

describe('a two-step read', () => {
  it('is rejected when it says nothing about the relationship', () => {
    expect(complaint(planOf([compute('s1', 'refunds'), compute('s2', 'transactions')]))).toMatch(
      /reads 2 things/
    );
  });

  it('names the fix, so the repair round can act on it', () => {
    // A repair only helps if the message says what to do. This one carries the
    // exact shape of a working sentence.
    expect(complaint(planOf([compute('s1', 'refunds'), compute('s2', 'transactions')]))).toMatch(
      /percent_of/
    );
  });

  it('is accepted once it cites both steps', () => {
    expect(
      complaint(
        planOf(
          [compute('s1', 'refunds'), compute('s2', 'transactions')],
          '{s1.value} of {s2.value}, which is {s1.percent_of.s2}'
        )
      )
    ).toBeUndefined();
  });
});

describe('a single read', () => {
  it('needs a sentence too — the fallback is not an answer', () => {
    /*
     * This expectation used to be the opposite: one read was allowed to fall
     * back to "<entity>: <count>". Measuring a catalog-generated corpus settled
     * it — **30 of 39 failures** were exactly that, one defect causing three
     * quarters of everything wrong, in every language. "איש קשר: 1" is a
     * category and a count, not a reply.
     */
    expect(complaint(planOf([compute('s1', 'refunds')]))).toMatch(/answer.text is required/);
  });

  it('is satisfied by any sentence citing the step', () => {
    expect(
      complaint(planOf([compute('s1', 'refunds')], 'You have {s1.value} in refunds.'))
    ).toBeUndefined();
  });

  it('is not asked of a stored plan being re-validated', () => {
    /*
     * No user message means no live question — a saved plan re-running, or the
     * shape fixtures. Demanding a sentence there would reject something already
     * answered once.
     */
    const stored = planOf([compute('s1', 'refunds')]);
    expect(validatePlan(stored).find((p) => p.includes('answer.text is required'))).toBeUndefined();
  });
});

describe('how hard the rule bites', () => {
  /*
   * The rule pushes; it must not strand the user. Measured over the generated
   * corpus, making it fatal turned 31 of 297 turns into "I didn't quite follow
   * that" — turns that had been showing a bare count. So the one-read case is
   * SOFT: the planner ships the plan after its repairs are spent and the
   * renderer's fallback carries it.
   *
   * The two-read case stays FATAL, and the difference is the whole point. One
   * read with no sentence is a thin answer about the right thing; two reads
   * with no sentence is one number under a label for something else — the
   * `מי חייב לי כסף וכמה` → `איש קשר: 1` shape. An error beats that.
   */
  const single = complaint(planOf([compute('s1', 'refunds')]))!;
  const pair = complaint(planOf([compute('s1', 'refunds'), compute('s2', 'transactions')]))!;

  it('lets a one-read plan through once repairs are spent', () => {
    expect(isSoftProblem(single)).toBe(true);
  });

  it('still refuses a two-read plan that says nothing', () => {
    expect(isSoftProblem(pair)).toBe(false);
  });

  it('never softens anything else', () => {
    // A substring match would have. Both messages contain the same words.
    expect(isSoftProblem('entity "nope" is not in the catalog')).toBe(false);
    expect(isSoftProblem('step s1: unknown field "x"')).toBe(false);
  });
});

describe('what the rule deliberately leaves alone', () => {

  it('a write needs no sentence — the confirmation card describes it', () => {
    /*
     * Exempt on purpose. A mutate renders its own preview naming the row and
     * every field, so demanding prose for "mark it paid" would reject a plan
     * that was going to explain itself perfectly well.
     */
    const write = planOf([
      { id: 's1', op: 'mutate', entity: 'tasks', action: 'update', target: { id: 'x' }, data: {} },
      { id: 's2', op: 'mutate', entity: 'tasks', action: 'update', target: { id: 'y' }, data: {} },
    ]);

    expect(complaint(write)).toBeUndefined();
  });
});
